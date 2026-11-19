"""Acceptance gates for aspen-study/2.

G0 identity, G1 converged/no-error (+ warnings), G2 data completeness,
G3 mass/energy closure (residuals from universal-core), G4 human review of
roles, G5 factor coverage. Missing data is reported, never replaced by 0.
"""
from __future__ import annotations

import re

from .classifier import ADIABATIC_ROLES


def gate(gid, status, messages=()):
    return {"id": gid, "status": status, "messages": list(messages)}


def g0_identity(graph):
    sha = graph["model"].get("sha256", "")
    ok = bool(re.fullmatch(r"[0-9a-f]{64}", sha))
    return gate("G0_identity", "pass" if ok else "fail", [] if ok else ["模型 SHA-256 缺失或格式错误"])


def g1_converged(graph):
    st, msgs = graph["status"], []
    if not st["run_completed"]:
        msgs.append("运行未完成（run_completed=false）")
    msgs += [f"错误：{e}" for e in st["errors"]]
    accepted = st.get("cvstat_accepted")
    if "cvstat" in st and st["cvstat"] is not None:
        if not accepted:
            msgs.append(f"收敛码 CVSTAT={st['cvstat']}，但没有声明可接受值（需在真机上核实后填写）")
        elif st["cvstat"] not in accepted:
            msgs.append(f"收敛码 CVSTAT={st['cvstat']} 不在可接受值 {accepted} 中")
    ok_block = st.get("block_status_accepted")
    for bid, code in (st.get("block_status") or {}).items():
        if ok_block is not None and code not in ok_block:
            msgs.append(f"块 {bid} 状态 {code} 不在可接受值 {ok_block} 中")
    return gate("G1_converged", "fail" if msgs else "pass", msgs)


def g1_warnings(graph):
    w = graph["status"]["warnings"]
    return gate("G1_warnings", "warn" if w else "pass", [f"警告：{x}" for x in w])


def g2_completeness(graph, roles):
    msgs, fatal = [], False
    for b in graph["blocks"]:
        role = roles["blocks"].get(b["id"], {}).get("role")
        if not b["energy"] and role not in ADIABATIC_ROLES:
            msgs.append(f"块 {b['id']}（{b['type']}）没有负荷/功率读数；需补充节点或显式声明 0")
            fatal = True
        for kind in ("heat", "work"):
            units = {e["unit"] for e in b["energy"] if e["kind"] == kind}
            if len(units) > 1:
                msgs.append(f"块 {b['id']} 的 {kind} 读数单位不一致 {sorted(units)}；请导出为同一单位")
                fatal = True
    for s in graph["streams"]:
        if s["class"] != "MATERIAL":
            continue
        t = s.get("total") or {}
        if t.get("mass_flow") is None or not t.get("mass_unit"):
            msgs.append(f"物流 {s['id']} 缺少质量流量或单位")
            fatal = True
        if t.get("enthalpy_flow") is None and t.get("h_mass") is None:
            msgs.append(f"物流 {s['id']} 缺少焓（总焓流或质量比焓）；缺失不等于 0")
            fatal = True
    for b in roles["blocks"].values():
        if b.get("utility") == "unassigned":
            msgs.append("存在未指定公用工程的块")
            break
    unmatched = (graph.get("discovery") or {}).get("unmatched_block_types") or []
    if unmatched:
        msgs.append(f"未识别的块类型：{', '.join(unmatched)}")
    return gate("G2_completeness", "fail" if fatal else ("warn" if msgs else "pass"), msgs)


def block_balance(core_balance, tolerance_floor=(0.01, 0.01), relative=0.001):
    """Per-block residuals from universal-core with explicit tolerance and ratio.

    Mirrors the core tolerance: max(0.01 kg/h, 0.1% mass throughput) and
    max(0.01 kW, 0.1% of the largest enthalpy/duty scale).
    """
    streams = core_balance.get("streams") or []
    rows = []
    for b in core_balance.get("blocks") or []:
        bid = b["id"]
        inbound = [s for s in streams if s["to"] == bid]
        outbound = [s for s in streams if s["from"] == bid]
        mi, mo = sum(s["mass"] for s in inbound), sum(s["mass"] for s in outbound)
        hi, ho = sum(s["enthalpy"] for s in inbound), sum(s["enthalpy"] for s in outbound)
        mass_scale = max(mi, mo, 1e-12)
        energy_scale = max(abs(hi), abs(ho), abs(b["heat"]) + abs(b["power"]), 1e-12)
        tol_m = max(tolerance_floor[0], relative * mass_scale)
        tol_e = max(tolerance_floor[1], relative * energy_scale)
        mres, eres = b["mass_residual_kg_h"], b["energy_residual_kW"]
        rows.append({"block": bid, "mass_residual": mres, "energy_residual": eres,
                     "mass_unit": "kg/h", "energy_unit": "kW",
                     "tolerance": {"mass": tol_m, "energy": tol_e},
                     "ratio": max(abs(mres) / tol_m, abs(eres) / tol_e)})
    return rows


def g3_balance(core_balance, rows):
    if not core_balance.get("complete"):
        return gate("G3_balance", "fail", ["衡算无法完成：" + "; ".join(core_balance.get("errors", []))])
    bad = [r for r in rows if r["ratio"] > 1]
    msgs = [f"块 {r['block']} 残差超出容差（ratio={r['ratio']:.2f}）" for r in bad]
    total = core_balance.get("total") or {}
    if total:
        msgs.append(f"边界残差：质量 {total.get('mass_residual_kg_h', 0):.4g} kg/h，能量 {total.get('energy_residual_kW', 0):.4g} kW")
    return gate("G3_balance", "warn" if bad else "pass", msgs if bad else msgs[-1:])


def g4_roles(roles):
    msgs = []
    if roles["review"]["state"] != "reviewed":
        msgs.append(f"角色映射未经人工确认（state={roles['review']['state']}）；LCA 结果不可用")
        msgs += [f"待确认：{p}" for p in roles["review"].get("pending", [])[:20]]
    if "functional_unit" not in roles:
        msgs.append("未声明功能单位")
    elif roles["functional_unit"]["basis"] != "product_mass" or roles["functional_unit"]["unit"] != "kg" or roles["functional_unit"]["amount"] != 1:
        msgs.append("当前计算核心（universal-core v1）只支持“1 kg 产品”功能单位")
    if not any(r["role"] == "product" for r in roles["streams"].values()):
        msgs.append("没有产品流股")
    return gate("G4_roles", "fail" if msgs else "pass", msgs)


def g5_factors(completeness):
    if not completeness:
        return gate("G5_factors", "fail", ["没有任何影响类别的因子"])
    msgs = []
    for cat, c in completeness.items():
        if not c["complete"]:
            msgs.append(f"{cat} 不完整：缺 {len(c['missing'])} 项" + (f"（{', '.join(c['missing'][:8])}）" if c["missing"] else "")
                        + (f"；已知部分下限 {c['lower_bound']:.4g}" if c.get("lower_bound") is not None else ""))
    return gate("G5_factors", "warn" if msgs else "pass", msgs)


def case_status(gates):
    by = {g["id"]: g["status"] for g in gates}
    if by.get("G0_identity") == "fail" or by.get("G1_converged") == "fail":
        return "rejected"
    return "accepted" if all(g["status"] == "pass" for g in gates) else "accepted_with_warnings"
