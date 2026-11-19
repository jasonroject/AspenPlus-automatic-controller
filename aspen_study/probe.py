"""一条命令体检一个 Aspen 模型：复制 -> 打开私有文档 -> 运行 -> 读状态与逐块能量 -> 写 JSON。

    python -m aspen_study probe <model.bkp> [--out-dir DIR]

产物（out-dir 下）：
  probe-summary.json   aspen-probe/1.1：运行状态（ok/warning/error）、逐块消息、逐块能量表（原生单位 + kW）
  graph.json           aspen-model-graph/1：原生值与 UnitString，可直接交给 classify / assess
  study/               （可选）按 graph 自动生成的 aspen-study/2 包：manifest.json、cases/、results/ …
源模型文件不被修改（前后 SHA-256 对比写入 summary）。
"""
from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path

from .adapters.aspen_com import AspenPlusCOMAdapter
from .adapters.aspen_rules import to_kW
from .adapters.errors import AspenError
from .probe_compat import PER_ERROR_CAP, SCHEMA, SKIP_LINES, group_totals
from .schema_check import validate

HINT_ZH = {"exchanged": "内部换热", "condenser": "冷凝器", "reboiler": "再沸器"}
STATE_ZH = {"ok": "正常", "warning": "有警告（结果可用但要标注）", "error": "有错误（结果不可信）"}


def energy_table(graph, report, calorie_J, energy_verified=None):
    """逐块能量表：原生值、原生单位、换算后的 kW（换算不了就是 null，附原因）。

    每块：status（由 BLKSTAT 派生 ok/warning/error/unknown）、blkmsg（Aspen 的块摘要消息或 null）、
    per_error（消息行，最多 12 行）、per_error_total（真实行数）。每个能量项：verified = 该节点读取是否已在真机验证
    （energy_verified 来自适配器；没有映射时一律按未验证 false，不乐观）。"""
    energy_verified = energy_verified or {}
    rows = []
    for b in graph["blocks"]:
        info = (report["blocks"] or {}).get(b["id"], {})
        lines = [m for m in info.get("messages", []) if m.strip() and m.strip() not in SKIP_LINES]
        blkmsg = (info.get("blkmsg") or "").strip() or None
        row = {"id": b["id"], "type": b["type"], "status": info.get("state", "unknown"), "blkstat": info.get("blkstat"),
               "blkmsg": blkmsg, "per_error": lines[:PER_ERROR_CAP], "per_error_total": len(lines), "energy": []}
        for e in b["energy"]:
            kw, note = to_kW(e["value"], e["unit"], calorie_J)
            item = {"kind": e["kind"], "value": e["value"], "unit": e["unit"], "kW": kw, "path": e.get("path", ""),
                    "verified": bool(energy_verified.get(e.get("path", ""), False))}
            if e.get("role_hint"):
                item["role_hint"] = e["role_hint"]
            if note:
                item["note"] = note
            if e.get("explicit_zero"):
                item["explicit_zero"] = True
            row["energy"].append(item)
        if "outlet_temperature" in b:
            row["outlet_temperature"] = b["outlet_temperature"]
        rows.append(row)
    return rows


def totals_kW(rows):
    """外部加热 / 冷却 / 轴功 / 内部换热合计（kW）。任何一项换算不了，该合计为 null，绝不当 0。"""
    t = {"heating": 0.0, "cooling": 0.0, "work": 0.0, "internal_exchange": 0.0}
    broken = set()
    for r in rows:
        for e in r["energy"]:
            if e.get("role_hint") == "exchanged":
                key = "internal_exchange"
            elif e["kind"] == "work":
                key = "work"
            else:
                key = "heating" if e["value"] >= 0 else "cooling"
            if e["kW"] is None:
                broken.add(key)
            else:
                t[key] += e["kW"]
    return {k: (None if k in broken else round(v, 6)) for k, v in t.items()}


def build_summary(graph, adapter, rows, report, elapsed, calorie_J, source_unchanged):
    discovery = graph.get("discovery", {})
    gaps = adapter.energy_gap_items() if hasattr(adapter, "energy_gap_items") else [
        {"block": None, "path": str(g), "reason": str(g)} for g in adapter.energy_gaps()]
    unverified = adapter.unverified_items() if hasattr(adapter, "unverified_items") else [
        {"block": None, "path": str(u), "reason": "未在真机验证"} for u in discovery.get("unverified_paths", [])]
    complete = not gaps and not discovery.get("unmatched_block_types")
    disc = {k: discovery[k] for k in ("mode", "nodes_read", "complete", "unmatched_block_types") if k in discovery}
    return {"schema": SCHEMA,
            "created": datetime.now().astimezone().isoformat(timespec="seconds"),
            "model": dict(graph["model"], source_unchanged=source_unchanged),
            "status": {"state": report["state"], "run_completed": report["run_completed"], "errors": report["errors"],
                       "warnings": report["warnings"], "notes": report["notes"], "raw_status": report["raw_status"],
                       "run_status_lines": report["run_status_lines"], "run_seconds": report["run_seconds"]},
            "units": graph.get("units", {}),
            "calorie_J": calorie_J,
            "blocks": rows,
            "totals_kW": totals_kW(rows),
            "totals_complete": complete,
            "group_totals": group_totals(rows, complete),
            "energy_gaps": gaps,
            "unverified_paths": unverified,
            "discovery": disc,
            "cleanup": {"killed_pids": adapter.cleaned_pids()},
            "elapsed_seconds": round(elapsed, 1)}


def write_json(path, data):
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def run_probe(model, out_dir, *, study_id=None, case_id="case-1", calorie_J=4.1868, timeout_s=1200, keep_work=False,
              make_study=True, adapter_factory=AspenPlusCOMAdapter, log=print, **adapter_kw):
    """返回 (summary, out_dir)。Aspen 相关的可预期失败抛 AspenError（message 为中文）。"""
    model = Path(model)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    adapter = adapter_factory(calorie_J=calorie_J, timeout_s=timeout_s, keep_workdir=keep_work, **adapter_kw)
    log(f"打开 {model.name}（复制到临时目录，源文件不会被修改）…")
    try:
        adapter.open(model)
        log(f"运行中（Reinit + Run，最长 {timeout_s} 秒）…")
        run_error = None
        try:
            adapter.run(timeout_s)
        except AspenError as exc:
            run_error = exc
        graph = adapter.discover()
        report = adapter.run_report()
    finally:
        adapter.close()
    rows = energy_table(graph, report, calorie_J,
                        adapter.energy_verified() if hasattr(adapter, "energy_verified") else None)
    summary = build_summary(graph, adapter, rows, report, time.monotonic() - started, calorie_J, adapter.source_unchanged)
    validate(summary, "probe")
    write_json(out / "graph.json", graph)
    write_json(out / "probe-summary.json", summary)
    if make_study and report["state"] != "error":
        summary["study"] = _write_study(out, graph, study_id or model.stem, case_id, calorie_J)
        write_json(out / "probe-summary.json", summary)
    if run_error is not None:
        raise run_error
    return summary, out


def _write_study(out, graph, study_id, case_id, calorie_J):
    """可选：用自动角色草稿生成 aspen-study/2 包。角色未人工确认时 G4 会提示，结果仅供预览。"""
    try:
        from .build import write_study
        from .classifier import classify
        from .factors import load_library
        roles = classify(graph)
        write_json(out / "roles.json", roles)
        manifest = write_study(out / "study", study_id, graph, roles, [(case_id, graph, {})],
                               entries=load_library(), calorie_J=calorie_J)
        return {"ok": True, "dir": "study", "manifest": "study/manifest.json",
                "cases": [{"id": c["id"], "status": c["status"]} for c in manifest["cases"]],
                "note": "角色为自动草稿，需人工确认产品流股与功能单位后才可用于 LCA 结论"}
    except Exception as exc:  # 评估层需要 Node.js 等，失败不影响体检结果本身
        text = " ".join(str(exc).split())
        return {"ok": False, "error": "生成 aspen-study 包失败：" + (text if len(text) < 300 else text[:300] + "…")}


def format_report(summary):
    """终端里的中文摘要。"""
    s = summary
    lines = [f"模型：{s['model']['file']}  Aspen {s['model'].get('version') or '?'}  用时 {s['elapsed_seconds']} 秒  "
             f"源文件未改动：{'是' if s['model'].get('source_unchanged') else '否（请检查！）'}",
             f"运行状态：{STATE_ZH[s['status']['state']]}"]
    u = s.get("units", {})
    if u:
        lines.append(f"单位集：输入 {u.get('INSET', '?')} / 输出 {u.get('OUTSET', '?')}；cal 按 {s['calorie_J']} J 换算 kW")
    lines.append("")
    lines.append(f"{'块':<10}{'类型':<10}{'状态':<9}{'项目':<12}{'原生值':>14} {'单位':<10}{'kW':>12}")
    for r in s["blocks"]:
        first = True
        for e in r["energy"] or [None]:
            label = (HINT_ZH.get(e.get("role_hint"), e.get("role_hint")) or ("功率" if e["kind"] == "work" else "热负荷")) if e else "（无负荷）"
            value = "" if e is None else f"{e['value']:.6g}"
            kw = "" if e is None else ("—" if e["kW"] is None else f"{e['kW']:.4g}")
            lines.append(f"{r['id'] if first else '':<10}{r['type'] if first else '':<10}{r['status'] if first else '':<9}"
                         f"{label:<12}{value:>14} {(e or {}).get('unit', ''):<10}{kw:>12}")
            first = False
    t = s["group_totals"]
    lines.append("")
    lines.append("合计 kW：" + "，".join(f"{k}={'未知' if v['kW'] is None else v['kW']}" for k, v in t.items())
                 + "（internal_exchange 为内部换热；overall = 加热+冷却+轴功的净值，不含内部换热）"
                 + ("" if s["totals_complete"] else "（不完整：有块缺负荷读数或类型未登记，合计仅供参考）"))
    for title, key in (("错误", "errors"), ("警告", "warnings"), ("说明", "notes")):
        for x in s["status"][key]:
            lines.append(f"{title}：{x}")
    for g in s["energy_gaps"]:
        lines.append(f"缺负荷读数（未补 0）：{g['reason']}")
    if s["discovery"].get("unmatched_block_types"):
        lines.append("未登记的块类型（只尝试了通用节点）：" + "、".join(s["discovery"]["unmatched_block_types"]))
    if s["unverified_paths"]:
        lines.append("以下读取尚未在真机验证：" + "；".join(u["path"] for u in s["unverified_paths"]))
    st = s.get("study")
    if st:
        lines.append("aspen-study 包：" + (f"{st['dir']}/（{', '.join(c['id'] + ':' + c['status'] for c in st['cases'])}）" if st["ok"] else st["error"]))
    return "\n".join(lines)
