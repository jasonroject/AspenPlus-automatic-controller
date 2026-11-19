"""Command line: python -m aspen_study {probe,advise,upgrade,classify,assess} ..."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .adapters import MockAdapter
from .build import write_study
from .classifier import classify
from .factors import load_library
from .overrides import load_override, merge


def main(argv=None):
    p = argparse.ArgumentParser(prog="aspen_study")
    sub = p.add_subparsers(dest="cmd", required=True)
    pr = sub.add_parser("probe", help="一条命令体检 Aspen 模型：复制 -> 运行 -> 状态 + 逐块能量表（需要 Windows + Aspen Plus + pywin32）")
    pr.add_argument("model", help="模型文件（.bkp）")
    pr.add_argument("--out-dir", help="输出目录，默认 outputs/probe/<模型名>")
    pr.add_argument("--study-id")
    pr.add_argument("--timeout", type=int, default=1200, help="运行超时秒数（默认 1200）")
    pr.add_argument("--calorie-J", type=float, choices=[4.184, 4.1868], default=4.1868,
                    help="1 cal 等于多少 J；默认 4.1868（真机核对的 Aspen 定义）")
    pr.add_argument("--keep-work", action="store_true", help="保留临时副本目录用于排查")
    pr.add_argument("--no-study", action="store_true", help="只写 graph.json 与 probe-summary.json，不生成 aspen-study 包")
    pr.add_argument("--json", action="store_true", help="终端只输出 probe-summary.json 的内容")
    ad = sub.add_parser("advise", help="probe-summary.json (+ graph.json, roles.json) -> advice.json（规则建议，不需要 Aspen）")
    ad.add_argument("summary", help="probe-summary.json（aspen-probe/1 或 1.1）")
    ad.add_argument("--graph", help="graph.json（可选；有了才能做热集成与物料守恒检查）")
    ad.add_argument("--roles", help="roles.json（可选；有了才能做 LCA 就绪度检查）")
    ad.add_argument("--out", help="写 advice.json；不给就在终端打印中文摘要")
    up = sub.add_parser("upgrade", help="aspen-probe/1 的 probe-summary.json 离线升级为 1.1（不需要 Aspen）")
    up.add_argument("summary")
    up.add_argument("--out", required=True)
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
    if args.cmd == "probe":
        return _probe(args)
    if args.cmd in ("advise", "upgrade"):
        return _advise(args) if args.cmd == "advise" else _upgrade(args)
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


def _load(path, what):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"找不到 {what}：{path}")
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SystemExit(f"{what} 不是有效的 JSON：{path}（{exc}）")


def _upgrade(args):
    from .probe_compat import upgrade_summary
    from .schema_check import validate
    try:
        up = upgrade_summary(_load(args.summary, "probe-summary.json"))
        validate(up, "probe")
    except (ValueError, KeyError, TypeError) as exc:
        raise SystemExit(f"升级失败：{exc}")
    Path(args.out).write_text(json.dumps(up, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{args.out}: {up['schema']}" + (f"（迁移自 {up['migrated_from']}）" if up.get("migrated_from") else ""))
    return 0


def _advise(args):
    from .advice import advise
    from .probe_compat import upgrade_summary
    from .schema_check import validate
    summary = _load(args.summary, "probe-summary.json")
    graph = _load(args.graph, "graph.json") if args.graph else None
    roles = _load(args.roles, "roles.json") if args.roles else None
    try:
        validate(upgrade_summary(summary), "probe")
    except (ValueError, KeyError, TypeError) as exc:
        raise SystemExit(f"{args.summary} 不是有效的 probe-summary.json：{exc}")
    from .advice import package_problems
    problems = package_problems(summary, graph, roles)
    if problems:
        raise SystemExit("输入文件不一致，不做分析：" + "；".join(problems))
    advice = advise(summary, graph, roles)
    validate(advice, "advice")
    if args.out:
        Path(args.out).write_text(json.dumps(advice, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{args.out}: " + "，".join(f"{k}={v}" for k, v in advice["counts"].items()))
        return 0
    for stream in (sys.stdout,):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    print(f"模型 {advice['model']['file']}：" + "，".join(f"{k}={v}" for k, v in advice["counts"].items()))
    for it in advice["items"]:
        print(f"\n[{it['severity']}] {it['title_zh']}  ({it['category']}, {it['confidence']})\n  {it['detail_zh']}\n  建议：{it['action_zh']}")
    return 0


def _probe(args):
    from .adapters.errors import AspenError
    from .probe import format_report, run_probe
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")  # 终端编码不支持中文时也不要崩
        except Exception:
            pass
    model = Path(args.model)
    out_dir = Path(args.out_dir) if args.out_dir else Path("outputs") / "probe" / model.stem
    try:
        summary, out = run_probe(model, out_dir, study_id=args.study_id, calorie_J=args.calorie_J, timeout_s=args.timeout,
                                 keep_work=args.keep_work, make_study=not args.no_study,
                                 log=(lambda *_: None) if args.json else print)
    except AspenError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 3
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=1))
    else:
        print()
        print(format_report(summary))
        print(f"\n已写入：{out}")
    return 1 if summary["status"]["state"] == "error" else 0


if __name__ == "__main__":
    raise SystemExit(main())
