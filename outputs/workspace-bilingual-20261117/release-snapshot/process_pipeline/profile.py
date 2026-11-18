"""Validate declarative profiles and bounded scan plans without starting Aspen."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import re


SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\Z")
INPUT_PATH = re.compile(r"\\Data\\(?:Blocks|Streams)\\[^\\]+\\Input\\.+\Z")
MAX_CASES = 100


def finite(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label}: a finite JSON number is required")
    return value


def identifier(value, label):
    if not isinstance(value, str) or not SAFE_ID.fullmatch(value) or ".." in value:
        raise ValueError(f"{label}: use a simple unique identifier without paths")
    return value


def text(value, label, allow_empty=False):
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        raise ValueError(f"{label}: text is required")
    return value


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def canonical_hash(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False, allow_nan=False,
                                     separators=(",", ":")).encode("utf-8")).hexdigest()


def model_path(profile, verify=False):
    model = profile["model"]
    path = Path(text(model.get("path"), "model.path"))
    if path.suffix.lower() != ".bkp":
        raise ValueError("Native v1 supports .bkp archives; save an .apw model as a separate .bkp in Aspen first")
    expected = model.get("sha256", "")
    if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise ValueError("model.sha256 must be the archive's lowercase SHA-256")
    if verify:
        if not path.is_absolute():
            raise ValueError("Native execution requires an absolute model path; supply --model for a portable profile")
        if not path.is_file():
            raise ValueError(f"Model archive is unavailable: {path}")
        if digest(path) != expected:
            raise ValueError("Model archive hash differs from the declared profile; no document was opened")
    return path.resolve() if path.is_absolute() else path


def _node_path(value, label, writable=False):
    text(value, label)
    if not value.startswith("\\Data\\") or ".." in value or any(ord(c) < 32 for c in value):
        raise ValueError(f"{label}: expected an explicit Aspen Data node path")
    if writable and not INPUT_PATH.fullmatch(value):
        raise ValueError(f"{label}: writes are allowed only to explicitly whitelisted Blocks/Streams Input nodes")


def _quantity(spec, readouts, label, depth=0):
    if depth > 6 or not isinstance(spec, dict):
        raise ValueError(f"{label}: invalid or overly nested quantity mapping")
    kinds = [k for k in ("readout", "constant", "sum", "positive", "scale") if k in spec]
    if len(kinds) != 1:
        raise ValueError(f"{label}: select exactly one readout, constant, sum, positive or scale mapping")
    kind = kinds[0]
    allowed = {"readout": {"readout"}, "constant": {"constant", "unit", "source"},
               "sum": {"sum", "source"}, "positive": {"positive", "source"},
               "scale": {"scale", "quantity", "source"}}[kind]
    if set(spec) - allowed:
        raise ValueError(f"{label}: unsupported quantity fields; executable expressions are not supported")
    if kind == "readout":
        if spec[kind] not in readouts:
            raise ValueError(f"{label}: unknown readout {spec[kind]}")
        return
    text(spec.get("source"), label + ".source")
    if kind == "constant":
        finite(spec[kind], label + ".constant")
        text(spec.get("unit"), label + ".unit")
    elif kind == "sum":
        if not isinstance(spec[kind], list) or not 1 <= len(spec[kind]) <= 100:
            raise ValueError(f"{label}: a sum needs 1–100 explicit terms")
        for index, item in enumerate(spec[kind]):
            _quantity(item, readouts, f"{label}.sum[{index}]", depth + 1)
    elif kind == "positive":
        _quantity(spec[kind], readouts, label + ".positive", depth + 1)
    else:
        finite(spec[kind], label + ".scale")
        _quantity(spec.get("quantity"), readouts, label + ".quantity", depth + 1)


def validate_profile(profile, verify_model=False):
    if not isinstance(profile, dict) or type(profile.get("profile_version")) is not int or profile["profile_version"] != 1:
        raise ValueError("Expected profile_version 1")
    identifier(profile.get("id"), "profile.id")
    text(profile.get("name"), "profile.name")
    if "review" in profile and (not isinstance(profile["review"], dict) or profile["review"].get("state") != "reviewed"):
        raise ValueError("Profile is an incomplete draft or has an unknown review state; review mappings before setting state to reviewed")
    if not isinstance(profile.get("model"), dict):
        raise ValueError("model path and hash are required")
    model_path(profile, verify=verify_model)
    variables = profile.get("variables")
    readouts = profile.get("readouts")
    if not isinstance(variables, list) or not 1 <= len(variables) <= 20:
        raise ValueError("Declare 1–20 explicit numeric input variables")
    if not isinstance(readouts, list) or not 1 <= len(readouts) <= 5000:
        raise ValueError("Declare 1–5,000 output readouts")
    for items, kind in ((variables, "variable"), (readouts, "readout")):
        ids, paths = set(), set()
        for item in items:
            ident = identifier(item.get("id"), kind + ".id")
            path = item.get("path")
            _node_path(path, kind + ".path", writable=kind == "variable")
            if ident in ids or path in paths:
                raise ValueError(f"Duplicate {kind} ID or node path: {ident}")
            ids.add(ident); paths.add(path)
            text(item.get("native_unit"), kind + ".native_unit", allow_empty=True)
            if kind == "variable":
                lo, hi = finite(item.get("min"), ident + ".min"), finite(item.get("max"), ident + ".max")
                if lo >= hi:
                    raise ValueError(f"{ident}: min must be below max")
    variable_map = {item["id"]: item for item in variables}
    control_ids = set(variable_map)
    control_paths = {item["path"] for item in variables}
    for field in ("linked_inputs", "fixed_inputs"):
        entries = profile.get(field, [])
        if not isinstance(entries, list) or len(entries) > 100:
            raise ValueError(f"{field}: expected at most 100 explicitly reviewed controls")
        for item in entries:
            allowed = {"id", "path", "native_unit", "source", "source_id" if field == "linked_inputs" else "value"}
            if not isinstance(item, dict) or set(item) - allowed:
                raise ValueError(f"{field}: unsupported fields; expressions and conversions are not supported")
            ident = identifier(item.get("id"), field + ".id")
            path = item.get("path")
            _node_path(path, field + ".path", writable=True)
            text(item.get("native_unit"), field + ".native_unit", allow_empty=True)
            if ident in control_ids or path in control_paths:
                raise ValueError("Independent, linked and fixed controls require unique IDs and paths")
            control_ids.add(ident); control_paths.add(path)
            if field == "linked_inputs":
                source = variable_map.get(item.get("source_id"))
                if source is None or item["native_unit"] != source["native_unit"]:
                    raise ValueError("Linked input must reference an independent variable with the exact same native unit")
            else:
                finite(item.get("value"), ident + ".value")
    checks = profile.get("solver_checks")
    if not isinstance(checks, list) or not checks:
        raise ValueError("Explicit native solver completion checks are required; control success alone is insufficient")
    for check in checks:
        _node_path(check.get("path"), "solver check path")
        text(check.get("label"), "solver check label")
        accepted = check.get("accepted_values")
        if not isinstance(accepted, list) or not accepted or any(not isinstance(v, (str, int, float)) or isinstance(v, bool) for v in accepted):
            raise ValueError("A solver check requires explicit numeric or text accepted_values")
        for value in accepted:
            if isinstance(value, (int, float)):
                finite(value, "solver check accepted value")
    mapping = profile.get("mapping")
    if not isinstance(mapping, dict):
        raise ValueError("An explicit five-table mapping is required")
    meta = mapping.get("meta", {})
    if meta.get("steady_state") is not True:
        raise ValueError("Native v1 analysis requires a declared steady-state basis")
    for field in ("name", "boundary", "functional_unit", "allocation_method", "enthalpy_basis"):
        text(meta.get(field), "meta." + field)
    if not re.match(r"^1\s+kg(?:\s|$)", meta["functional_unit"], re.I):
        raise ValueError("functional_unit must begin with 1 kg")
    for field in ("inventory_complete", "comparable_cases"):
        if not isinstance(meta.get(field), bool):
            raise ValueError(f"meta.{field} must be explicitly true or false")
    if meta.get("calorie_J") not in (None, 4.184, 4.1868):
        raise ValueError("calorie_J must be null, 4.184 or 4.1868")
    product = mapping.get("product", {})
    _quantity(product.get("quantity"), {r["id"] for r in readouts}, "product.quantity")
    _quantity(product.get("feed"), {r["id"] for r in readouts}, "product.feed")
    allocation = finite(product.get("allocation"), "product.allocation")
    if not 0 <= allocation <= 1:
        raise ValueError("product.allocation must be in [0,1]")
    text(product.get("source"), "product.source")
    for field in ("streams", "blocks", "inventory", "factors"):
        if not isinstance(mapping.get(field), list):
            raise ValueError(f"mapping.{field} must be an explicit array")
    if not mapping["streams"] or not mapping["blocks"]:
        raise ValueError("Explicit stream topology and block duty mappings are required")
    block_ids = set()
    for block in mapping["blocks"]:
        name = text(block.get("id"), "block.id")
        if name in block_ids or name == "BOUNDARY":
            raise ValueError("Duplicate or reserved block ID")
        block_ids.add(name)
    readout_ids = {r["id"] for r in readouts}
    for kind in ("streams", "blocks", "inventory"):
        ids = set()
        for row in mapping[kind]:
            ident = text(row.get("id"), kind + ".id")
            if ident in ids:
                raise ValueError(f"Duplicate {kind} ID: {ident}")
            ids.add(ident)
            if kind == "streams":
                if row.get("from") not in block_ids | {"BOUNDARY"} or row.get("to") not in block_ids | {"BOUNDARY"} or row["from"] == row["to"]:
                    raise ValueError(f"Stream {ident}: declare different known from/to blocks or BOUNDARY")
                _quantity(row.get("mass"), readout_ids, ident + ".mass")
                forms = [field for field in ("enthalpy", "specific_enthalpy") if field in row]
                if len(forms) != 1:
                    raise ValueError(f"Stream {ident}: supply one total enthalpy or mass-specific enthalpy mapping")
                _quantity(row[forms[0]], readout_ids, ident + "." + forms[0])
            elif kind == "blocks":
                for field in ("heat", "power"):
                    _quantity(row.get(field), readout_ids, ident + "." + field)
                text(row.get("source"), ident + ".source")
            else:
                _quantity(row.get("quantity"), readout_ids, ident + ".quantity")
                if row.get("kind") not in ("energy", "material", "emission", "waste"):
                    raise ValueError(f"Inventory {ident}: invalid kind")
                text(row.get("factor_id"), ident + ".factor_id")
                text(row.get("source"), ident + ".source")
    factor_keys = set()
    category_definitions = {}
    for factor in mapping["factors"]:
        for field in ("id", "category", "denominator_unit", "impact_unit", "method", "source"):
            text(factor.get(field), "factor." + field)
        key = (factor["id"], factor["category"])
        if key in factor_keys:
            raise ValueError("Duplicate factor ID/category pair")
        factor_keys.add(key)
        mode = finite(factor.get("value"), "factor.value")
        low = finite(factor.get("low", mode), "factor.low")
        high = finite(factor.get("high", mode), "factor.high")
        if not 0 <= low <= mode <= high:
            raise ValueError("Factor inputs require 0 <= low <= value <= high; credits are not supported")
        definition = (factor["impact_unit"], factor["method"])
        if factor["category"] in category_definitions and category_definitions[factor["category"]] != definition:
            raise ValueError("Each impact category needs one consistent method and impact unit")
        category_definitions[factor["category"]] = definition
    limits = profile.get("limits", {})
    maximum = limits.get("max_cases", MAX_CASES)
    timeout = limits.get("timeout_seconds", 1200)
    if isinstance(maximum, bool) or not isinstance(maximum, int) or not 1 <= maximum <= MAX_CASES:
        raise ValueError("max_cases must be an integer from 1 to 100")
    finite(timeout, "timeout_seconds")
    if not 1 <= timeout <= 3600:
        raise ValueError("timeout_seconds must be from 1 to 3600")
    return profile


def controls_for_point(profile, parameters):
    """Expand only identity links and explicit constants into one write whitelist."""
    variables = {item["id"]: item for item in profile["variables"]}
    specs = list(profile["variables"])
    values = dict(parameters)
    for linked in profile.get("linked_inputs", []):
        source = variables[linked["source_id"]]
        specs.append({**linked, "min": source["min"], "max": source["max"]})
        values[linked["id"]] = parameters[linked["source_id"]]
    for fixed in profile.get("fixed_inputs", []):
        specs.append({**fixed, "min": fixed["value"], "max": fixed["value"]})
        values[fixed["id"]] = fixed["value"]
    return specs, values


def validate_plan(plan, profile):
    validate_profile(profile)
    if not isinstance(plan, dict) or type(plan.get("plan_version")) is not int or plan["plan_version"] != 1:
        raise ValueError("Expected plan_version 1")
    if plan.get("profile_id") != profile["id"] or plan.get("model_sha256") != profile["model"]["sha256"]:
        raise ValueError("Plan profile ID/model hash mismatch")
    points = plan.get("points")
    if not isinstance(points, list) or not 1 <= len(points) <= profile.get("limits", {}).get("max_cases", MAX_CASES):
        raise ValueError("Plan exceeds the declared bounded case count")
    variables = {v["id"]: v for v in profile["variables"]}
    ids = set()
    for point in points:
        ident = identifier(point.get("id"), "point.id")
        if ident in ids:
            raise ValueError(f"Duplicate point ID: {ident}")
        ids.add(ident)
        if point.get("split") not in ("training", "holdout", "verification"):
            raise ValueError(f"{ident}: declare training, holdout or verification split before running")
        parameters = point.get("parameters")
        if not isinstance(parameters, dict) or set(parameters) != set(variables):
            raise ValueError(f"{ident}: provide exactly the whitelisted input variables")
        for name, value in parameters.items():
            finite(value, ident + "." + name)
            if not variables[name]["min"] <= value <= variables[name]["max"]:
                raise ValueError(f"{ident}.{name}: value outside the declared native-unit range")
    return plan


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))

