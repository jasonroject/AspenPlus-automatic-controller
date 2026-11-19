"""Merge a user override file (roles.yaml / roles.json) into an auto draft.

Overrides win field by field; overridden entries get provenance.source =
"override", confidence 1 and no confirmation flag. Unknown stream/block IDs
and a mismatched model hash are errors (no silent drops).
"""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

from .classifier import pending_items
from .schema_check import validate

TOP_LEVEL = ("functional_unit", "allocation", "region", "lcia_method", "system_boundary")


def load_override(path):
    path = Path(path)
    text = path.read_text(encoding="utf-8-sig")
    if path.suffix.lower() in (".yaml", ".yml"):
        try:
            import yaml
        except ImportError as exc:  # optional dependency
            raise RuntimeError("读取 roles.yaml 需要 PyYAML（pip install pyyaml），或改用 roles.json") from exc
        data = yaml.safe_load(text) or {}
    else:
        data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("Override file must contain a mapping at the top level")
    return data


def _merge_entry(auto, override):
    merged = deepcopy(auto) if auto else {}
    for key, value in override.items():
        if key == "provenance":
            continue
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = {**merged[key], **deepcopy(value)}
        else:
            merged[key] = deepcopy(value)
    previous = (auto or {}).get("role")
    reasons = ["来自用户覆盖文件"] + ([f"自动建议为 {previous}"] if previous and previous != merged.get("role") else [])
    merged["provenance"] = {"source": "override", "confidence": 1.0, "reasons": reasons, "needs_confirmation": False}
    return merged


def merge(roles, override, graph=None):
    roles = deepcopy(roles)
    expected = override.get("model_sha256")
    if expected and expected != roles["model_sha256"]:
        raise ValueError("roles override was written for a different model (sha256 mismatch)")
    known = {"streams": set(roles["streams"]), "blocks": set(roles["blocks"])}
    if graph is not None:
        known["streams"] |= {s["id"] for s in graph["streams"]}
        known["blocks"] |= {b["id"] for b in graph["blocks"]}
    for section in ("streams", "blocks"):
        for ident, entry in (override.get(section) or {}).items():
            if ident not in known[section]:
                raise ValueError(f"Override names unknown {section[:-1]} '{ident}'")
            if not isinstance(entry, dict):
                raise ValueError(f"Override for {section[:-1]} '{ident}' must be a mapping")
            roles[section][ident] = _merge_entry(roles[section].get(ident), entry)
    # A user-declared product demotes auto-picked product candidates.
    if any(e.get("role") == "product" for e in (override.get("streams") or {}).values()):
        for ident, entry in roles["streams"].items():
            if entry["role"] == "product" and entry["provenance"]["source"] == "auto":
                entry["role"] = "coproduct"
                entry["provenance"]["reasons"].append("用户已指定其他产品流股 → 降为副产品候选")
                entry["provenance"]["needs_confirmation"] = True
    for key in TOP_LEVEL:
        if key in override:
            roles[key] = deepcopy(override[key])
    fu_confirmed = "functional_unit" in override
    if fu_confirmed:
        fu = roles["functional_unit"]
        for sid in [fu.get("stream"), *fu.get("streams", [])]:
            if sid and sid not in known["streams"]:
                raise ValueError(f"functional_unit references unknown stream '{sid}'")
    review = deepcopy(override.get("review") or {})
    pending = pending_items(roles, functional_unit_confirmed=fu_confirmed)
    if review.get("state") == "reviewed":
        roles["review"] = {**review, "pending": []}
    else:
        roles["review"] = {**review, "state": "auto_draft" if not override else "partially_reviewed", "pending": pending}
    validate(roles, "roles")
    return roles
