"""Root-authorized revision: correct two DOM test doubles, rerun Node only.

The original snapshot manifest, logs and failed acceptance remain untouched.
"""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time
from datetime import datetime, timezone

OUT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("snapshot_checks", OUT / "verify-release-v2-snapshot.py")
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)
changed = ["universal_pipeline/model-artifacts.test.mjs", "universal_pipeline/robustness-artifacts.test.mjs"]
latest_manifest = OUT / "release-v2-snapshot-manifest.latest.json"
latest_acceptance = OUT / "release-v2-snapshot-acceptance.latest.json"
revision_path = OUT / "release-v2-snapshot-revision1.json"
log_path = checks.LOGS / "node-revision1.log"
result_path = checks.LOGS / "node-revision1.json"
for path in [latest_manifest, latest_acceptance, revision_path, log_path, result_path]:
    if path.exists():
        raise ValueError(f"Refusing to overwrite a revision record: {path}")
paths, packages = checks.readiness()
original = json.loads(checks.MANIFEST.read_bytes())
acceptance = json.loads(checks.ACCEPTANCE.read_bytes())
if acceptance["groups"]["node"]["tests"] != {"total": 153, "passed": 151, "failed": 2, "skipped": 0}:
    raise ValueError("Unexpected original Node result; review before revising")
for row in original["files"]:
    if checks.digest((checks.SNAPSHOT / row["path"]).read_bytes()) != row["sha256"]:
        raise ValueError("Original snapshot drift: " + row["path"])
    if row["source"] == "working_tree" and checks.digest((checks.ROOT / row["path"]).read_bytes()) != row["sha256"]:
        raise ValueError("Source drift outside the approved test fixes: " + row["path"])
manifest = copy.deepcopy(original)
changes = []
for relative in changed:
    row = next(row for row in manifest["files"] if row["path"] == relative)
    data = (checks.ROOT / relative).read_bytes()
    new_hash = checks.digest(data)
    if new_hash == row["sha256"]:
        raise ValueError("Expected test correction is absent: " + relative)
    changes.append({"path": relative, "old_sha256": row["sha256"], "new_sha256": new_hash, "bytes": len(data)})
    (checks.SNAPSHOT / relative).write_bytes(data)
    row.update(bytes=len(data), sha256=new_hash, source="working_tree")
manifest.update(revision=1, revised_utc=datetime.now(timezone.utc).isoformat(), allowlist_count=len(paths),
                allowlist_sha256=checks.digest(checks.ALLOWLIST.read_bytes()),
                original_manifest_sha256=checks.digest(checks.MANIFEST.read_bytes()))
checks.dump(latest_manifest, manifest)
env = os.environ.copy()
env.pop("PYTHONPATH", None)
env.update(PYTHONUTF8="1", PYTHONIOENCODING="utf-8", NO_COLOR="1")
command = ["node", "--test", "universal_pipeline/*.test.mjs"]
started = time.monotonic()
result = subprocess.run(command, cwd=checks.SNAPSHOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180, check=False)
log_path.write_bytes(result.stdout)
record = {"command": command, "cwd": str(checks.SNAPSHOT), "exit_code": result.returncode,
          "seconds": time.monotonic() - started, "log": str(log_path),
          "tests": checks.parse_counts("node", result.stdout.decode("utf-8", errors="replace"))}
checks.dump(result_path, record)
mismatches = []
for row in manifest["files"]:
    if checks.digest((checks.SNAPSHOT / row["path"]).read_bytes()) != row["sha256"]:
        mismatches.append("snapshot:" + row["path"])
    if row["source"] == "working_tree" and checks.digest((checks.ROOT / row["path"]).read_bytes()) != row["sha256"]:
        mismatches.append("source:" + row["path"])
checked_packages = {"v1": checks.package_check(checks.SNAPSHOT, "generic-htl-pilot", 14),
                    "v2": checks.package_check(checks.SNAPSHOT, "generic-htl-extension", 21)}
revision = {"revision": 1, "reason": "Two legacy closest() test doubles returned a pagination button for every selector, including the new export selector. Match the requested selector as the browser does; no production validation was changed.",
            "changes": changes, "original_node_result": acceptance["groups"]["node"]["tests"],
            "revised_node_result": record["tests"], "reused_initial_python_checks": True,
            "source_or_snapshot_mismatches": mismatches, "public_packages": checked_packages}
checks.dump(revision_path, revision)
acceptance.update(revision=1, overlay_count=len(paths), first_round_node=acceptance["groups"]["node"]["tests"],
                  source_or_snapshot_mismatches=mismatches, public_packages=checked_packages,
                  reused_initial_python_checks=True, revision_record=str(revision_path))
acceptance["groups"]["node"] = record
acceptance["all_requested_tests_passed"] = result.returncode == 0 and not mismatches and all(acceptance["groups"][key]["exit_code"] == 0 for key in ["process", "htl", "server"])
checks.dump(latest_acceptance, acceptance)
print(json.dumps({"passed": acceptance["all_requested_tests_passed"], "first_round_node": acceptance["first_round_node"], "revised_node": record["tests"], "source_or_snapshot_mismatches": mismatches}))
raise SystemExit(0 if acceptance["all_requested_tests_passed"] else 1)
