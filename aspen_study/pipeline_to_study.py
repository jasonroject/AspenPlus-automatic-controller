"""Convert the archived HTL ``pipeline.json`` (+ native observations) into an aspen-study/2 package.

``pipeline.json`` is *not* a per-case Aspen result set: it is a frozen GP surrogate (prediction grid,
robustness scenarios, validation evidence) plus a native reference ledger. Output layout
(schema versions of 2026-11-19, ``feat/generic-aspen-study`` @ 2e3d977):

* ``manifest.json``                aspen-study/2 entry point: scenarios, case index (one record per
                                   case *and scenario*), shard paths
* ``results/<id>.json``            aspen-results/1 shard, default-scenario record; other scenarios in
  ``results/<id>__<S>.json``       ``results/<id>__<scenario>.json``. Only cases with real gate evidence
                                   (the three fresh verification runs) get gate-verdict shards,
                                   referenced from the case's ``evidence`` (+ optional ``result``). These are
                                   not five-table results: every record has ``has_results=false`` (no ``file``).
* ``results/summary.json``         the same records, all in one file
* ``factors.json``                 aspen-factors-snapshot/1: the accounting coefficients (values live only here
                                   and in ``surrogate/details.json``; results reference ``factor_id``)
* ``surrogate/surrogate.json``     aspen-surrogate/1 descriptor (inputs, targets, split, metrics, provenance)
* ``surrogate/grid.json``          prediction grid, columnar
* ``surrogate/robustness-<S>.json``  robustness candidates per scenario
* ``surrogate/details.json``       every other pipeline.json field (training, validation integrity, ...)
* ``observations.json``            the native observation ledger (pipeline-observations, verbatim)

There are no five-table ``cases/*.json`` files: pipeline.json holds no stream/block/inventory data.
Missing source data is ``null`` / ``[]`` / ``not_run`` / completeness ``unknown`` - never 0.
``reassemble()`` is the exact inverse for pipeline.json and the observations.

Validation: every written JSON file with a schema goes through ``schema_check.validate`` (schema plus
the cross-field rules BRO maintains) and, when installed, ``jsonschema`` (draft 2020-12).
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
from pathlib import Path

from .schema_check import SCHEMA_DIR, validate as repo_validate

DEFAULT_SCENARIO = "HR"      # scenario the Process Studio page shows first
SCENARIOS = [{"id": "HR", "label": "Heat recovery (HR)", "description": "HR flowsheet; heater duty from the native run"},
             {"id": "STD", "label": "Standard heating (STD)", "description": "No heat recovery; preheat duty reconstructed from the HR run's boundary"}]
GATE_IDS = ["G0_identity", "G1_converged", "G1_warnings", "G2_completeness", "G3_balance", "G4_roles", "G5_factors"]
ALLOCATION_NOTE = "pipeline.json does not state an allocation method; left null rather than assumed"
# observation split -> schema enum. 'extremum_check' has no unambiguous equivalent (not stated whether those three
# native points were fitted), so it is left unset; the original value stays in observations.json.
SPLIT_MAP = {"train": "train", "holdout": "test", "fresh_verification": "fresh"}
CATEGORY = "GWP"             # source says "GWP"/"climate"; no characterisation horizon is stated
ENERGY_UNIT, GWP_UNIT = "kWh electricity / kg target", "kg CO2-eq / kg target"
STD_NOTE = "STD electricity is reconstructed from the HR native run's no-heat-recovery preheat boundary, not an independent flowsheet run"
# Units of the accounting coefficients are not stored in pipeline.json; they come from htl_pipeline/README.md
# (formula) and analysis_web/data/universal-htl.json (factors table). id -> (denominator unit, impact unit, note)
FACTOR_UNITS = {
    "fixed_feed_GWP": ("100 kg wet feed (1 h basis)", "kg CO2-eq", "Fixed background term of the HTL climate formula"),
    "electricity_beta": ("kWh", "kg CO2-eq", "Heat is counted as equivalent electricity (unity conversion)"),
    "wastewater_gamma": ("m3 wastewater (water kg / 1000)", "kg CO2-eq", "Inherited volume approximation: water mass / 1000"),
    "CO2_factor": ("kg CO2", "kg CO2-eq", "Direct emission"),
    "CH4_factor": ("kg CH4", "kg CO2-eq", "Direct emission"),
}
FACTOR_SOURCE = "pipeline.json accounting: fixed original background providers (not a fresh openLCA calculation)"


def _jsonschema_validator(name):
    from jsonschema import Draft202012Validator  # lazy: reassemble()/read() need no jsonschema
    schema = json.loads((SCHEMA_DIR / f"{name}.schema.json").read_text(encoding="utf-8"))
    return Draft202012Validator(schema)


def validate(instance, name, where=""):
    """repo validator (schema + cross-field rules), then jsonschema if available."""
    try:
        repo_validate(instance, name)
    except ValueError as exc:
        raise ValueError(f"{where or name}: {exc}") from None
    try:
        validator = _jsonschema_validator(name)
    except ImportError:
        return
    errs = sorted(validator.iter_errors(instance), key=lambda e: list(e.absolute_path))
    if errs:
        msg = "; ".join(f"{'/'.join(map(str, e.absolute_path)) or '<root>'}: {e.message[:200]}" for e in errs[:8])
        raise ValueError(f"{where or name} violates {name} schema (jsonschema): {msg}")


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def canonical_sha256(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()


def _num(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _div(a, b):
    a, b = _num(a), _num(b)
    return a / b if a is not None and b not in (None, 0) else None


def _fmt(value):
    whole = int(value)
    return f"{whole}p{round((value - whole) * 100):02d}"


def _case_id(row, taken):
    if row.get("source") == "fresh_comparison":   # source_record is only a list index here
        stem = f"fresh_T{_fmt(row['temperature_C'])}_L{_fmt(row['length_m'])}"
    else:
        stem = re.sub(r"\.json$", "", re.split(r"[\\/]", row["source_record"] or "")[-1])
    ident = re.sub(r"[^A-Za-z0-9_.-]", "_", stem) or "case"
    if ident in taken:
        raise ValueError(f"duplicate case id {ident!r}")
    taken.add(ident)
    return ident


def _model_sha(pipeline):
    hashes = {r.get("source_sha256") for r in pipeline.get("fresh_runs") or [] if r.get("source_sha256")}
    if len(hashes) != 1:
        raise ValueError(f"expected exactly one source model SHA-256 in fresh_runs, found {sorted(hashes)}")
    return hashes.pop()


def _method(pipeline):
    acc = pipeline.get("accounting") or {}
    ids = [k for k in FACTOR_UNITS if k in acc]
    return {
        "functional_unit": "1 kg target (CAT + o-cresol at reactor outlet)",
        "system_boundary": f"{pipeline.get('scope', '')} {acc.get('scope', '')}".strip(),
        "allocation": None,
        "allocation_note": ALLOCATION_NOTE,
        "factor_sources": [{"factor_id": k, "source": FACTOR_SOURCE, "year": None} for k in ids],
        "factors_snapshot": "factors.json",
        "notes": list(pipeline.get("limitations") or []) + [
            "Per-case contributions, energy_edges, balance tables and roles are not part of pipeline.json; they are left empty, not zero.",
            f"GWP is a total only (no breakdown): completeness is 'unknown'. Default scenario is {DEFAULT_SCENARIO}."],
    }


def _factors_snapshot(pipeline, study_id):
    acc = pipeline.get("accounting") or {}
    factors = []
    for fid, (unit, impact, note) in FACTOR_UNITS.items():
        if _num(acc.get(fid)) is not None:
            factors.append({"id": fid, "category": CATEGORY, "value": acc[fid], "unit": unit, "impact_unit": impact,
                            "method": "Inherited HTL fixed-background climate accounting", "source": FACTOR_SOURCE,
                            "year": None, "status": "archived", "note": note})
    return {"schema": "aspen-factors-snapshot/1", "study_id": study_id, "factors": factors}


def _surrogate_descriptor(pipeline, surrogate_files):
    models = (pipeline.get("training") or {}).get("models") or {}
    kernels = sorted({m.get("kernel") for m in models.values() if m.get("kernel")})
    counts = sorted({m.get("training_count") for m in models.values() if m.get("training_count") is not None})
    cov = pipeline.get("validation_coverage") or {}
    bounds = pipeline.get("bounds") or {}
    inputs = []
    for ident, unit in (("temperature_C", "°C"), ("length_m", "m")):
        item = {"id": ident, "unit": unit}
        if len(bounds.get(ident) or []) == 2:
            item["min"], item["max"] = bounds[ident]
        inputs.append(item)
    columns = list(pipeline["grid"]["rows"][0]) if pipeline["grid"]["rows"] else ["temperature_C", "length_m"]
    units = {"target_kg_h": "kg/h", "STD_electricity_kWh": "kWh", "HR_electricity_kWh": "kWh", "water_kg_h": "kg/h",
             "direct_kgCO2eq_h": "kg CO2-eq/h", "CF_STD": GWP_UNIT, "CF_HR": GWP_UNIT}
    targets = []
    for col in columns:
        if col in ("temperature_C", "length_m"):
            continue
        item = {"id": col, "unit": units.get(col, "")}
        if not item["unit"]:
            del item["unit"]
        if col.startswith(("STD_", "HR_")) or col in ("CF_STD", "CF_HR"):
            item["scenario"] = "STD" if "STD" in col else "HR"
        targets.append(item)
    split = {"method": (pipeline.get("training") or {}).get("selection") or "not stated in pipeline.json"}
    if len(counts) == 1:
        split["training"] = counts[0]
    for key, name in (("holdout", "holdout"), ("fresh", "verification")):
        if isinstance(_num((cov.get(key) or {}).get("expected_in_domain")), (int, float)):
            split[name] = cov[key]["expected_in_domain"]
    data_source = {"description": pipeline.get("scope", "") or "archived native reference runs"}
    sha = (pipeline.get("training") or {}).get("reference_sha256")
    if sha:
        data_source["sha256"] = sha
    if isinstance(pipeline.get("native_reference_count"), int):
        data_source["reference_count"] = pipeline["native_reference_count"]
    descriptor = {"schema": "aspen-surrogate/1",
                  "model_type": "GaussianProcessRegressor (" + ", ".join(kernels) + ")" if kernels else "GaussianProcessRegressor",
                  "prediction_enabled": bool(pipeline.get("prediction_enabled")),
                  "inputs": inputs, "targets": targets, "split": split,
                  "metrics": {"holdout": pipeline.get("holdout_metrics") or {}, "fresh": pipeline.get("fresh_metrics") or {}},
                  "data_source": data_source, "grid_files": ["surrogate/grid.json"],
                  "extra_files": surrogate_extra(surrogate_files),
                  "limitations": list(pipeline.get("limitations") or [])}
    return descriptor


def surrogate_extra(files):
    extra = {"details": "surrogate/details.json"}
    for path in files:
        match = re.fullmatch(r"surrogate/robustness-([A-Za-z0-9_.-]+)\.json", path)
        if match:
            extra[f"robustness_{match.group(1)}"] = path
    return extra


def _case_records(row, cid, pipeline, fresh, scenario):
    """(manifest entry without result paths, result record or None) for one case and scenario."""
    basis = pipeline.get("basis") or {}
    hours = _num(basis.get("duration_h"))
    kwh, cf, target = _num(row.get(f"{scenario}_electricity_kWh")), _num(row.get(f"CF_{scenario}")), _num(row.get("target_kg_h"))
    per_fu = _div(kwh, target)
    params = {"temperature_C": _num(row.get("temperature_C")), "length_m": _num(row.get("length_m"))}
    warnings = list(fresh.get("warnings") or []) if fresh else []
    status = "accepted_with_warnings" if warnings else "accepted"
    completeness = {"status": "unknown", "complete": False, "mass_coverage": None, "contribution_coverage": None,
                    "missing_count": 0, "lower_bound": None}
    entry = {"id": cid, "scenario": scenario, "has_results": False, "source": "aspen" if fresh else "archived",
             "status": status, "case_params": params,
             "kpi": {"energy_per_fu": per_fu, "energy_unit": ENERGY_UNIT, "gwp_per_fu": cf, "gwp_unit": GWP_UNIT,
                     "efficiency": _div(target, basis.get("wet_feed_kg")), "max_balance_ratio": None, "target_kg_h": target},
             "completeness": {CATEGORY: {**completeness, "total": cf}}}
    if SPLIT_MAP.get(row.get("split")):
        entry["split"] = SPLIT_MAP[row["split"]]
    if row.get("source_record") is not None:
        entry["source_record"] = str(row["source_record"])
    if not fresh:
        return entry, None
    gates = []
    for gid in GATE_IDS:
        gstatus, messages = "not_run", ["not available in pipeline.json"]
        if gid == "G0_identity":
            gstatus, messages = "pass", [f"source model sha256 {fresh['source_sha256']}"]
        elif gid == "G1_converged":
            ok = bool(fresh.get("completed")) and bool(fresh.get("accepted"))
            gstatus, messages = ("pass" if ok else "fail"), [f"completed={fresh.get('completed')}, accepted={fresh.get('accepted')}"]
        elif gid == "G1_warnings":
            gstatus, messages = ("warn" if warnings else "pass"), warnings or ["no warnings recorded"]
        elif gid == "G3_balance":
            messages = [f"source reports mass_residual_kg_h={fresh.get('mass_residual_kg_h')}, "
                        f"chem_element_max_relative_residual={fresh.get('chem_element_max_relative_residual')}, "
                        f"max_block_energy_residual_kW={fresh.get('max_block_energy_residual_kW')} but no tolerances or per-block table"]
        gates.append({"id": gid, "status": gstatus, "messages": messages})
    record_completeness = {**completeness, "missing": [], "total": cf, "unit": GWP_UNIT}
    record_completeness.pop("missing_count")
    record = {"case": cid, "scenario": scenario, "status": status, "case_params": params, "gates": gates,
              "energy": {"hot_utility_kW": None, "cold_utility_kW": None,
                         "electricity_kW": kwh / hours if kwh is not None and hours else None,
                         "by_utility": {"electricity": kwh / hours} if kwh is not None and hours else {},
                         "intensity": per_fu, "intensity_unit": ENERGY_UNIT},
              "energy_edges": [], "internal_loops": [], "balance": [], "completeness": {CATEGORY: record_completeness}}
    shown = warnings + ([STD_NOTE] if scenario == "STD" else [])
    if shown:
        record["warnings"] = shown
    return entry, record


def convert(pipeline, observations, study_id=None, source_sha256=None, source_file="outputs/htl_pipeline/pipeline.json"):
    """Return {relative path: JSON-serialisable object}. Inputs are not modified."""
    pipeline, observations = copy.deepcopy(pipeline), copy.deepcopy(observations)
    study_id = study_id or str(pipeline.get("version") or "htl-study")
    model_sha = _model_sha(pipeline)  # fail early: a package without model identity is not published
    source_sha256 = source_sha256 or canonical_sha256(pipeline)
    files, taken = {}, set()
    grid = pipeline["grid"]
    columns = list(grid["rows"][0]) if grid["rows"] else []
    if any(list(r) != columns for r in grid["rows"]):
        raise ValueError("grid rows do not share one column order")
    files["surrogate/grid.json"] = {"temperature_step_C": grid["temperature_step_C"], "length_step_m": grid["length_step_m"],
                                    "columns": columns, "data": [[r[c] for c in columns] for r in grid["rows"]]}
    robustness = pipeline.get("robustness")
    meta_robustness = None
    if robustness is not None:
        meta_robustness = {k: v for k, v in robustness.items() if k != "scenarios"}
        for scenario, rows in robustness["scenarios"].items():
            files[f"surrogate/robustness-{scenario}.json"] = {"scenario": scenario, "rows": rows}
    details = {k: v for k, v in pipeline.items() if k not in ("grid", "robustness")}
    details["robustness"] = meta_robustness
    details["grid"] = {k: v for k, v in grid.items() if k in ("temperature_step_C", "length_step_m")}
    files["surrogate/details.json"] = details
    files["surrogate/surrogate.json"] = _surrogate_descriptor(pipeline, [p for p in files if p.startswith("surrogate/robustness-")])
    files["observations.json"] = observations
    files["factors.json"] = _factors_snapshot(pipeline, study_id)

    fresh_by_key = {(r["temperature_C"], r["length_m"]): r for r in pipeline.get("fresh_runs") or [] if "temperature_C" in r and "length_m" in r}
    method = _method(pipeline)
    cases, records, worst = [], [], {}
    order = ["pass", "not_run", "warn", "fail"]
    for row in observations["rows"]:
        cid = _case_id(row, taken)
        fresh = fresh_by_key.get((row["temperature_C"], row["length_m"])) if row.get("source") == "fresh_comparison" else None
        for scenario in (s["id"] for s in SCENARIOS):
            entry, record = _case_records(row, cid, pipeline, fresh, scenario)
            if record:
                path = f"results/{cid}.json" if scenario == DEFAULT_SCENARIO else f"results/{cid}__{scenario}.json"
                shard = {"schema": "aspen-results/1", "study_id": study_id, "method": method, "cases": [record], "contributions": []}
                files[path] = shard
                entry["result"] = path
                entry["evidence"] = [{"kind": "gate", "file": path, "sha256": file_sha256(shard),
                                      "note": "gate verdicts derived from the fresh-run ledger in pipeline.json; not five-table Aspen results"}]
                records.append(record)
                for g in record["gates"]:
                    if order.index(g["status"]) > order.index(worst.get(g["id"], "pass")):
                        worst[g["id"]] = g["status"]
                    worst.setdefault(g["id"], g["status"])
            cases.append(entry)
    files["results/summary.json"] = {"schema": "aspen-results/1", "study_id": study_id, "method": method, "cases": records, "contributions": []}
    bounds = pipeline.get("bounds") or {}
    variables = [{"id": "temperature_C", "label": "Temperature", "unit": "°C"}, {"id": "length_m", "label": "Tube length", "unit": "m"}]
    for v in variables:
        if len(bounds.get(v["id"]) or []) == 2:
            v["min"], v["max"] = bounds[v["id"]]
    files["manifest.json"] = {
        "schema": "aspen-study/2", "study_id": study_id,
        "title": "HTL reference GP + native reference cases (converted from archived pipeline.json)",
        "model": {"simulator": "Aspen Plus", "version": None, "sha256": model_sha, "source_sha256": source_sha256, "source_file": source_file},
        "contract": {"project_schema": 1, "results_schema": "aspen-results/1"},
        "functional_unit": method["functional_unit"], "variables": variables, "gates": worst,
        "scenarios": copy.deepcopy(SCENARIOS), "default_scenario": DEFAULT_SCENARIO, "cases": cases,
        "shards": {"summary": "results/summary.json", "factors": "factors.json", "surrogate": "surrogate/surrogate.json",
                   "extra": {"observations": "observations.json"}}}
    check(files)
    return files


def file_sha256(value):
    """SHA-256 of the bytes write() produces for this value."""
    return hashlib.sha256((dumps(value) + "\n").encode("utf-8")).hexdigest()


SCHEMA_BY_PATH = [("manifest.json", "manifest"), ("results/", "results"), ("factors.json", "factors-snapshot"),
                  ("surrogate/surrogate.json", "surrogate")]


def check(files):
    """Validate every file that has a schema, plus path hygiene and internal references."""
    for path, value in files.items():
        for prefix, name in SCHEMA_BY_PATH:
            if path == prefix or (prefix.endswith("/") and path.startswith(prefix)):
                validate(value, name, path)
    m = files["manifest.json"]
    descriptor = files[m["shards"]["surrogate"]]
    evidence = [(c, e) for c in m["cases"] for e in c.get("evidence", [])]
    refs = [c["result"] for c in m["cases"] if "result" in c] + [e["file"] for _, e in evidence] + [m["shards"][k] for k in ("summary", "factors", "surrogate")] \
        + list(m["shards"].get("extra", {}).values()) + descriptor["grid_files"] + list(descriptor.get("extra_files", {}).values())
    missing = sorted({r for r in refs if r not in files})
    if missing:
        raise ValueError(f"manifest references missing files: {missing}")
    unreferenced = sorted(set(files) - set(refs) - {"manifest.json"})
    if unreferenced:
        raise ValueError(f"files not referenced by the manifest: {unreferenced}")
    for c, e in evidence:
        if "sha256" in e and file_sha256(files[e["file"]]) != e["sha256"]:
            raise ValueError(f"{c['id']}/{c['scenario']}: evidence {e['file']} does not match its sha256")
    ids = {(c["id"], c["scenario"]) for c in m["cases"]}
    for path, value in files.items():
        if path.startswith("results/") and path != "results/summary.json":
            for rec in value["cases"]:
                if (rec["case"], rec["scenario"]) not in ids:
                    raise ValueError(f"{path}: record {rec['case']}/{rec['scenario']} not in manifest")


def write(out_dir, files):
    """Write all files compactly (and drop stale ones in generated folders)."""
    out = Path(out_dir)
    for folder in ("results", "surrogate", "cases"):
        for old in (out / folder).glob("*.json") if (out / folder).exists() else []:
            old.unlink()
    for path, value in files.items():
        target = out / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(dumps(value) + "\n", encoding="utf-8", newline="\n")
    return files["manifest.json"]


def read(out_dir):
    out = Path(out_dir)
    return {str(p.relative_to(out)).replace("\\", "/"): json.loads(p.read_text(encoding="utf-8")) for p in out.rglob("*.json")}


def reassemble(files):
    """Inverse of convert(): (pipeline, observations) exactly as they were given."""
    m = files["manifest.json"]
    descriptor = files[m["shards"]["surrogate"]]
    extra = descriptor["extra_files"]
    details = copy.deepcopy(files[extra["details"]])
    grid_file = files[descriptor["grid_files"][0]]
    grid = dict(details.pop("grid"))
    grid["rows"] = [dict(zip(grid_file["columns"], row)) for row in grid_file["data"]]
    robustness = details.pop("robustness")
    pipeline = dict(details)
    pipeline["grid"] = grid
    if robustness is not None:
        robustness = dict(robustness)
        robustness["scenarios"] = {}
        for key, path in extra.items():
            if key.startswith("robustness_"):
                shard = files[path]
                robustness["scenarios"][shard["scenario"]] = shard["rows"]
    pipeline["robustness"] = robustness
    return pipeline, copy.deepcopy(files[m["shards"]["extra"]["observations"]])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    root = Path(__file__).resolve().parents[1]
    ap.add_argument("--pipeline", default=str(root / "outputs/htl_pipeline/pipeline.json"))
    ap.add_argument("--observations", default=str(root / "outputs/htl_pipeline/web-observations.json"))
    ap.add_argument("--out", default=str(root / "analysis_web/data/study"))
    ap.add_argument("--study-id")
    args = ap.parse_args(argv)
    source = Path(args.pipeline).read_bytes()
    pipeline = json.loads(source.decode("utf-8"))
    observations = json.loads(Path(args.observations).read_text(encoding="utf-8"))
    try:
        source_file = str(Path(args.pipeline).resolve().relative_to(root)).replace("\\", "/")
    except ValueError:
        source_file = Path(args.pipeline).name
    files = convert(pipeline, observations, args.study_id, hashlib.sha256(source).hexdigest(), source_file)
    manifest = write(args.out, files)
    sizes = {p: len(dumps(v)) + 1 for p, v in files.items()}
    print(f"wrote {len(files)} files to {args.out}; manifest {sizes['manifest.json']} B, grid {sizes['surrogate/grid.json']} B, "
          f"{len(manifest['cases'])} case records ({sum(bool(c.get('result')) for c in manifest['cases'])} with a gate-verdict result shard)")


if __name__ == "__main__":
    main()
