"""Serial copied-model jobs, retained ledgers and offline capture replay."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import json
import math
import re
from pathlib import Path
import shutil
import subprocess
import sys

from .adapter import inspect_document, run_document
from .normalize import normalize_capture, combine_projects
from .profile import canonical_hash, controls_for_point, digest, finite, identifier, model_path, read_json, validate_plan, validate_profile


ROOT = Path(__file__).resolve().parents[1]
BRIDGE = Path(__file__).with_name("assess_project.mjs")
GATES = ("control_succeeded", "solver_accepted", "numerical_closure", "lcia_complete", "metric_inputs_complete")


def now():
    return datetime.now(timezone.utc).isoformat()


def contained(root, path):
    root, path = Path(root).resolve(), Path(path).resolve()
    if path != root and not path.is_relative_to(root):
        raise ValueError("Artifact path escaped the explicit workspace")
    return path


def write_json(root, path, data):
    path = contained(root, path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = contained(root, path.with_name(path.name + ".tmp"))
    temporary.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def new_workspace(path):
    path = Path(path)
    if not path.is_absolute():
        raise ValueError("--output must name an absolute workspace path")
    resolved = path.resolve()
    if resolved.exists() and (not resolved.is_dir() or any(resolved.iterdir())):
        raise ValueError("Use a new or empty output workspace; prior evidence is never overwritten")
    resolved.mkdir(parents=True, exist_ok=True)
    return resolved


def bound_profile(profile, override=None):
    runtime = deepcopy(profile)
    if override is not None:
        actual = Path(override)
        if not actual.is_absolute():
            raise ValueError("--model override must be an absolute path")
        runtime["model"]["path"] = str(actual.resolve())
    validate_profile(runtime, verify_model=True)
    return runtime


def report_messages(text):
    lines = text.splitlines()
    warnings = []
    for index, line in enumerate(lines):
        if "warning" in line.lower() or "severe error" in line.lower():
            warnings.append(line.strip())
            if "completed with warnings:" in line.lower() and index + 1 < len(lines):
                warnings.append(lines[index + 1].strip())
    normalized = re.sub(r"\s+", " ", text.lower())
    rejected = any(marker in normalized for marker in ("status: not converged", "calculations were completed with errors", "severe error"))
    completed = bool(re.search(r"calculations were completed (?:normally|with warnings)\b", normalized))
    return warnings, rejected, completed


def native_case(profile, point, run_dir, model_override=None):
    """Open a private document from a hash-verified archive copy, never the source."""
    runtime = bound_profile(profile, model_override)
    source = model_path(runtime, verify=True)
    run_dir = Path(run_dir).resolve()
    copied = contained(run_dir, run_dir / "input.bkp")
    if copied.exists():
        raise ValueError("Case copy already exists; preserve it and choose a new workspace")
    raw = {"capture_version": 1, "profile_id": profile["id"], "profile_sha256": canonical_hash(profile),
           "model_sha256": profile["model"]["sha256"], "case_id": point["id"], "split": point["split"],
           "parameters": deepcopy(point["parameters"]), "evidence_type": "native_simulation",
           "started_at": now(), "control_succeeded": False, "solver_accepted": False,
           "warnings": [], "physical_validation": False, "source_model_path": str(source),
           "model_copy_path": str(copied), "readouts": {}}
    document = None
    initialized = False
    try:
        run_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, copied)
        if digest(copied) != raw["model_sha256"]:
            raise ValueError("Copied archive hash mismatch")
        import pythoncom
        from aspen_connection import create_aspen_document
        pythoncom.CoInitialize()
        initialized = True
        document = create_aspen_document()
        document.SuppressDialogs = 1
        document.InitFromArchive2(str(copied))
        document.Visible = 0
        document.SuppressDialogs = 1
        raw.update(run_document(document, runtime, point))
        report_path = contained(run_dir, run_dir / "aspen-report.rep")
        try:
            document.Export(2, str(report_path))
            raw["warnings"], rejected, completed = report_messages(report_path.read_text(errors="replace"))
            raw["report_sha256"] = digest(report_path)
            raw["report_available"] = True
            raw["report_completion_accepted"] = completed and not rejected
            if rejected or not completed:
                raw["solver_accepted"] = False
                raw["error"] = "Native report records failure or lacks an explicit accepted completion statement"
        except Exception as error:
            raw["report_available"] = False
            raw["report_error"] = str(error)
            raw["report_completion_accepted"] = False
            raw["solver_accepted"] = False
            raw["error"] = "Native completion report unavailable; solver acceptance cannot be established"
    except Exception as error:
        raw["error"] = f"{type(error).__name__}: {error}"
    finally:
        if document is not None:
            try:
                document.Close(False)
                raw["private_document_closed"] = True
            except Exception as error:
                raw["private_document_closed"] = False
                raw["cleanup_error"] = str(error)
        if initialized:
            pythoncom.CoUninitialize()
        raw["source_sha256_after"] = digest(source)
        raw["source_unchanged"] = raw["source_sha256_after"] == raw["model_sha256"]
        if not raw["source_unchanged"]:
            raw["control_succeeded"] = False
            raw["solver_accepted"] = False
            raw["error"] = "Source archive changed during execution; stop and inspect"
        raw["finished_at"] = now()
        write_json(run_dir, run_dir / "raw.json", raw)
    return raw


def assess_file(workspace, project_path, output_path):
    project_path, output_path = contained(workspace, project_path), contained(workspace, output_path)
    result = subprocess.run(["node", str(BRIDGE), str(project_path), str(output_path)],
                            capture_output=True, text=True, encoding="utf-8", timeout=60, check=False)
    if not output_path.exists():
        raise RuntimeError("Shared assessment bridge failed: " + result.stderr[-2000:])
    return read_json(output_path)


def record_case(profile, point, raw, workspace):
    run_dir = contained(workspace, workspace / "runs" / point["id"])
    gates = {key: False for key in GATES}
    gates["control_succeeded"] = raw.get("control_succeeded") is True
    gates["solver_accepted"] = raw.get("solver_accepted") is True
    record = {"id": point["id"], "split": point["split"], "inputs": point["parameters"],
              "gates": gates, "accepted": False, "source": f"runs/{point['id']}/raw.json",
              "evidence_type": raw.get("evidence_type", "unverified_capture"), "warnings": raw.get("warnings", []),
              "error": raw.get("error"), "metrics": {}, "normalization_complete": False,
              "physical_validation": False}
    project = None
    try:
        if not gates["control_succeeded"] or not gates["solver_accepted"]:
            raise ValueError(record["error"] or "Control/solver gate failed; raw values are not accepted outputs")
        if raw.get("parameters") != point["parameters"] or raw.get("split") != point["split"]:
            raise ValueError("Capture inputs/split differ from the frozen plan")
        actual = raw.get("input_readback_after_run", {})
        controls, requested = controls_for_point(profile, point["parameters"])
        for variable in controls:
            value = actual.get(variable["id"], {})
            actual_value = finite(value.get("value"), variable["id"] + " post-run readback")
            if value.get("unit") != variable["native_unit"] or value.get("path") != variable["path"] or not math.isclose(actual_value, requested[variable["id"]], rel_tol=1e-8, abs_tol=1e-9):
                raise ValueError("Missing or mismatched post-run input evidence: " + variable["id"])
        project = normalize_capture(profile, raw)
        write_json(workspace, run_dir / "project.json", project)
        record["normalization_complete"] = True
        result = assess_file(workspace, run_dir / "project.json", run_dir / "assessment.json")
        if result.get("error"):
            raise ValueError(result["error"])
        case = result["cases"][0]
        for gate in ("numerical_closure", "lcia_complete", "metric_inputs_complete"):
            gates[gate] = case[gate]
        record["metrics"] = case["metrics"]
        record["accepted"] = all(gates.values())
        if not record["accepted"]:
            record["error"] = "Analysis gates failed: " + ", ".join(key for key, value in gates.items() if not value)
    except Exception as error:
        record["error"] = f"{type(error).__name__}: {error}"
    write_json(workspace, run_dir / "case-status.json", record)
    return record, project


def build_dataset(profile, ledger):
    responses = [
        {"id": "purchased_energy_kWh_kg", "unit": "kWh/kg", "direction": "min", "value_domain": "nonnegative"},
        {"id": "yield_fraction", "unit": "1", "direction": "max", "value_domain": "nonnegative"}]
    categories = {}
    for factor in profile["mapping"]["factors"]:
        categories.setdefault(factor.get("category", ""), factor.get("impact_unit", "") + "/kg")
    responses += [{"id": "impact:" + category, "unit": unit, "direction": "min", "value_domain": "nonnegative"} for category, unit in categories.items() if category]
    rows = []
    for case in ledger["cases"]:
        metrics = case.get("metrics", {})
        outputs = {"purchased_energy_kWh_kg": metrics.get("purchased_energy_kWh_kg"), "yield_fraction": metrics.get("yield_fraction")}
        outputs.update({"impact:" + category: metrics.get("impacts", {}).get(category, {}).get("value") for category in categories if category})
        rows.append({key: deepcopy(case[key]) for key in ("id", "split", "inputs", "gates", "accepted", "source", "evidence_type", "error", "warnings")})
        rows[-1]["outputs"] = outputs
    evidence = {row["evidence_type"] for row in rows}
    dataset = {"dataset_version": 1, "profile_id": profile["id"], "profile_sha256": canonical_hash(profile),
               "model_sha256": profile["model"]["sha256"],
               "basis": {key: deepcopy(profile["mapping"]["meta"].get(key)) for key in ("functional_unit", "boundary", "allocation_method", "enthalpy_basis", "calorie_J")},
               "evidence_type": "offline_fixture" if "offline_fixture" in evidence else "native_simulation" if evidence == {"native_simulation"} else "mixed_or_unverified",
               "inputs": [{"id": v["id"], "unit": v["native_unit"], "min": v["min"], "max": v["max"]} for v in profile["variables"]],
               "responses": responses, "rows": rows, "physical_validation": False}
    dataset["dataset_sha256"] = canonical_hash(dataset)
    return dataset


def finish_job(profile, ledger, projects, workspace):
    ledger["finished_at"] = now()
    ledger["accepted_count"] = sum(case["accepted"] for case in ledger["cases"])
    ledger["failed_count"] = len(ledger["cases"]) - ledger["accepted_count"]
    ledger["all_planned_cases_retained"] = len(ledger["cases"]) == ledger["planned_count"]
    omitted = [case["id"] for case in ledger["cases"] if not case["normalization_complete"]]
    combined = combine_projects(profile, projects, omitted)
    combined["meta"]["scan_audit"] = {
        "planned": ledger["planned_count"], "attempted": sum(case.get("attempted", True) for case in ledger["cases"]),
        "solver_accepted": sum(case["gates"]["solver_accepted"] for case in ledger["cases"]),
        "numerically_closed": sum(case["gates"]["numerical_closure"] for case in ledger["cases"]),
        "lcia_complete": sum(case["gates"]["lcia_complete"] for case in ledger["cases"]),
        "accepted": ledger["accepted_count"], "failed": ledger["failed_count"],
        "source_profile_sha256": ledger["profile_sha256"], "model_sha256": ledger["model_sha256"],
        "ledger": "ledger.json", "cases": [{key: case[key] for key in ("id", "split", "gates", "accepted", "error", "source")} for case in ledger["cases"]]}
    write_json(workspace, workspace / "project.json", combined)
    write_json(workspace, workspace / "ledger.json", ledger)
    write_json(workspace, workspace / "dataset.json", build_dataset(profile, ledger))
    if combined["cases"]:
        assess_file(workspace, workspace / "project.json", workspace / "assessment.json")
    return ledger


def _ledger(profile, plan, mode):
    return {"ledger_version": 1, "mode": mode, "started_at": now(), "profile_id": profile["id"],
            "profile_sha256": canonical_hash(profile), "model_sha256": profile["model"]["sha256"],
            "plan_sha256": canonical_hash(plan), "planned_count": len(plan["points"]), "cases": [],
            "physical_validation": False}


def scan(profile, plan, output, model_override=None):
    validate_plan(plan, profile)
    runtime = bound_profile(profile, model_override)
    source = model_path(runtime, verify=True)
    workspace = new_workspace(output)
    write_json(workspace, workspace / "profile.json", profile)
    write_json(workspace, workspace / "plan.json", plan)
    ledger, projects = _ledger(profile, plan, "native_scan"), []
    stopped = False
    for point in plan["points"]:
        run_dir = contained(workspace, workspace / "runs" / point["id"])
        run_dir.mkdir(parents=True)
        write_json(workspace, run_dir / "point.json", point)
        raw_path = run_dir / "raw.json"
        attempted = not stopped
        if not stopped:
            command = [sys.executable, "-m", "process_pipeline.cli", "worker", "--profile", str(workspace / "profile.json"),
                       "--point", str(run_dir / "point.json"), "--output", str(run_dir), "--model", str(source)]
            with (run_dir / "worker.log").open("w", encoding="utf-8") as log:
                try:
                    child = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                                           timeout=profile.get("limits", {}).get("timeout_seconds", 1200) + 120, check=False)
                    if not raw_path.exists():
                        stopped = True
                except subprocess.TimeoutExpired:
                    stopped = True
                    write_json(workspace, raw_path, {"capture_version": 1, "profile_id": profile["id"], "model_sha256": profile["model"]["sha256"],
                        "case_id": point["id"], "parameters": point["parameters"], "split": point["split"], "evidence_type": "native_simulation",
                        "control_succeeded": False, "solver_accepted": False, "readouts": {},
                        "error": "Worker hard timeout. Native document cleanup is unconfirmed; batch stopped. Inspect this owned process before another native run.",
                        "private_document_closed": False})
        if not raw_path.exists():
            write_json(workspace, raw_path, {"capture_version": 1, "profile_id": profile["id"], "model_sha256": profile["model"]["sha256"],
                "case_id": point["id"], "parameters": point["parameters"], "split": point["split"], "evidence_type": "native_simulation",
                "control_succeeded": False, "solver_accepted": False, "readouts": {},
                "error": "Not attempted after an unsafe worker/cleanup failure" if not attempted else "Native worker failed before completing its raw record"})
        raw = read_json(raw_path)
        record, project = record_case(profile, point, raw, workspace)
        record["attempted"] = attempted
        ledger["cases"].append(record)
        if project is not None:
            projects.append(project)
        if raw.get("timed_out") is True or raw.get("private_document_closed") is not True or raw.get("source_unchanged") is not True or digest(source) != profile["model"]["sha256"]:
            stopped = True
        write_json(workspace, workspace / "ledger.json", ledger)
    ledger["source_sha256_after"] = digest(source)
    ledger["source_unchanged"] = ledger["source_sha256_after"] == profile["model"]["sha256"]
    return finish_job(profile, ledger, projects, workspace)


def replay(profile, plan, captures, output, source_file=None):
    validate_plan(plan, profile)
    if not isinstance(captures, list):
        captures = [captures]
    by_id = {}
    expected = {point["id"] for point in plan["points"]}
    for raw in captures:
        ident = identifier(raw.get("case_id"), "capture.case_id")
        if ident in by_id or ident not in expected:
            raise ValueError("Duplicate or unplanned capture case; no records may be silently discarded")
        by_id[ident] = raw
    workspace = new_workspace(output)
    ledger, projects = _ledger(profile, plan, "capture_replay"), []
    if source_file:
        ledger["capture_source_sha256"] = digest(source_file)
    write_json(workspace, workspace / "profile.json", profile)
    write_json(workspace, workspace / "plan.json", plan)
    for point in plan["points"]:
        raw = by_id.get(point["id"], {"case_id": point["id"], "control_succeeded": False, "solver_accepted": False,
                                    "readouts": {}, "evidence_type": "unverified_capture", "error": "No capture supplied for this planned case"})
        write_json(workspace, workspace / "runs" / point["id"] / "raw.json", raw)
        record, project = record_case(profile, point, raw, workspace)
        record["attempted"] = point["id"] in by_id
        record["replayed"] = True
        ledger["cases"].append(record)
        if project is not None:
            projects.append(project)
    return finish_job(profile, ledger, projects, workspace)


def inspect_model(source, output):
    source, output = Path(source), Path(output)
    if not source.is_absolute() or not output.is_absolute():
        raise ValueError("Inspection model and output paths must be absolute")
    source, output = source.resolve(), output.resolve()
    if not source.is_file() or source.suffix.lower() != ".bkp":
        raise ValueError("Read-only discovery requires an existing .bkp archive")
    if output.exists():
        raise ValueError("Discovery output already exists; choose a new path")
    draft_path = output.with_name(output.stem + "-profile-draft.json")
    if draft_path.exists():
        raise ValueError("Draft profile path already exists; prior file was retained")
    workspace = new_workspace(output.parent / (output.stem + "-inspection"))
    before = digest(source)
    copied = workspace / "input.bkp"
    shutil.copy2(source, copied)
    document = None
    import pythoncom
    from aspen_connection import create_aspen_document
    pythoncom.CoInitialize()
    try:
        document = create_aspen_document()
        document.SuppressDialogs = 1
        document.InitFromArchive2(str(copied))
        document.Visible = 0
        result = inspect_document(document)
    finally:
        try:
            if document is not None:
                document.Close(False)
        finally:
            pythoncom.CoUninitialize()
    result.update({"model_path": str(source), "model_sha256": before, "native_run_performed": False,
                   "original_unchanged": digest(source) == before, "discovered_at": now(),
                   "private_document_closed": True, "model_copy_path": str(copied)})
    write_json(output.parent, output, result)
    if not result["original_unchanged"]:
        raise ValueError("Original archive changed during inspection; discovery evidence retained")
    draft = draft_profile(source, before, result)
    write_json(output.parent, draft_path, draft)
    return {"discovery": str(output), "draft_profile": str(draft_path), "source_unchanged": True}


def draft_profile(source, sha256, discovery):
    return {"profile_version": 1, "id": "reviewed-process", "name": Path(source).stem,
            "model": {"path": Path(source).name, "sha256": sha256}, "variables": [], "readouts": [], "solver_checks": [],
            "mapping": {"meta": {"name": Path(source).stem, "steady_state": True, "enthalpy_basis": "", "boundary": "",
                "functional_unit": "1 kg declared target product", "allocation_method": "", "calorie_J": None,
                "inventory_complete": False, "comparable_cases": False},
                "product": {"quantity": None, "feed": None, "allocation": 1, "source": ""},
                "streams": [], "blocks": [], "inventory": [], "factors": []},
            "limits": {"max_cases": 100, "timeout_seconds": 1200},
            "review": {"state": "incomplete_draft", "discovery_complete": discovery["complete"],
                "available_blocks": discovery["blocks"], "available_streams": discovery["streams"],
                "required": ["Select numeric input leaves and review native units/ranges", "Review solver completion checks",
                    "Map topology, total substream enthalpy and signed external duties", "Declare product/feed basis",
                    "Supply external inventory and sourced impact factors; do not infer them from block duties"]}}
