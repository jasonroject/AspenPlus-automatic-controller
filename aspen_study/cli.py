"""Command line: python -m aspen_study.cli {classify,assess} ..."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .adapters import MockAdapter
from .build import write_study
from .classifier import classify
from .factors import load_library
from .overrides import load_override, merge


def main(argv=None):
    p = argparse.ArgumentParser(prog="aspen_study")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("classify", help="graph.json (+ roles.yaml) -> roles.json")
    c.add_argument("--graph", required=True)
    c.add_argument("--override")
    c.add_argument("--region")
    c.add_argument("--out", required=True)
    a = sub.add_parser("assess", help="graph.json + roles.json -> aspen-study/2 bundle (single case)")
    a.add_argument("--graph", required=True)
    a.add_argument("--roles", required=True)
    a.add_argument("--study-id", required=True)
    a.add_argument("--case-id", default="case-1")
    a.add_argument("--factors", action="append", default=[], help="extra factor library JSON (user/study), may repeat")
    a.add_argument("--calorie-J", type=float, choices=[4.184, 4.1868])
    a.add_argument("--out-dir", required=True)
    args = p.parse_args(argv)
    graph = MockAdapter(args.graph).discover()
    if args.cmd == "classify":
        roles = classify(graph, region=args.region)
        if args.override:
            roles = merge(roles, load_override(args.override), graph)
        Path(args.out).write_text(json.dumps(roles, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{args.out}: review={roles['review']['state']}, pending={len(roles['review']['pending'])}")
        return 0
    roles = json.loads(Path(args.roles).read_text(encoding="utf-8"))
    extra = [json.loads(Path(f).read_text(encoding="utf-8")) for f in args.factors]
    manifest = write_study(args.out_dir, args.study_id, graph, roles, [(args.case_id, graph, {})],
                           entries=load_library(extra=extra), calorie_J=args.calorie_J)
    for case in manifest["cases"]:
        print(case["id"], case["status"], json.dumps(case["kpi"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
