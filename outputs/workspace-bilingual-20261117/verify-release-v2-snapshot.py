"""One clean, byte-preserving offline release snapshot. No Git staging or COM.

Prepared only: run --build-and-test after the root agent freezes the sources.
--check performs read-only readiness checks without making a snapshot.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import time
from datetime import datetime, timezone

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
BASE = "512b166fd9caa1e7849dfca317db7459606461a3"
SNAPSHOT = OUT / "release-v2-snapshot"
LOGS = OUT / "release-v2-snapshot-logs"
ALLOWLIST = OUT / "release-v2-allowlist.txt"
MANIFEST = OUT / "release-v2-snapshot-manifest.json"
ACCEPTANCE = OUT / "release-v2-snapshot-acceptance.json"
EXPECTED_SKIPS = {
    "test_current_frozen_artifacts_pass_exact_training_checks": "Frozen local estimator not distributed",
    "test_native_balance_failure_and_unit_mismatch": "Private native outputs are local only",
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def permitted(name):
    path = PurePosixPath(name)
    return (not path.is_absolute() and ".." not in path.parts and "\\" not in name
            and not any(part.lower() in {"outputs", "private", "raw", ".vercel", ".git"}
                        or part.lower().startswith(".env") for part in path.parts)
            and path.suffix.lower() not in {".bkp", ".apw", ".apwz", ".bkpz", ".joblib", ".pkl"})


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def package_check(base, directory, expected_count):
    folder = base / "analysis_web" / "data" / directory
    index = json.loads((folder / "index.json").read_bytes())
    files = index["files"]
    if len(files) != expected_count:
        raise ValueError(f"{directory}: expected {expected_count} indexed files")
    if {path.name for path in folder.glob("*.json")} != set(files) | {"index.json"}:
        raise ValueError(f"{directory}: missing or unindexed JSON files")
    for name, row in files.items():
        if PurePosixPath(name).name != name or not name.endswith(".json"):
            raise ValueError(f"Unsupported package member: {name}")
        data = (folder / name).read_bytes()
        if len(data) != row["bytes"] or digest(data) != row["sha256"]:
            raise ValueError(f"Package byte mismatch: {directory}/{name}")
    return {"indexed_files": len(files), "all_hashes_and_sizes_match": True,
            "prediction_enabled": index.get("prediction_enabled"), "exploratory": index.get("exploratory")}


def readiness():
    if git("rev-parse", "HEAD").decode().strip() != BASE:
        raise ValueError("HEAD moved; root must explicitly review the new base before building")
    paths = ALLOWLIST.read_text(encoding="utf-8").splitlines()
    if len(paths) != len(set(paths)) or any(not permitted(path) for path in paths):
        raise ValueError("Duplicate, private or unsafe overlay path")
    missing = [path for path in paths if not (ROOT / path).is_file()]
    if missing:
        raise ValueError("Sources/package are not ready: " + ", ".join(missing))
    changed = set(git("diff", "--name-only", BASE).decode().splitlines())
    extra = set(git("ls-files", "--others", "--exclude-standard", "--", "analysis_web", "universal_pipeline", "process_pipeline", "htl_pipeline").decode().splitlines())
    if (changed | extra) - set(paths):
        raise ValueError("Review and explicitly allow these changed release files: " + ", ".join(sorted((changed | extra) - set(paths))))
    packages = {"v1": package_check(ROOT, "generic-htl-pilot", 14),
                "v2": package_check(ROOT, "generic-htl-extension", 21)}
    return paths, packages


def build(paths, packages):
    for path in [SNAPSHOT, LOGS, MANIFEST, ACCEPTANCE]:
        if path.exists():
            raise ValueError(f"Refusing to overwrite an existing release artifact: {path}")
    sources = {path: (ROOT / path).read_bytes() for path in paths}
    archive = git("archive", "--format=tar", BASE)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar.getmembers():
            if not permitted(member.name) or not (member.isdir() or member.isfile()):
                raise ValueError(f"Unsafe or private base archive member: {member.name}")
        SNAPSHOT.mkdir()
        tar.extractall(SNAPSHOT, filter="data")
    LOGS.mkdir()
    for relative, data in sources.items():
        target = SNAPSHOT / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        if (ROOT / relative).read_bytes() != data or target.read_bytes() != data:
            raise ValueError(f"Source changed while copying: {relative}")
    entries = []
    for path in sorted(SNAPSHOT.rglob("*")):
        if path.is_file():
            relative = path.relative_to(SNAPSHOT).as_posix()
            data = path.read_bytes()
            entries.append({"path": relative, "bytes": len(data), "sha256": digest(data),
                            "source": "working_tree" if relative in sources else BASE})
    manifest = {"created_utc": datetime.now(timezone.utc).isoformat(), "base_commit": BASE,
                "snapshot": str(SNAPSHOT), "archive_sha256": digest(archive),
                "archive_bytes": len(archive), "allowlist_count": len(paths),
                "allowlist_sha256": digest(ALLOWLIST.read_bytes()), "files": entries,
                "public_packages": packages, "native_execution_performed": False}
    dump(MANIFEST, manifest)
    return manifest


def parse_counts(group, log):
    if group == "node":
        def count(label):
            match = re.search(rf"(?:#|\u2139)\s+{label}\s+(\d+)", log)
            if not match:
                raise ValueError(f"Missing Node test {label} count")
            return int(match.group(1))
        return {"total": count("tests"), "passed": count("pass"), "failed": count("fail"), "skipped": count("skipped")}
    total = re.search(r"Ran (\d+) tests? in", log)
    if not total:
        raise ValueError(f"Missing unittest summary: {group}")
    skipped = re.findall(r"^(test_\w+)\s.*?\.\.\. skipped ['\"]([^'\"]+)['\"]", log, re.MULTILINE)
    expected = EXPECTED_SKIPS if group == "htl" else {}
    if dict(skipped) != expected:
        raise ValueError(f"Unexpected skips for {group}: {skipped}")
    return {"total": int(total.group(1)), "passed": int(total.group(1)) - len(skipped),
            "skipped": len(skipped), "skip_reasons": dict(skipped)}


def run_checks(manifest):
    commands = {"node": ["node", "--test", "universal_pipeline/*.test.mjs"],
                "process": [sys.executable, "-m", "unittest", "discover", "-v", "-s", "process_pipeline", "-p", "test_*.py"],
                "htl": [sys.executable, "-m", "unittest", "discover", "-v", "-s", "htl_pipeline", "-p", "test_*.py"],
                "server": [sys.executable, "-m", "unittest", "-v", "universal_pipeline.test_serve_web"]}
    env = os.environ.copy()
    env.pop("PYTHONPATH", None)
    env.update(PYTHONUTF8="1", PYTHONIOENCODING="utf-8", NO_COLOR="1")
    groups = {}
    for group, command in commands.items():
        started = time.monotonic()
        result = subprocess.run(command, cwd=SNAPSHOT, env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, timeout=180, check=False)
        log_path = LOGS / f"{group}.log"
        log_path.write_bytes(result.stdout)
        record = {"command": command, "cwd": str(SNAPSHOT), "exit_code": result.returncode,
                  "seconds": time.monotonic() - started, "log": str(log_path)}
        try:
            record["tests"] = parse_counts(group, result.stdout.decode("utf-8", errors="replace"))
        except ValueError as error:
            record["parse_error"] = str(error)
        dump(LOGS / f"{group}.json", record)
        groups[group] = record
    mismatches = []
    for row in manifest["files"]:
        if digest((SNAPSHOT / row["path"]).read_bytes()) != row["sha256"]:
            mismatches.append("snapshot:" + row["path"])
        if row["source"] == "working_tree" and digest((ROOT / row["path"]).read_bytes()) != row["sha256"]:
            mismatches.append("source:" + row["path"])
    packages = {"v1": package_check(SNAPSHOT, "generic-htl-pilot", 14),
                "v2": package_check(SNAPSHOT, "generic-htl-extension", 21)}
    private_outputs_absent = not (SNAPSHOT / "outputs").exists()
    passed = all(row["exit_code"] == 0 and "parse_error" not in row for row in groups.values()) and not mismatches and private_outputs_absent
    acceptance = {"base_commit": BASE, "snapshot": str(SNAPSHOT), "overlay_count": manifest["allowlist_count"],
                  "groups": groups, "public_packages": packages, "source_or_snapshot_mismatches": mismatches,
                  "private_outputs_absent": private_outputs_absent,
                  "python": sys.version, "node": subprocess.check_output(["node", "--version"], text=True).strip(),
                  "dependencies": {name: importlib.metadata.version(name) for name in ["numpy", "scipy", "pandas", "scikit-learn", "joblib", "threadpoolctl"]},
                  "native_execution_performed": False, "all_requested_tests_passed": passed}
    dump(ACCEPTANCE, acceptance)
    # ASCII-only terminal reporting avoids the prior wrapper's GBK echo error.
    print(json.dumps({"passed": passed, "groups": {key: row.get("tests", row.get("parse_error")) for key, row in groups.items()}, "mismatches": mismatches}))
    return 0 if passed else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--build-and-test", action="store_true")
    args = parser.parse_args()
    paths, packages = readiness()
    if args.check:
        print(json.dumps({"ready": True, "allowlist_count": len(paths), "public_packages": packages}))
        return 0
    return run_checks(build(paths, packages))


if __name__ == "__main__":
    raise SystemExit(main())
