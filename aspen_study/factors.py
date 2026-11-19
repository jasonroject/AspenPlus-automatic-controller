"""Emission factor library: load, validate and match inventory rows to entries."""
from __future__ import annotations

import json
from pathlib import Path

from .schema_check import validate

LIBRARY = Path(__file__).resolve().with_name("factor_library") / "library.json"
# Higher number = more specific match key.
_KEY_RANK = {"cas": 50, "alias": 40, "component": 30, "utility": 20, "treatment": 10, "flow": 1, "carbon_origin": 1}


def load_library(path=LIBRARY, extra=None):
    """Return a list of entries; `extra` (user/study factors) take precedence."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    validate(data, "factor-library")
    entries = list(data["entries"])
    for lib in extra or []:
        validate(lib, "factor-library")
        entries = [dict(e, _user=True) for e in lib["entries"]] + entries
    for e in entries:
        if e["status"] == "verified" and (e["value"] is None or not e["source"] or e["year"] is None):
            raise ValueError(f"Factor {e['id']}: verified entries need value, source and year")
        if e["value"] is not None and e["value"] < 0:
            raise ValueError(f"Factor {e['id']}: credits/negative factors are not supported")
    return entries


def match(entries, query, category):
    """Best entry for an inventory query, or None.

    query keys: cas, alias, component, utility, flow, treatment, region, carbon_origin.
    An entry matches only if every key it declares agrees with the query
    (region: entry region must equal query region; entries without region are
    generic fallbacks). Placeholders are returned too; callers must treat
    value=None as missing, never as zero.
    """
    best, best_score = None, -1
    for e in entries:
        if e["category"] != category:
            continue
        m = e["match"]
        ok, score = True, 0
        for key, value in m.items():
            q = query.get(key)
            if key in ("alias", "component"):
                ok = q is not None and str(q).upper() == str(value).upper()
            else:
                ok = q == value
            if not ok:
                break
            score += _KEY_RANK.get(key, 0) + (5 if key == "region" else 0)
        if not ok:
            continue
        score += 1000 if e.get("_user") else 0
        score += 2 if e["value"] is not None else 0
        if score > best_score:
            best, best_score = e, score
    return best


def usable(entry):
    return entry is not None and entry["value"] is not None and entry["status"] in ("verified", "user_supplied", "proxy")
