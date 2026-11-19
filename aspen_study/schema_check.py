"""Minimal JSON Schema (2020-12 subset) validator using only the standard library.

Supported keywords: $ref (local #/$defs/... and #/...), type, const, enum, not,
required, properties, additionalProperties, minProperties, items, minItems,
pattern, minLength, minimum, maximum, exclusiveMinimum. Unknown keywords
(title, description, $id ...) are ignored. Enough for the aspen-study/2 schemas;
not a general-purpose implementation.
"""
from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path

SCHEMA_DIR = Path(__file__).resolve().with_name("schemas")
_TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v),
}


@lru_cache(maxsize=None)
def load_schema(name: str) -> dict:
    path = SCHEMA_DIR / (name if name.endswith(".json") else name + ".schema.json")
    return json.loads(path.read_text(encoding="utf-8"))


def _resolve(root, ref):
    if not ref.startswith("#/"):
        raise ValueError(f"Only local $ref is supported: {ref}")
    node = root
    for part in ref[2:].split("/"):
        node = node[part]
    return node


def _equal(a, b):
    return type(a) is type(b) and a == b or (
        _TYPES["number"](a) and _TYPES["number"](b) and a == b)


def errors(instance, schema, root=None, path="$"):
    root = schema if root is None else root
    out = []
    if "$ref" in schema:
        out += errors(instance, _resolve(root, schema["$ref"]), root, path)
    if "type" in schema:
        types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(_TYPES[t](instance) for t in types):
            return out + [f"{path}: expected {'/'.join(types)}"]
    if "const" in schema and not _equal(instance, schema["const"]):
        out.append(f"{path}: must equal {schema['const']!r}")
    if "enum" in schema and not any(_equal(instance, v) for v in schema["enum"]):
        out.append(f"{path}: must be one of {schema['enum']!r}")
    if "not" in schema and not errors(instance, schema["not"], root, path):
        out.append(f"{path}: matches a forbidden value")
    if isinstance(instance, str):
        if len(instance) < schema.get("minLength", 0):
            out.append(f"{path}: too short")
        if "pattern" in schema and not re.search(schema["pattern"], instance):
            out.append(f"{path}: does not match {schema['pattern']}")
    if _TYPES["number"](instance):
        if "minimum" in schema and instance < schema["minimum"]:
            out.append(f"{path}: below minimum {schema['minimum']}")
        if "maximum" in schema and instance > schema["maximum"]:
            out.append(f"{path}: above maximum {schema['maximum']}")
        if "exclusiveMinimum" in schema and instance <= schema["exclusiveMinimum"]:
            out.append(f"{path}: must be > {schema['exclusiveMinimum']}")
    if isinstance(instance, dict):
        for key in schema.get("required", []):
            if key not in instance:
                out.append(f"{path}: missing required '{key}'")
        if len(instance) < schema.get("minProperties", 0):
            out.append(f"{path}: needs at least {schema['minProperties']} properties")
        props = schema.get("properties", {})
        extra = schema.get("additionalProperties", True)
        for key, value in instance.items():
            if key in props:
                out += errors(value, props[key], root, f"{path}.{key}")
            elif extra is False:
                out.append(f"{path}: unexpected property '{key}'")
            elif isinstance(extra, dict):
                out += errors(value, extra, root, f"{path}.{key}")
    if isinstance(instance, list):
        if len(instance) < schema.get("minItems", 0):
            out.append(f"{path}: needs at least {schema['minItems']} items")
        if "items" in schema:
            for i, item in enumerate(instance):
                out += errors(item, schema["items"], root, f"{path}[{i}]")
    return out


SCENARIO_SUFFIX = re.compile(r"_(STD|HR)$", re.I)


def _completeness_rule(where, cat, c, missing_count):
    out = []
    status, complete = c.get("status"), c.get("complete")
    if status == "incomplete" and c.get("total") is not None:
        out.append(f"{where}.completeness.{cat}: status 'incomplete' must not carry total; use lower_bound")
    if complete is not None and complete != (status == "complete"):
        out.append(f"{where}.completeness.{cat}: complete={complete} contradicts status={status}")
    if status == "complete":
        if c.get("contribution_coverage") is None:
            out.append(f"{where}.completeness.{cat}: total without breakdown/verified coverage must be 'unknown', not 'complete'")
        elif c["contribution_coverage"] < 1 or missing_count:
            out.append(f"{where}.completeness.{cat}: 'complete' requires contribution_coverage=1 and no missing items")
    return out


def manifest_rules(m):
    out = []
    model = m.get("model", {})
    if not (model.get("sha256") or model.get("source_sha256")):
        out.append("model: give sha256 (Aspen model file) or source_sha256 (source data file)")
    ids = [s["id"] for s in m.get("scenarios", [])]
    if len(set(ids)) != len(ids):
        out.append("scenarios: duplicate id")
    if m.get("default_scenario") not in ids:
        out.append("default_scenario must be one of scenarios[].id")
    suffix = re.compile(r"_(" + "|".join(map(re.escape, ids + ["STD", "HR"])) + r")$", re.I) if ids else SCENARIO_SUFFIX
    seen = set()
    for c in m.get("cases", []):
        where = f"cases[{c.get('id')}/{c.get('scenario')}]"
        key = (c.get("id"), c.get("scenario"))
        if key in seen:
            out.append(f"{where}: duplicate case identity (id, scenario)")
        seen.add(key)
        if ids and c.get("scenario") not in ids:
            out.append(f"{where}: scenario not declared in scenarios")
        if c.get("has_results") is False and "file" in c:
            out.append(f"{where}: has_results=false must not reference a five-table file")
        if c.get("has_results") is True and "file" not in c:
            out.append(f"{where}: has_results=true requires the five-table file")
        gwp_incomplete = any(k.upper().startswith("GWP") and v.get("status") == "incomplete"
                             for k, v in (c.get("completeness") or {}).items())
        if gwp_incomplete and (c.get("kpi") or {}).get("gwp_per_fu") is not None:
            out.append(f"{where}: kpi.gwp_per_fu must be null while a GWP category is 'incomplete'")
        for section in ("kpi", "case_params", "completeness"):
            for k in (c.get(section) or {}):
                if suffix.search(k):
                    out.append(f"{where}.{section}.{k}: scenario-suffixed field; use one case per scenario instead")
        for cat, comp in (c.get("completeness") or {}).items():
            out += _completeness_rule(where, cat, comp, comp.get("missing_count", 0))
    return out


def results_rules(r):
    out = []
    for c in r.get("cases", []):
        where = f"cases[{c.get('case')}/{c.get('scenario')}]"
        for cat, comp in (c.get("completeness") or {}).items():
            out += _completeness_rule(where, cat, comp, len(comp.get("missing", [])))
    return out


RULES = {"manifest": manifest_rules, "results": results_rules}


def validate(instance, name: str) -> None:
    """Raise ValueError listing every violation of schemas/<name>.schema.json (+ semantic rules)."""
    problems = errors(instance, load_schema(name))
    if not problems and name in RULES:
        problems = RULES[name](instance)
    if problems:
        raise ValueError(f"{name}: " + "; ".join(problems[:20]) + (" …" if len(problems) > 20 else ""))
