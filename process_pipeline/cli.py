"""Local CLI. No native application is started by validation or replay."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .profile import read_json, validate_profile, validate_plan
from .runner import bound_profile, inspect_model, native_case, replay, scan


def parser():
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate-profile", help="Validate a reviewed JSON profile without launching Aspen")
    validate.add_argument("--profile", type=Path, required=True)
    validate.add_argument("--model", type=Path, help="Optional absolute archive path; verify the declared hash")
    validate.add_argument("--plan", type=Path, help="Also validate a frozen scan plan")
    inspect = commands.add_parser("inspect-model", help="Read-only discovery in a private copied archive; no Engine.Run")
    inspect.add_argument("--model", type=Path, required=True)
    inspect.add_argument("--output", type=Path, required=True, help="New absolute discovery JSON path")
    run = commands.add_parser("scan", help="Run at most 100 reviewed points serially on separate archive copies")
    run.add_argument("--profile", type=Path, required=True)
    run.add_argument("--plan", type=Path, required=True)
    run.add_argument("--model", type=Path, help="Absolute archive override for a portable profile; hash must still match")
    run.add_argument("--output", type=Path, required=True, help="New absolute job directory")
    offline = commands.add_parser("replay", help="Normalize and assess retained captures; never start Aspen")
    offline.add_argument("--profile", type=Path, required=True)
    offline.add_argument("--plan", type=Path, required=True)
    offline.add_argument("--capture", type=Path, required=True, help="One raw capture, a list, or {captures:[...]}")
    offline.add_argument("--output", type=Path, required=True)
    worker = commands.add_parser("worker", help="Internal isolated case worker; normally invoked by scan")
    worker.add_argument("--profile", type=Path, required=True)
    worker.add_argument("--point", type=Path, required=True)
    worker.add_argument("--model", type=Path, required=True)
    worker.add_argument("--output", type=Path, required=True)
    return root


def main(argv=None):
    arguments = parser().parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        if arguments.command == "inspect-model":
            result = inspect_model(arguments.model, arguments.output)
        elif arguments.command == "validate-profile":
            profile = read_json(arguments.profile)
            validate_profile(profile)
            if arguments.model:
                bound_profile(profile, arguments.model)
            if arguments.plan:
                validate_plan(read_json(arguments.plan), profile)
            result = {"valid": True, "profile_id": profile["id"], "model_hash_verified": bool(arguments.model),
                      "native_application_started": False, "variables": len(profile["variables"]),
                      "readouts": len(profile["readouts"])}
        elif arguments.command == "scan":
            result = scan(read_json(arguments.profile), read_json(arguments.plan), arguments.output, arguments.model)
        elif arguments.command == "replay":
            captures = read_json(arguments.capture)
            if isinstance(captures, dict) and "captures" in captures:
                captures = captures["captures"]
            result = replay(read_json(arguments.profile), read_json(arguments.plan), captures, arguments.output, arguments.capture)
        else:
            profile, point = read_json(arguments.profile), read_json(arguments.point)
            validate_plan({"plan_version": 1, "profile_id": profile["id"], "model_sha256": profile["model"]["sha256"], "points": [point]}, profile)
            result = native_case(profile, point, arguments.output, arguments.model)
        summary = {key: value for key, value in result.items() if key not in ("cases", "readouts", "input_readback", "input_readback_after_run")}
        print(json.dumps(summary, ensure_ascii=False, allow_nan=False, indent=2))
        return 2 if result.get("failed_count", 0) or result.get("source_unchanged") is False or result.get("error") else 0
    except Exception as error:
        print(json.dumps({"error": f"{type(error).__name__}: {error}", "native_result_claimed": False}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
