"""基于规则的模型建议引擎：probe-summary.json（+ graph.json、roles.json）-> advice.json（aspen-advice/1）。

    python -m aspen_study advise probe-summary.json [--graph graph.json] [--roles roles.json] [--out advice.json]

规则表（阈值、消息模式、全部中文文案）在 analysis_web/data/aspen-advice-rules.json，浏览器端
analysis_web/aspen-advice.mjs 读同一个文件；两端各自实现判定逻辑，tests 里对拍保证输出一致。
只使用探针里真实存在的字段；不编造数值、不带任何排放因子。输出是确定性的（无时间戳）。
证据 ref 是 JSON Pointer，指向升级到 aspen-probe/1.1 之后的视图（1.0 文件会先在内存里升级）。
"""
from __future__ import annotations

import json
import os
from decimal import ROUND_HALF_UP, Decimal
import re
from pathlib import Path

from .probe_compat import SCHEMA as PROBE_SCHEMA, upgrade_summary

ADVICE_SCHEMA = "aspen-advice/1"
RULES_ENV = "ASPEN_ADVICE_RULES"
SEV_RANK = {"critical": 0, "warn": 1, "suggest": 2, "info": 3}
CAT_ORDER = ["convergence", "thermo/phase", "reaction", "units", "energy", "heat-integration", "data-completeness", "lca-readiness"]
SUMMARY_FILE, GRAPH_FILE, ROLES_FILE = "probe-summary.json", "graph.json", "roles.json"


def rules_path():
    env = os.environ.get(RULES_ENV)
    return Path(env) if env else Path(__file__).resolve().parent.parent / "analysis_web" / "data" / "aspen-advice-rules.json"


def load_rules(path=None):
    return json.loads(Path(path or rules_path()).read_text(encoding="utf-8"))


# --------------------------------------------------------------------------- 小工具（JS 端逐个对应）
def num(x, d=2):
    """四舍五入（远离 0，与 JS toFixed 一致），去掉末尾 0。"""
    s = format(Decimal(x).quantize(Decimal(1).scaleb(-d), rounding=ROUND_HALF_UP), "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def render(tpl, vars_):
    return re.sub(r"\{(\w+)\}", lambda m: str(vars_.get(m.group(1), "未读到")), tpl)


def uniq(seq):
    return list(dict.fromkeys(seq))


def join_zh(seq):
    return "、".join(seq)


def to_K(value, unit):
    u = str(unit or "").strip().replace("°", "").upper()
    if u == "K":
        return value
    if u == "C":
        return value + 273.15
    if u == "F":
        return (value - 32) * 5 / 9 + 273.15
    if u == "R":
        return value * 5 / 9
    return None


def sv(v):
    """占位符取值转字符串（与 JS String() 一致：整数值的 float 不带 .0）。"""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return v if isinstance(v, str) else str(v)


def pct(x):
    return num(100 * x, 0)


class _Ctx:
    def __init__(self, rules, summary, graph, roles):
        self.rules, self.S, self.G, self.R = rules, summary, graph, roles
        self.th, self.tx = rules["thresholds"], rules["texts"]
        self.items = []
        self.skipped = []
        self.blocked = set()  # requires 缺输入的规则：不评估，已在 skipped 里登记

    def add(self, rule_id, tpl, vars_, target, evidence, severity=None, suffix=None, title_extra="", detail_extra=""):
        if rule_id in self.blocked:
            return
        vars_ = {k: sv(v) for k, v in vars_.items()}
        item_id = rule_id + (":" + target[1] if target[1] else "") + (":" + suffix if suffix else "")
        self.items.append({
            "id": item_id, "rule": rule_id, "severity": severity or tpl["severity"], "category": tpl["category"],
            "target": target[1] or "global",
            "title_zh": render(tpl["title_zh"], vars_) + title_extra,
            "detail_zh": render(tpl["detail_zh"], vars_) + detail_extra,
            "evidence": evidence, "action_zh": render(tpl["action_zh"], vars_), "confidence": tpl["confidence"]})

    def rule(self, rid):
        return self.rules["rules"][rid]


def ev(ref_file, pointer, value, unit=None):
    """证据：path 是 JSON Pointer（文件名#路径），value 是该字段的原值；kW 字段自动带 unit。"""
    e = {"path": f"{ref_file}#{pointer}", "value": value}
    unit = unit or ("kW" if pointer.endswith("/kW") else None)
    if unit:
        e["unit"] = unit
    return e


def block_lines(b):
    return ([b["blkmsg"]] if b.get("blkmsg") else []) + list(b.get("per_error") or [])


def line_pointer(b, i, k):
    off = 1 if b.get("blkmsg") else 0
    return f"/blocks/{i}/blkmsg" if (b.get("blkmsg") and k == 0) else f"/blocks/{i}/per_error/{k - off}"


# --------------------------------------------------------------------------- 各类规则
def _status_rules(c):
    S, st = c.S, c.S["status"]
    if st["state"] == "error" or st["errors"]:
        first = st["errors"][0] if st["errors"] else c.tx["unnamed"]
        e = [ev(SUMMARY_FILE, "/status/state", st["state"])] + [ev(SUMMARY_FILE, f"/status/errors/{k}", x) for k, x in enumerate(st["errors"][:2])]
        c.add("status.error", c.rule("status.error"), {"count": len(st["errors"]), "first": first}, ("global", None), e)
    if st["run_completed"] is False:
        c.add("status.incomplete", c.rule("status.incomplete"), {}, ("global", None), [ev(SUMMARY_FILE, "/status/run_completed", False)])
    for key, kind in (("errors", "错误"), ("warnings", "警告")):
        for k, text in enumerate(st[key]):
            if not re.match(r"^块 ([^：]+)：", text):
                c.add("status.global-warning", c.rule("status.global-warning"), {"kind": kind, "text": text}, ("global", None),
                      [ev(SUMMARY_FILE, f"/status/{key}/{k}", text)], suffix=f"{key}-{k}",
                      severity="warn" if key == "errors" else None)
    if S["model"].get("source_unchanged") is False:
        c.add("status.source-modified", c.rule("status.source-modified"), {}, ("global", None),
              [ev(SUMMARY_FILE, "/model/source_unchanged", False)])


def _extract(pattern_extract, text):
    out = {}
    for name, rx in pattern_extract.items():
        vals = uniq([m.group(1) for m in re.finditer(rx, text)])
        out[name] = join_zh(vals) if vals else None
    return out


def _block_rules(c):
    th, tx = c.th, c.tx
    for i, b in enumerate(c.S["blocks"]):
        lines = block_lines(b)
        text = "\n".join(lines)
        total = b.get("per_error_total")
        per = b.get("per_error") or []
        truncated = (total is not None and total > len(per)) or (total is None and len(lines) >= th["per_error_cap"])
        note = render(tx["truncated"], {"n": len(per) if total is not None else len(lines)}) if truncated else ""
        base = [ev(SUMMARY_FILE, f"/blocks/{i}/status", b["status"]), ev(SUMMARY_FILE, f"/blocks/{i}/blkstat", b["blkstat"])]
        matched = False
        for pat in c.rules["message_patterns"]:
            rx = re.compile(pat["regex"], re.I)
            if not rx.search(text):
                continue
            matched = True
            vars_ = {"block": b["id"], "type": b["type"]}
            for name, val in _extract(pat["extract"], text).items():
                vars_[name] = val if val is not None else tx["unknown"]
            sev = pat["severity"]
            extra = ""
            if b["status"] == "error":
                sev = "critical"
            elif b["status"] == "ok":
                sev, extra = "suggest", tx["status_ok_suffix"]
            hits = [ev(SUMMARY_FILE, line_pointer(b, i, k), ln) for k, ln in enumerate(lines) if rx.search(ln)][:2]
            c.add(pat["id"], pat, vars_, ("block", b["id"]), base + hits, severity=sev, title_extra=extra, detail_extra=note)
        if b["status"] in ("warning", "error") and not matched:
            rid = "block.unmatched-error" if b["status"] == "error" else "block.unmatched-warning"
            exc = " / ".join(x.strip() for x in lines[:3]) or tx["unnamed"]
            c.add(rid, c.rule(rid), {"block": b["id"], "type": b["type"], "blkstat": "未读到" if b["blkstat"] is None else b["blkstat"], "excerpt": exc},
                  ("block", b["id"]), base, detail_extra=note)
        if b["status"] == "unknown":
            c.add("block.status-unknown", c.rule("block.status-unknown"), {"block": b["id"], "type": b["type"]}, ("block", b["id"]), base)


def _all_units(S):
    return uniq([e["unit"] for b in S["blocks"] for e in b["energy"]])


def _unit_rules(c):
    S = c.S
    units = _all_units(S)
    u = S.get("units") or {}
    if any(x != "kW" for x in units):
        c.add("units.non-si-set", c.rule("units.non-si-set"),
              {"inset": u.get("INSET", "?"), "outset": u.get("OUTSET", "?"), "units": join_zh(units), "calorie": S["calorie_J"]},
              ("global", None), [ev(SUMMARY_FILE, "/units/INSET", u.get("INSET")), ev(SUMMARY_FILE, "/units/OUTSET", u.get("OUTSET"))] +
              [ev(SUMMARY_FILE, "/calorie_J", S["calorie_J"])])
    if any("cal" in x.lower() for x in units) and S["calorie_J"] != c.th["standard_calorie_J"]:
        c.add("units.calorie-definition", c.rule("units.calorie-definition"), {"calorie": S["calorie_J"]}, ("global", None),
              [ev(SUMMARY_FILE, "/calorie_J", S["calorie_J"])])
    nulls = [(i, j, b, e) for i, b in enumerate(S["blocks"]) for j, e in enumerate(b["energy"]) if e["kW"] is None]
    if nulls:
        items = "；".join(f"{b['id']} {sv(e['value'])} {e['unit']}" for _, _, b, e in nulls)
        c.add("units.kw-null", c.rule("units.kw-null"), {"count": len(nulls), "items": items}, ("global", None),
              [ev(SUMMARY_FILE, f"/blocks/{i}/energy/{j}/kW", None) for i, j, _, _ in nulls][:5])


def _external(S):
    """[(block_index, block, energy_index, energy)]：非内部换热、kW 已知。"""
    return [(i, b, j, e) for i, b in enumerate(S["blocks"]) for j, e in enumerate(b["energy"])
            if e.get("role_hint") != "exchanged" and e["kW"] is not None]


def _energy_rules(c):
    S, th = c.S, c.th
    ext = _external(S)
    per_block = {}
    for i, b, j, e in ext:
        per_block.setdefault(i, 0.0)
        per_block[i] += abs(e["kW"])
    total = sum(per_block.values())
    if total > 0 and len(per_block) >= 2:
        ranked = sorted(per_block.items(), key=lambda kv: (-kv[1], kv[0]))
        top = [(i, v) for i, v in ranked if v / total >= th["hotspot_min_share"]][: th["hotspot_top_n"]]
        if top:
            ids = [S["blocks"][i]["id"] for i, _ in top]
            lst = "、".join(f"{S['blocks'][i]['id']} {pct(v / total)}%（{num(v)} kW）" for i, v in top)
            e = [ev(SUMMARY_FILE, f"/blocks/{i}/energy/{j}/kW", en["kW"]) for i, b, j, en in ext if i in dict(top)]
            c.add("energy.hotspot", c.rule("energy.hotspot"), {"top": join_zh(ids), "total": num(total), "list": lst}, ("global", None), e)
    else:
        c.skipped.append({"rule": "energy.hotspot", "reason_zh": "少于两个块有外部能量项，不做热点排序"})
    warned = {i: v for i, v in per_block.items() if S["blocks"][i]["status"] in ("warning", "error")}
    if total > 0 and sum(warned.values()) / total >= th["warning_share_min"]:
        w = sum(warned.values())
        blocks = "、".join(f"{S['blocks'][i]['id']}（{num(v)} kW）" for i, v in sorted(warned.items()))
        e = [ev(SUMMARY_FILE, f"/blocks/{i}/status", S["blocks"][i]["status"]) for i in sorted(warned)]
        c.add("energy.warning-share", c.rule("energy.warning-share"),
              {"share": pct(w / total), "total": num(total), "warned": num(w), "blocks": blocks}, ("global", None), e)
    exch = [(i, b, j, e) for i, b in enumerate(S["blocks"]) for j, e in enumerate(b["energy"])
            if e.get("role_hint") == "exchanged" and e["kW"] is not None]
    if exch:
        g = S.get("group_totals") or {}
        f = lambda k: "未知" if (g.get(k) or {}).get("kW") is None else num(g[k]["kW"])
        c.add("energy.internal-exchange", c.rule("energy.internal-exchange"),
              {"blocks": join_zh(uniq([b["id"] for _, b, _, _ in exch])), "exchange": num(sum(e["kW"] for *_, e in exch)),
               "heating": f("heating"), "cooling": f("cooling")}, ("global", None),
              [ev(SUMMARY_FILE, f"/blocks/{i}/energy/{j}/kW", e["kW"]) for i, b, j, e in exch])
    if S["blocks"] and not any(b["energy"] for b in S["blocks"]):
        c.add("energy.none", c.rule("energy.none"), {}, ("global", None), [ev(SUMMARY_FILE, f"/blocks/{i}/energy", []) for i in range(min(5, len(S["blocks"])))])
    expected = {t.lower() for t in c.rules["energy_expected_types"]}
    for i, b in enumerate(S["blocks"]):
        if not b["energy"] and b["type"].lower() in expected:
            c.add("energy.block-missing", c.rule("energy.block-missing"), {"block": b["id"], "type": b["type"]}, ("block", b["id"]),
                  [ev(SUMMARY_FILE, f"/blocks/{i}/energy", [])])


# ---- 热集成
def _stream_T(G, sid):
    for k, s in enumerate(G["streams"]):
        if s["id"] == sid:
            t = (s.get("total") or {})
            if "T" in t and t.get("T_unit"):
                K = to_K(t["T"], t["T_unit"])
                if K is not None:
                    return K, [ev(GRAPH_FILE, f"/streams/{k}/total/T", t["T"], t["T_unit"])]
    return None


def _block_T(G, bid, which):
    for k, b in enumerate(G["blocks"]):
        if b["id"] != bid:
            continue
        r = b.get("inlet_temperature" if which == "in" else "outlet_temperature")
        if r and "value" in r and r.get("unit"):
            K = to_K(r["value"], r["unit"])
            if K is not None:
                return K, [ev(GRAPH_FILE, f"/blocks/{k}/{'inlet' if which == 'in' else 'outlet'}_temperature/value", r["value"], r["unit"])]
        ports = (b.get("ports") or {}).get("in" if which == "in" else "out", [])
        if len(ports) == 1:
            return _stream_T(G, ports[0])
    return None


def _overlap(hot, cold, dT, iso):
    lo_h, hi_h = hot["tout"] - dT, hot["tin"] - dT
    if hot["tin"] < hot["tout"] or cold["tout"] < cold["tin"]:
        return None
    iso_h, iso_c = (hot["tin"] - hot["tout"]) < iso, (cold["tout"] - cold["tin"]) < iso
    clamp = lambda x: max(0.0, min(1.0, x))
    if iso_h and iso_c:
        ok, fh, fc = hi_h >= cold["tin"], 1.0, 1.0
    elif iso_h:
        ok, fh, fc = hi_h >= cold["tin"], 1.0, clamp((min(hi_h, cold["tout"]) - cold["tin"]) / (cold["tout"] - cold["tin"]))
    elif iso_c:
        ok, fh, fc = hi_h >= cold["tin"], clamp((hi_h - max(cold["tin"], lo_h)) / (hi_h - lo_h)), 1.0
    else:
        L = min(hi_h, cold["tout"]) - max(lo_h, cold["tin"])
        ok, fh, fc = L > 0, L / (hi_h - lo_h), L / (cold["tout"] - cold["tin"])
    if not ok:
        return None
    return min(abs(hot["kW"]) * fh, cold["kW"] * fc)


def _heat_integration(c):
    S, G = c.S, c.G
    gt = S.get("group_totals") or {}
    heating, cooling = (gt.get("heating") or {}).get("kW"), (gt.get("cooling") or {}).get("kW")
    if not heating or not cooling or heating <= 0 or cooling >= 0:
        return
    base = [ev(SUMMARY_FILE, "/group_totals/heating/kW", heating), ev(SUMMARY_FILE, "/group_totals/cooling/kW", cooling)]
    vars_ = {"heating": num(heating), "cooling": num(cooling)}
    if G is None:  # requires=['graph']，已在 skipped 里登记
        return
    dT, iso = c.th["heat_integration_dTmin_K"], c.th["isothermal_span_K"]
    hot, cold, mixed = [], [], []
    for i, b in enumerate(S["blocks"]):
        es = [e for e in b["energy"] if e["kind"] == "heat" and e.get("role_hint") != "exchanged"]
        if not es or any(e["kW"] is None for e in es):
            continue
        q = sum(e["kW"] for e in es)
        if not (all(e["kW"] >= 0 for e in es) or all(e["kW"] <= 0 for e in es)):
            mixed.append(b["id"])
            continue
        if q == 0:
            continue
        tin, tout = _block_T(G, b["id"], "in"), _block_T(G, b["id"], "out")
        if tin is None or tout is None:
            continue
        rec = {"id": b["id"], "kW": q, "tin": tin[0], "tout": tout[0],
               "ev": [ev(SUMMARY_FILE, f"/blocks/{i}/energy/{j}/kW", e["kW"]) for j, e in enumerate(b["energy"]) if e in es] + tin[1] + tout[1]}
        (cold if q > 0 else hot).append(rec)
    if not hot or not cold:
        missing, why = "进出口温度", "graph.json 里的加热/冷却块缺少进口或出口温度（或进口不止一股）"
        if mixed:
            missing, why = c.tx["hi_mixed_missing"], c.tx["hi_mixed_why"]
        c.add("heat-integration.data-missing", c.rule("heat-integration.data-missing"), dict(vars_, missing=missing, why=why),
              ("global", None), base)
        return
    pairs = []
    for h in hot:
        for k in cold:
            bound = _overlap(h, k, dT, iso)
            if bound is not None and bound >= c.th["heat_integration_min_kW"]:
                pairs.append((bound, h, k))
    pairs.sort(key=lambda p: -p[0])
    if not pairs:
        c.add("heat-integration.none", c.rule("heat-integration.none"), {"dtmin": num(dT, 0)}, ("global", None), base)
        return
    for bound, h, k in pairs[: c.th["heat_integration_top_n"]]:
        c.add("heat-integration.overlap", c.rule("heat-integration.overlap"),
              {"hot": h["id"], "cold": k["id"], "hot_tin": num(h["tin"], 1), "hot_tout": num(h["tout"], 1), "hot_kw": num(abs(h["kW"])),
               "cold_tin": num(k["tin"], 1), "cold_tout": num(k["tout"], 1), "cold_kw": num(k["kW"]), "dtmin": num(dT, 0), "bound": num(bound)},
              ("block", h["id"]), h["ev"] + k["ev"], suffix=k["id"])


def _mass_balance(c):
    G = c.G
    if G is None:  # requires=['graph']，已在 skipped 里登记
        return
    ins, outs, units = [], [], set()
    for k, s in enumerate(G["streams"]):
        t = s.get("total") or {}
        if s.get("class") != "MATERIAL" or "mass_flow" not in t:
            continue
        if s.get("from") == "BOUNDARY" and s.get("to") != "BOUNDARY":
            ins.append((k, t["mass_flow"])); units.add(t.get("mass_unit"))
        elif s.get("to") == "BOUNDARY" and s.get("from") != "BOUNDARY":
            outs.append((k, t["mass_flow"])); units.add(t.get("mass_unit"))
    if not ins or not outs or len(units) != 1 or None in units or "" in units:
        c.skipped.append({"rule": "convergence.mass-balance", "reason_zh": "边界物流缺质量流量或单位不一致，无法检查"})
        return
    tin, tout = sum(v for _, v in ins), sum(v for _, v in outs)
    if tin <= 0:
        return
    rel = abs(tin - tout) / tin
    if rel > c.th["mass_balance_rel_tol"]:
        unit = next(iter(units))
        c.add("convergence.mass-balance", c.rule("convergence.mass-balance"),
              {"in": num(tin, 3), "out": num(tout, 3), "unit": unit, "rel": num(100 * rel, 2), "tol": num(100 * c.th["mass_balance_rel_tol"], 2)},
              ("global", None), [ev(GRAPH_FILE, f"/streams/{k}/total/mass_flow", v, unit) for k, v in ins + outs][:8])


def _completeness(c):
    S = c.S
    gt = S.get("group_totals") or {}
    nulls = [k for k in ("heating", "cooling", "shaft_work", "internal_exchange") if (gt.get(k) or {}).get("kW") is None]
    if S["totals_complete"] is False or nulls:
        c.add("data-completeness.totals-incomplete", c.rule("data-completeness.totals-incomplete"),
              {"nulls": join_zh(nulls) if nulls else c.tx["none"]}, ("global", None),
              [ev(SUMMARY_FILE, "/totals_complete", S["totals_complete"]), ev(SUMMARY_FILE, "/group_totals", gt)])
    gaps = S["energy_gaps"]
    if gaps:
        c.add("data-completeness.energy-gaps", c.rule("data-completeness.energy-gaps"),
              {"count": len(gaps), "gaps": "；".join(f"{g['block'] or c.tx['global']}：{g['reason']}" for g in gaps)}, ("global", None),
              [ev(SUMMARY_FILE, f"/energy_gaps/{k}", g) for k, g in enumerate(gaps[:3])])
    d = S["discovery"]
    if d.get("complete") is False:
        c.add("data-completeness.discovery-incomplete", c.rule("data-completeness.discovery-incomplete"),
              {"nodes": d.get("nodes_read", c.tx["unknown"])}, ("global", None), [ev(SUMMARY_FILE, "/discovery/complete", False)])
    um = d.get("unmatched_block_types") or []
    if um:
        c.add("data-completeness.unmatched-block-types", c.rule("data-completeness.unmatched-block-types"), {"types": join_zh(um)},
              ("global", None), [ev(SUMMARY_FILE, "/discovery/unmatched_block_types", um)])
    paths, e = [], []
    for k, u in enumerate(S.get("unverified_paths") or []):
        paths.append((u["block"], u["path"])); e.append(ev(SUMMARY_FILE, f"/unverified_paths/{k}", u))
    for i, b in enumerate(S["blocks"]):
        for j, en in enumerate(b["energy"]):
            if en.get("verified") is False:
                paths.append((b["id"], en["path"])); e.append(ev(SUMMARY_FILE, f"/blocks/{i}/energy/{j}/verified", False))
    seen, ordered = set(), []
    for blk, p in paths:
        if p not in seen:
            seen.add(p); ordered.append((blk, p))
    if ordered:
        shown = "；".join(f"{blk or c.tx['global']} {p}" for blk, p in ordered[:5])
        if len(ordered) > 5:
            shown += " " + render(c.tx["more"], {"n": len(ordered)})
        c.add("data-completeness.unverified-paths", c.rule("data-completeness.unverified-paths"), {"count": len(ordered), "paths": shown},
              ("global", None), e[:5])
    st = S.get("study")
    if st and st.get("ok") is False:
        err = " ".join(str(st.get("error", "")).split())[:120] or c.tx["unknown"]
        c.add("data-completeness.study-failed", c.rule("data-completeness.study-failed"), {"error": err}, ("global", None),
              [ev(SUMMARY_FILE, "/study/ok", False)])


def _lca(c):
    S, G, R = c.S, c.G, c.R
    sha = S["model"]["sha256"]
    for which, doc, name in (("graph.json", G, "model"), ("roles.json", R, None)):
        if doc is None:
            continue
        other = doc["model"]["sha256"] if name else doc.get("model_sha256")
        if other != sha:
            c.add("lca-readiness.sha-mismatch", c.rule("lca-readiness.sha-mismatch"), {"which": which}, ("global", None),
                  [ev(SUMMARY_FILE, "/model/sha256", sha), ev(which, "/model/sha256" if name else "/model_sha256", other)], suffix=which)
    if R is None:  # roles 相关规则 requires=['roles']，已在 skipped 里登记
        return
    streams, review = R.get("streams", {}), R.get("review", {})
    if review.get("state") != "reviewed":
        pend = review.get("pending", [])
        shown = "；".join(pend[:5]) + ((" " + render(c.tx["more"], {"n": len(pend)})) if len(pend) > 5 else "")
        c.add("lca-readiness.roles-draft", c.rule("lca-readiness.roles-draft"),
              {"pending": len(pend), "state": review.get("state", c.tx["unknown"]), "items": shown or c.tx["none"]}, ("global", None),
              [ev(ROLES_FILE, "/review/state", review.get("state"))])
    products = [k for k, v in streams.items() if v.get("role") == "product"]
    if not products:
        c.add("lca-readiness.no-product", c.rule("lca-readiness.no-product"), {}, ("global", None), [ev(ROLES_FILE, "/streams", streams)])
    method = (R.get("allocation") or {}).get("method")
    if len(products) > 1 and method in (None, "none"):
        c.add("lca-readiness.multi-product", c.rule("lca-readiness.multi-product"),
              {"products": join_zh(products), "method": method or c.tx["none"]}, ("global", None), [ev(ROLES_FILE, "/allocation/method", method)])
    fu = R.get("functional_unit")
    if not fu:
        c.add("lca-readiness.no-functional-unit", c.rule("lca-readiness.no-functional-unit"), {}, ("global", None), [ev(ROLES_FILE, "/functional_unit", None)])
    elif fu.get("stream") not in products:
        role = (streams.get(fu.get("stream")) or {}).get("role") or c.tx["unlabeled"]
        c.add("lca-readiness.fu-stream-mismatch", c.rule("lca-readiness.fu-stream-mismatch"), {"stream": fu.get("stream"), "role": role},
              ("stream", fu.get("stream")), [ev(ROLES_FILE, "/functional_unit/stream", fu.get("stream"))])
    for sid in products:
        pv = streams[sid].get("provenance") or {}
        conf = pv.get("confidence")
        if pv.get("source") == "auto" and ((conf is not None and conf < c.th["low_confidence_below"]) or pv.get("needs_confirmation")):
            c.add("lca-readiness.product-low-confidence", c.rule("lca-readiness.product-low-confidence"),
                  {"stream": sid, "conf": "未读到" if conf is None else num(conf, 2), "reasons": "；".join(pv.get("reasons", [])) or c.tx["unknown"]},
                  ("stream", sid), [ev(ROLES_FILE, f"/streams/{sid}/provenance/confidence", conf)])
    guess = []
    energy_blocks = {b["id"] for b in S["blocks"] if any(e.get("role_hint") != "exchanged" for e in b["energy"])}
    for bid, v in R.get("blocks", {}).items():
        pv = v.get("provenance") or {}
        if bid in energy_blocks and pv.get("needs_confirmation"):
            guess.append((bid, v.get("utility") or c.tx["undecided"]))
    if guess:
        c.add("lca-readiness.utility-guess", c.rule("lca-readiness.utility-guess"),
              {"count": len(guess), "items": "；".join(f"{b}→{u}" for b, u in guess)}, ("global", None),
              [ev(ROLES_FILE, f"/blocks/{b}/utility", u) for b, u in guess][:5])
    nofk = [sid for sid, v in streams.items() if v.get("role") == "feed" and (v.get("inventory") or {}).get("kind") == "material"
            and not (v.get("inventory") or {}).get("factor_key")]
    if nofk:
        c.add("lca-readiness.no-factor-key", c.rule("lca-readiness.no-factor-key"), {"streams": join_zh(nofk)}, ("global", None),
              [ev(ROLES_FILE, f"/streams/{s}/inventory", streams[s].get("inventory")) for s in nofk][:5])


# --------------------------------------------------------------------------- 文件之间的一致性（与 result_package.validate_package 同语义）
def package_problems(summary, graph=None, roles=None):
    """上传/命令行在分析前拒绝的问题（中文）：三份文件必须来自同一个模型、同一张流程图，源文件在体检期间没被改动。
    只检查给出的文件；缺 graph / roles 不算问题（建议里会说明哪些检查被跳过）。advise() 本身不抛这些问题。"""
    S = upgrade_summary(summary)
    out, sha = [], S["model"]["sha256"]
    if S["model"].get("source_unchanged") is False:
        out.append("probe-summary.json：体检期间源模型文件被改动（source_unchanged=false），结果对应的模型版本不确定。")
    if graph is not None:
        if (graph.get("model") or {}).get("sha256") != sha:
            out.append("graph.json 与 probe-summary.json 来自不同的模型（sha256 不一致）。")
        if {b["id"] for b in graph.get("blocks", [])} != {b["id"] for b in S["blocks"]}:
            out.append("probe-summary.json 的块与 graph.json 的块不一致。")
    if roles is not None:
        if roles.get("model_sha256") != sha:
            out.append("roles.json 与 probe-summary.json 来自不同的模型（sha256 不一致）。")
        if graph is not None:
            if "blocks" in roles and set(roles["blocks"]) != {b["id"] for b in graph.get("blocks", [])}:
                out.append("roles.json 的块与 graph.json 的块不一致。")
            if set(roles.get("streams", {})) != {s["id"] for s in graph.get("streams", [])}:
                out.append("roles.json 的流股与 graph.json 的流股不一致。")
    return out


# --------------------------------------------------------------------------- 入口
INPUT_FILES = (("graph", GRAPH_FILE), ("roles", ROLES_FILE))


def _skip_missing_inputs(c):
    """规则表里每条规则的 requires（graph / roles）缺了就整条跳过，并按规则表顺序登记到 skipped。"""
    have = {"graph": c.G is not None, "roles": c.R is not None}
    for rid, rule in c.rules["rules"].items():
        missing = [name for name, _ in INPUT_FILES if name in rule.get("requires", []) and not have[name]]
        if missing:
            files = [f for name, f in INPUT_FILES if name in missing]
            c.blocked.add(rid)
            c.skipped.append({"rule": rid, "missing_inputs": missing, "reason_zh": render(c.tx["skipped_missing"], {"files": join_zh(files)})})


def advise(summary, graph=None, roles=None, rules=None):
    rules = rules or load_rules()
    S = upgrade_summary(summary)
    c = _Ctx(rules, S, graph, roles)
    _skip_missing_inputs(c)
    for fn in (_status_rules, _block_rules, _unit_rules, _energy_rules, _heat_integration, _mass_balance, _completeness, _lca):
        fn(c)
    order = {k: n for n, k in enumerate(CAT_ORDER)}
    ranked = sorted(enumerate(c.items), key=lambda p: (SEV_RANK[p[1]["severity"]], order[p[1]["category"]], p[0]))
    items = [it for _, it in ranked]
    counts = {k: sum(1 for it in items if it["severity"] == k) for k in SEV_RANK}
    counts["total"] = len(items)
    return {"schema": ADVICE_SCHEMA, "rules_version": rules["version"],
            "model": {"file": S["model"]["file"], "sha256": S["model"]["sha256"]},
            "inputs": {"probe": PROBE_SCHEMA, "migrated_from": S.get("migrated_from"), "graph": G_present(graph), "roles": G_present(roles)},
            "counts": counts, "items": items, "skipped": c.skipped}


def G_present(x):
    return x is not None
