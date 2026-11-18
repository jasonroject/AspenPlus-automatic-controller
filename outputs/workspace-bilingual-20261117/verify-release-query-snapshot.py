"""Final query-only clean snapshot; execute only after root's source-ready signal.

New Node checks run here. Python checks are carried forward only after matching
their source and dependency hashes to the previously accepted v2 snapshot.
"""
import argparse
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

OUT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("snapshot_checks", OUT / "verify-release-v2-snapshot.py")
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)
checks.BASE = "43a36bd2a27ae6aedd87db562001a7d77cfd9df5"
checks.SNAPSHOT = OUT / "release-query-snapshot"
checks.LOGS = OUT / "release-query-snapshot-logs"
checks.ALLOWLIST = OUT / "release-query-allowlist.txt"
checks.MANIFEST = OUT / "release-query-snapshot-manifest.json"
checks.ACCEPTANCE = OUT / "release-query-snapshot-acceptance.json"
BASELINE = OUT / "release-v2-snapshot-acceptance.latest.json"
BASELINE_MANIFEST = OUT / "release-v2-snapshot-manifest.latest.json"


def python_baseline():
    baseline = json.loads(BASELINE.read_bytes())
    manifest = json.loads(BASELINE_MANIFEST.read_bytes())
    if baseline.get("all_requested_tests_passed") is not True or baseline.get("source_or_snapshot_mismatches"):
        raise ValueError("The prior v2 acceptance is not clean")
    tracked_command = ["diff", "--name-status", baseline["base_commit"], checks.BASE, "--", "process_pipeline", "htl_pipeline", "analysis_web/universal-core.mjs", "requirements*"]
    tracked_diff = checks.git(*tracked_command).decode("utf-8")
    if tracked_diff.strip():
        raise ValueError("Tracked Python/core blobs changed: " + tracked_diff)
    shared = {"serve_web.py", "universal_pipeline/test_serve_web.py", "universal_pipeline/build_examples.py", "analysis_web/universal-core.mjs"}
    rows = [row for row in manifest["files"] if row["path"].startswith(("process_pipeline/", "htl_pipeline/")) or row["path"] in shared]
    matching = []
    for row in rows:
        old = (Path(baseline["snapshot"]) / row["path"]).read_bytes()
        current = (checks.ROOT / row["path"]).read_bytes()
        if checks.digest(old) != row["sha256"]:
            raise ValueError("Prior Python/shared source fingerprint changed: " + row["path"])
        # Git normalized source line endings after the previous release. This
        # comparison is for code/fixtures only; public evidence stays byte-exact.
        if current.replace(b"\r\n", b"\n") != old.replace(b"\r\n", b"\n"):
            raise ValueError("Python/shared calculation source changed: " + row["path"])
        matching.append({**row, "baseline_sha256": row["sha256"], "sha256": checks.digest(current),
                         "normalized_text_sha256": checks.digest(current.replace(b"\r\n", b"\n")),
                         "line_endings_only": current != old})
    dependencies = {name: importlib.metadata.version(name) for name in baseline["dependencies"]}
    if dependencies != baseline["dependencies"] or sys.version != baseline["python"]:
        raise ValueError("Python runtime/dependencies changed; prior checks cannot be reused")
    return {"acceptance_file": str(BASELINE), "acceptance_sha256": checks.digest(BASELINE.read_bytes()),
            "matching_source_count": len(rows), "matching_sources": matching, "matching_dependencies": dependencies,
            "line_ending_only_changes": [row["path"] for row in matching if row["line_endings_only"]],
            "tracked_blob_check": {"command": ["git", *tracked_command], "changed_files": []},
            "python": sys.version, "groups": {name: baseline["groups"][name] for name in ["process", "htl", "server"]},
            "meaning": "83 Python tests passed and 2 private-data tests were skipped in the accepted v2 snapshot. Not rerun for this frontend-only change."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--check", action="store_true")
    modes.add_argument("--build-and-test", action="store_true")
    args = parser.parse_args()
    paths, packages = checks.readiness()
    baseline = python_baseline()
    if args.check:
        print(json.dumps({"ready": True, "overlay_count": len(paths), "matching_python_source_count": baseline["matching_source_count"], "public_packages": packages}))
        return 0
    manifest = checks.build(paths, packages)
    command = ["node", "--test", "universal_pipeline/*.test.mjs"]
    env = os.environ.copy()
    env.pop("PYTHONPATH", None)
    env.update(PYTHONUTF8="1", PYTHONIOENCODING="utf-8", NO_COLOR="1")
    started = time.monotonic()
    result = subprocess.run(command, cwd=checks.SNAPSHOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180, check=False)
    log_path = checks.LOGS / "node.log"
    log_path.write_bytes(result.stdout)
    node = {"command": command, "cwd": str(checks.SNAPSHOT), "exit_code": result.returncode,
            "seconds": time.monotonic() - started, "log": str(log_path),
            "tests": checks.parse_counts("node", result.stdout.decode("utf-8", errors="replace"))}
    checks.dump(checks.LOGS / "node.json", node)
    mismatches = []
    for row in manifest["files"]:
        if checks.digest((checks.SNAPSHOT / row["path"]).read_bytes()) != row["sha256"]:
            mismatches.append("snapshot:" + row["path"])
        if row["source"] == "working_tree" and checks.digest((checks.ROOT / row["path"]).read_bytes()) != row["sha256"]:
            mismatches.append("source:" + row["path"])
    for row in baseline["matching_sources"]:
        if checks.digest((checks.SNAPSHOT / row["path"]).read_bytes()) != row["baseline_sha256"]:
            mismatches.append("python-baseline:" + row["path"])
    package_matches = {"v1": checks.package_check(checks.SNAPSHOT, "generic-htl-pilot", 14),
                       "v2": checks.package_check(checks.SNAPSHOT, "generic-htl-extension", 21)}
    private_absent = not (checks.SNAPSHOT / "outputs").exists()
    passed = result.returncode == 0 and not mismatches and private_absent
    acceptance = {"base_commit": checks.BASE, "snapshot": str(checks.SNAPSHOT), "overlay_count": len(paths),
                  "new_checks": {"node": node}, "carried_forward_python_checks": baseline,
                  "public_packages": package_matches, "source_or_snapshot_mismatches": mismatches,
                  "private_outputs_absent": private_absent, "native_execution_performed": False,
                  "all_requested_tests_passed": passed}
    checks.dump(checks.ACCEPTANCE, acceptance)
    print(json.dumps({"passed": passed, "new_node_checks": node["tests"], "python_passes_carried_forward": 83,
                      "python_expected_skips_carried_forward": 2, "source_or_snapshot_mismatches": mismatches}))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
