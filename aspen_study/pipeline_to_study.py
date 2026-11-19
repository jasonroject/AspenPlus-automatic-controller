"""Convert the archived HTL ``pipeline.json`` (+ native observations) into an aspen-study/2 package.

``pipeline.json`` is *not* a per-case Aspen result set: it is a frozen GP surrogate
(4,941-cell prediction grid, robustness scenarios, validation evidence) plus a native
reference ledger. The converter therefore produces

* ``manifest.json``            aspen-study/2 entry point (variables, gates, case index, shard paths)
* ``cases/<id>.json``          one *stub* five-table project per native case (the source has no
                               stream/block/inventory tables; only product/feed rate are known)
* ``results/<id>.json``        aspen-results/1 shard per native case (missing data -> null/empty,
                               unknown gates -> ``not_run``; nothing is invented)
* ``results/summary.json``     all cases (same schema)
* ``surrogate/grid.json``      prediction grid, columnar
* ``surrogate/robustness-<S>.json``  robustness candidates per scenario
* ``meta.json``                everything else in pipeline.json (accounting, training, validation, ...)
* ``observations.json``        the native observation ledger (pipeline-observations.json, verbatim)

``reassemble()`` is the exact inverse for pipeline.json / observations, which the tests use to
prove nothing was lost.  Every written JSON file is validated with ``jsonschema`` against the
schemas in ``aspen_study/schemas`` where a schema exists.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
from pathlib import Path

SCHEMA_DIR = Path(__file__).resolve().with_name("schemas")
GRID_KEYS = {"temperature_step_C", "length_step_m", "rows"}
PRIMARY = "HR"      # scenario shown by pipeline.js by default; STD is kept as *_STD extras
SCENARIOS = ("STD", "HR")
GATE_IDS = ["G0_identity", "G1_converged", "G1_warnings", "G2_completeness", "G3_balance", "G4_roles", "G5_factors"]
ALLOCATION_MISSING = "not stated in pipeline.json"
FACTOR_SOURCE_MISSING = "not stated in pipeline.json (archived fixed-background accounting)"


def _validator(name):
    from jsonschema import Draft202012Validator  # imported lazily: reassemble()/read() need no jsonschema
    schema = json.loads((SCHEMA_DIR / f"{name}.schema.json").read_text(encoding="utf-8"))
    return Draft202012Validator(schema)


def validate(instance, name, where=""):
    errs = sorted(_validator(name).iter_errors(instance), key=lambda e: list(e.absolute_path))
    if errs:
        msg = "; ".join(f"{'/'.join(map(str, e.absolute_path)) or '<root>'}: {e.message[:200]}" for e in errs[:8])
        raise ValueError(f"{where or name} violates {name} schema: {msg}")


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


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
    factor_ids = [k for k in acc if k in ("fixed_feed_GWP", "electricity_beta", "wastewater_gamma", "CO2_factor", "CH4_factor")]
    return {
        "functional_unit": "1 kg target (CAT + o-cresol at reactor outlet)",
        "system_boundary": f"{pipeline.get('scope', '')} {acc.get('scope', '')}".strip(),
        "allocation": ALLOCATION_MISSING,
        "factor_sources": [{"factor_id": k, "source": FACTOR_SOURCE_MISSING, "year": None} for k in factor_ids],
        "notes": list(pipeline.get("limitations") or []) + [
            "Per-case contributions, energy_edges, balance tables and roles are not part of pipeline.json; they are left empty, not zero.",
            f"Primary scenario is {PRIMARY}; STD values are carried as *_STD keys in the manifest kpi and by_utility."],
    }


def _case_result(row, cid, pipeline, fresh):
    basis = pipeline.get("basis") or {}
    hours = _num(basis.get("duration_h"))
    energy_unit, gwp_unit = "kWh electricity / kg target", "kg CO2-eq / kg target"
    kwh = {s: _num(row.get(f"{s}_electricity_kWh")) for s in SCENARIOS}
    cf = {s: _num(row.get(f"CF_{s}")) for s in SCENARIOS}
    target = _num(row.get("target_kg_h"))
    per_fu = {s: _div(kwh[s], target) for s in SCENARIOS}
    kpi = {"energy_per_fu": per_fu[PRIMARY], "energy_unit": energy_unit, "gwp_per_fu": cf[PRIMARY], "gwp_unit": gwp_unit,
           "efficiency": _div(target, basis.get("wet_feed_kg")), "max_balance_ratio": None,
           "energy_per_fu_STD": per_fu["STD"], "gwp_per_fu_STD": cf["STD"], "target_kg_h": target}
    params = {"temperature_C": _num(row.get("temperature_C")), "length_m": _num(row.get("length_m")), "split": row.get("split")}
    warnings = list(fresh.get("warnings") or []) if fresh else []
    has_fresh = bool(fresh)
    gates = []
    for gid in GATE_IDS:
        status, messages = "not_run", ["not available in pipeline.json"]
        if has_fresh and gid == "G0_identity":
            status, messages = "pass", [f"source model sha256 {fresh['source_sha256']}"]
        elif has_fresh and gid == "G1_converged":
            ok = bool(fresh.get("completed")) and bool(fresh.get("accepted"))
            status, messages = ("pass" if ok else "fail"), [f"completed={fresh.get('completed')}, accepted={fresh.get('accepted')}"]
        elif has_fresh and gid == "G1_warnings":
            status, messages = ("warn" if warnings else "pass"), warnings or ["no warnings recorded"]
        elif has_fresh and gid == "G3_balance":
            messages = [f"source reports mass_residual_kg_h={fresh.get('mass_residual_kg_h')}, "
                        f"chem_element_max_relative_residual={fresh.get('chem_element_max_relative_residual')}, "
                        f"max_block_energy_residual_kW={fresh.get('max_block_energy_residual_kW')} but no tolerances or per-block table"]
        gates.append({"id": gid, "status": status, "messages": messages})
    status = "accepted_with_warnings" if warnings else "accepted"
    gwp = {}
    for s in SCENARIOS:
        gwp[f"GWP_{s}"] = {"complete": cf[s] is not None, "mass_coverage": None, "contribution_coverage": None,
                           "missing": [], "lower_bound": None, "total": cf[s], "unit": gwp_unit}
    by_utility = {f"electricity_{s}": kwh[s] / hours for s in SCENARIOS if kwh[s] is not None and hours}
    result = {"case": cid, "status": status, "case_params": params, "gates": gates,
              "energy": {"hot_utility_kW": None, "cold_utility_kW": None,
                         "electricity_kW": by_utility.get(f"electricity_{PRIMARY}"), "by_utility": by_utility,
                         "intensity": per_fu[PRIMARY], "intensity_unit": energy_unit},
              "energy_edges": [], "internal_loops": [], "balance": [], "completeness": gwp}
    if warnings:
        result["warnings"] = warnings
    summary = {k: {"complete": v["complete"], "mass_coverage": None, "contribution_coverage": None,
                   "missing_count": 0, "lower_bound": None} for k, v in gwp.items()}
    return result, kpi, status, summary


def _case_stub(row, cid, pipeline):
    basis = pipeline.get("basis") or {}
    hours = _num(basis.get("duration_h"))
    feed = _div(basis.get("wet_feed_kg"), hours)
    entry = {"id": cid, "mass_unit": "kg/h", "source": "pipeline.json basis + native observation"}
    if _num(row.get("target_kg_h")) is not None:
        entry["product_rate"] = row["target_kg_h"]
    if feed is not None:
        entry["feed_rate"] = feed
    return {"schema_version": 1,
            "meta": {"name": cid, "steady_state": True, "functional_unit": "1 kg target (CAT + o-cresol)",
                     "boundary": (pipeline.get("accounting") or {}).get("scope", ""),
                     "calorie_J": 4.1868, "inventory_complete": False, "comparable_cases": False},
            "cases": [entry], "streams": [], "blocks": [], "inventory": [], "factors": []}


def convert(pipeline, observations, study_id=None):
    """Return {relative path: JSON-serialisable object}. Inputs are not modified."""
    pipeline, observations = copy.deepcopy(pipeline), copy.deepcopy(observations)
    study_id = study_id or str(pipeline.get("version") or "htl-study")
    model_sha = _model_sha(pipeline)  # fail early: a package without model identity is not published
    files, taken = {}, set()
    grid = pipeline["grid"]
    columns = list(grid["rows"][0]) if grid["rows"] else []
    if any(list(r) != columns for r in grid["rows"]):
        raise ValueError("grid rows do not share one column order")
    files["surrogate/grid.json"] = {"temperature_step_C": grid["temperature_step_C"], "length_step_m": grid["length_step_m"],
                                    "columns": columns, "data": [[r[c] for c in columns] for r in grid["rows"]]}
    robustness = pipeline.get("robustness")
    surrogate = ["surrogate/grid.json"]
    meta_robustness = None
    if robustness is not None:
        meta_robustness = {k: v for k, v in robustness.items() if k != "scenarios"}
        for scenario, rows in robustness["scenarios"].items():
            path = f"surrogate/robustness-{scenario}.json"
            files[path] = {"scenario": scenario, "rows": rows}
            surrogate.append(path)
    meta = {k: v for k, v in pipeline.items() if k not in ("grid", "robustness")}
    meta["robustness"] = meta_robustness
    meta["grid"] = {k: v for k, v in grid.items() if k in ("temperature_step_C", "length_step_m")}
    files["meta.json"] = meta
    files["observations.json"] = observations

    fresh_by_key = {(r["temperature_C"], r["length_m"]): r for r in pipeline.get("fresh_runs") or [] if "temperature_C" in r and "length_m" in r}
    method = _method(pipeline)
    cases, results, worst = [], [], {}
    order = ["pass", "not_run", "warn", "fail"]
    for row in observations["rows"]:
        cid = _case_id(row, taken)
        fresh = fresh_by_key.get((row["temperature_C"], row["length_m"])) if row.get("source") == "fresh_comparison" else None
        result, kpi, status, comp = _case_result(row, cid, pipeline, fresh)
        shard = {"schema": "aspen-results/1", "study_id": study_id, "method": method, "cases": [result], "contributions": []}
        files[f"results/{cid}.json"] = shard
        files[f"cases/{cid}.json"] = _case_stub(row, cid, pipeline)
        results.append(result)
        for g in result["gates"]:
            if order.index(g["status"]) > order.index(worst.get(g["id"], "pass")):
                worst[g["id"]] = g["status"]
            worst.setdefault(g["id"], g["status"])
        cases.append({"id": cid, "file": f"cases/{cid}.json", "result": f"results/{cid}.json", "status": status,
                      "case_params": result["case_params"], "kpi": kpi, "completeness": comp})
    files["results/summary.json"] = {"schema": "aspen-results/1", "study_id": study_id, "method": method,
                                     "cases": results, "contributions": []}
    bounds = pipeline.get("bounds") or {}
    variables = [{"id": "temperature_C", "label": "Temperature", "unit": "°C"}, {"id": "length_m", "label": "Tube length", "unit": "m"}]
    for v in variables:
        if len(bounds.get(v["id"]) or []) == 2:
            v["min"], v["max"] = bounds[v["id"]]
    manifest = {"schema": "aspen-study/2", "study_id": study_id,
                "title": "HTL reference GP + native reference cases (converted from archived pipeline.json)",
                "model": {"sha256": model_sha, "simulator": "Aspen Plus"},
                "contract": {"project_schema": 1, "results_schema": "aspen-results/1"},
                "functional_unit": method["functional_unit"], "variables": variables, "gates": worst, "cases": cases,
                "shards": {"summary": "results/summary.json", "surrogate": surrogate,
                           "extra": {"meta": "meta.json", "observations": "observations.json"}}}
    files["manifest.json"] = manifest
    check(files)
    return files


def check(files):
    """Validate every file that has a schema, plus path hygiene and internal references."""
    validate(files["manifest.json"], "manifest", "manifest.json")
    for path, value in files.items():
        if path.startswith("results/"):
            validate(value, "results", path)
        elif path.startswith("cases/"):
            validate(value, "case", path)
    m = files["manifest.json"]
    refs = [c[k] for c in m["cases"] for k in ("file", "result")] + [m["shards"]["summary"]] + m["shards"].get("surrogate", []) \
        + list(m["shards"].get("extra", {}).values())
    missing = [r for r in refs if r not in files]
    if missing:
        raise ValueError(f"manifest references missing files: {missing}")


def write(out_dir, files):
    """Write files compactly; fill case ``bytes``/``sha256`` (of cases/<id>.json) into the manifest."""
    out = Path(out_dir)
    for path, value in files.items():
        if path == "manifest.json":
            continue
        target = out / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(dumps(value) + "\n", encoding="utf-8", newline="\n")
    manifest = copy.deepcopy(files["manifest.json"])
    for case in manifest["cases"]:
        data = (out / case["file"]).read_bytes()
        case["bytes"], case["sha256"] = len(data), hashlib.sha256(data).hexdigest()
    validate(manifest, "manifest", "manifest.json")
    (out / "manifest.json").write_text(dumps(manifest) + "\n", encoding="utf-8", newline="\n")
    return manifest


def read(out_dir):
    out = Path(out_dir)
    return {str(p.relative_to(out)).replace("\\", "/"): json.loads(p.read_text(encoding="utf-8")) for p in out.rglob("*.json")}


def reassemble(files):
    """Inverse of convert(): (pipeline, observations) exactly as they were given."""
    m = files["manifest.json"]
    meta = copy.deepcopy(files[m["shards"]["extra"]["meta"]])
    grid_file = files["surrogate/grid.json"]
    grid = dict(meta.pop("grid"))
    grid["rows"] = [dict(zip(grid_file["columns"], row)) for row in grid_file["data"]]
    robustness = meta.pop("robustness")
    pipeline = dict(meta)
    pipeline["grid"] = grid
    if robustness is not None:
        robustness = dict(robustness)
        robustness["scenarios"] = {}
        for path in m["shards"]["surrogate"]:
            if path.startswith("surrogate/robustness-"):
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
    pipeline = json.loads(Path(args.pipeline).read_text(encoding="utf-8"))
    observations = json.loads(Path(args.observations).read_text(encoding="utf-8"))
    files = convert(pipeline, observations, args.study_id)
    manifest = write(args.out, files)
    sizes = {p: (Path(args.out) / p).stat().st_size for p in files}
    print(f"wrote {len(files)} files to {args.out}; manifest {sizes['manifest.json']} B, "
          f"grid {sizes['surrogate/grid.json']} B, cases {len(manifest['cases'])}")


if __name__ == "__main__":
    main()
