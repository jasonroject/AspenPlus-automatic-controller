"""Heuristic role classification on an aspen-model-graph/1 document.

Every suggestion carries a confidence in [0, 1], human-readable reasons and a
needs_confirmation flag. The product stream and the functional unit are
ALWAYS flagged for confirmation: they cannot be inferred reliably from a
flowsheet. Nothing here reads Aspen; it works on graph.json only.
"""
from __future__ import annotations

import re

from .schema_check import validate
from .units import temperature_C

CONFIRM_BELOW = 0.75

# Aspen Plus block model names -> block role. Matching is case-insensitive.
BLOCK_TYPES = {
    "heater": "heater",
    "heatx": "heat_exchanger", "mheatx": "heat_exchanger", "hxflux": "heat_exchanger",
    "flash2": "separator", "flash3": "separator", "decanter": "separator", "sep": "separator",
    "sep2": "separator", "cyclone": "separator", "filter": "separator", "swash": "separator",
    "radfrac": "column", "dstwu": "column", "distl": "column", "extract": "column",
    "multifrac": "column", "petrofrac": "column", "batchsep": "column",
    "rstoic": "reactor", "ryield": "reactor", "requil": "reactor", "rgibbs": "reactor",
    "rcstr": "reactor", "rplug": "reactor", "rbatch": "reactor",
    "pump": "pump", "compr": "compressor", "mcompr": "compressor",
    "mixer": "mixer_splitter", "fsplit": "mixer_splitter", "ssplit": "mixer_splitter",
    "valve": "valve", "pipe": "valve", "pipeline": "valve",
}
ADIABATIC_ROLES = {"mixer_splitter", "valve"}

# Identified by CAS first, then by common Aspen component IDs.
GAS_CAS = {"124-38-9": "CO2", "74-82-8": "CH4", "7727-37-9": "N2", "7782-44-7": "O2",
           "630-08-0": "CO", "10024-97-2": "N2O", "1333-74-0": "H2", "7440-37-1": "AR",
           "7783-06-4": "H2S", "7446-09-5": "SO2", "7664-41-7": "NH3"}
GAS_IDS = set(GAS_CAS.values()) | {"AIR", "NO", "NO2", "C2H6", "C2H4", "C3H8"}
WATER_CAS, WATER_IDS = "7732-18-5", {"H2O", "WATER"}
GHG_CAS = {"124-38-9", "74-82-8", "10024-97-2"}

KEYWORDS = {
    "product": re.compile(r"PROD|PRODUCT|产品|TARGET|PURE", re.I),
    "emission": re.compile(r"VENT|FLUE|PURGE|OFFGAS|OFF-GAS|STACK|EXHAUST|排放|尾气", re.I),
    "waste": re.compile(r"WASTE|WW|ASH|SLUDGE|RESID|BOTTOMS?-W|废", re.I),
}


def _component_index(graph):
    return {c["id"]: c for c in graph.get("components", [])}


def _composition(stream):
    """Return {component_id: mass} summed over substreams, or {}."""
    total = {}
    for sub in (stream.get("substreams") or {}).values():
        for comp, mass in (sub.get("mass_by_component") or {}).items():
            total[comp] = total.get(comp, 0.0) + float(mass)
    return total


def _fractions(stream, comps):
    composition = _composition(stream)
    mass = sum(composition.values())
    if mass <= 0:
        return None
    gas = water = ghg = 0.0
    for cid, m in composition.items():
        info = comps.get(cid, {})
        cas = info.get("cas")
        if cas == WATER_CAS or cid.upper() in WATER_IDS:
            water += m
        elif cas in GAS_CAS or cid.upper() in GAS_IDS:
            gas += m
        if cas in GHG_CAS or cid.upper() in {"CO2", "CH4", "N2O"}:
            ghg += m
    return {"gas": gas / mass, "water": water / mass, "ghg": ghg / mass, "other": 1 - (gas + water) / mass,
            "composition": composition, "mass": mass}


def _recycle_streams(graph):
    """Material streams inside a strongly connected block cycle (Tarjan)."""
    # Two-sided heat exchangers join two separate material paths; a cycle
    # through them is heat integration, not a material recycle.
    streams_by_id = {s["id"]: s for s in graph["streams"]}
    exchangers = {b["id"] for b in graph["blocks"] if BLOCK_TYPES.get(b["type"].lower()) == "heat_exchanger"
                  and sum(streams_by_id.get(x, {}).get("class") == "MATERIAL" for x in b["ports"]["in"]) >= 2}
    edges = {}
    for s in graph["streams"]:
        if s["from"] in exchangers or s["to"] in exchangers:
            continue
        if s["class"] == "MATERIAL" and s["from"] != "BOUNDARY" and s["to"] != "BOUNDARY":
            edges.setdefault(s["from"], set()).add(s["to"])
    index, low, stack, on, comp_of, counter = {}, {}, [], set(), {}, [0]

    def strong(v):
        index[v] = low[v] = counter[0]; counter[0] += 1
        stack.append(v); on.add(v)
        for w in edges.get(v, ()):
            if w not in index:
                strong(w); low[v] = min(low[v], low[w])
            elif w in on:
                low[v] = min(low[v], index[w])
        if low[v] == index[v]:
            members = []
            while True:
                w = stack.pop(); on.discard(w); members.append(w)
                if w == v:
                    break
            for w in members:
                comp_of[w] = (v, len(members))

    for b in [b["id"] for b in graph["blocks"]]:
        if b not in index:
            strong(b)
    return {s["id"] for s in graph["streams"]
            if s["class"] == "MATERIAL" and s["from"] in comp_of and s["to"] in comp_of
            and comp_of[s["from"]] == comp_of[s["to"]] and comp_of[s["from"]][1] > 1}


def _prov(confidence, reasons, force_confirm=False):
    return {"source": "auto", "confidence": round(confidence, 2), "reasons": reasons,
            "needs_confirmation": force_confirm or confidence < CONFIRM_BELOW}


def suggest_hot_utility(t_out_C, approach_K=10.0):
    """Lowest utility grade that can supply heat at t_out + approach (rule of thumb)."""
    if t_out_C is None:
        return "unassigned", 0.3, "出口温度未知，无法推荐加热等级"
    need = t_out_C + approach_K
    for limit, utility in ((150, "lp_steam"), (210, "mp_steam"), (250, "hp_steam")):
        if need <= limit:
            return utility, 0.55, f"出口 {t_out_C:.0f} °C + {approach_K:.0f} K 温差 ≤ {limit} °C → {utility}（经验分级，需确认）"
    return "fired_heat", 0.55, f"出口 {t_out_C:.0f} °C 高于高压蒸汽可及范围 → 加热炉/燃料（需确认）"


def suggest_cold_utility(t_out_C, approach_K=10.0):
    if t_out_C is None:
        return "unassigned", 0.3, "出口温度未知，无法推荐冷却方式"
    if t_out_C - approach_K >= 25:
        return "cooling_water", 0.6, f"出口 {t_out_C:.0f} °C 可由冷却水（约 25–35 °C）冷却"
    return "refrigeration", 0.5, f"出口 {t_out_C:.0f} °C 低于冷却水可及范围 → 冷冻"


def _block_outlet_temperature(block, streams_by_id):
    if block.get("outlet_temperature"):
        r = block["outlet_temperature"]
        return temperature_C(r["value"], r["unit"])
    temps = []
    for sid in block["ports"]["out"]:
        total = (streams_by_id.get(sid) or {}).get("total") or {}
        t = temperature_C(total.get("T"), total.get("T_unit"))
        if t is not None:
            temps.append(t)
    return max(temps) if temps else None


def classify_blocks(graph):
    streams_by_id = {s["id"]: s for s in graph["streams"]}
    out = {}
    for block in graph["blocks"]:
        btype = block["type"].lower()
        role = BLOCK_TYPES.get(btype, "other")
        reasons = [f"块类型 {block['type']} → {role}" if role != "other" else f"未知块类型 {block['type']}"]
        conf = 0.9 if role != "other" else 0.3
        heat = [e for e in block["energy"] if e["kind"] == "heat"]
        work = [e for e in block["energy"] if e["kind"] == "work"]
        entry = {"role": role}
        material_in = [s for s in block["ports"]["in"] if streams_by_id.get(s, {}).get("class") == "MATERIAL"]
        if role == "heat_exchanger":
            if len(material_in) >= 2:
                entry.update(role="internal_recovery", utility="none")
                reasons.append("两侧均为流程物料流 → 内部换热，不计外购公用工程")
                conf = 0.85
            else:
                role = "heater"; entry["role"] = "heater"
                reasons.append("只有一侧物料流 → 按单侧加热/冷却处理")
                conf = 0.6
        if role in ("pump", "compressor"):
            w = sum(e["value"] for e in work)
            if work and w < 0:
                entry.update(role="turbine", utility="electricity", credit=False)
                reasons.append("轴功为负（对外做功）→ 透平；默认不抵扣")
            else:
                entry["utility"] = "electricity"
                reasons.append("轴功 → 电力（默认电机效率需确认）")
        elif role in ADIABATIC_ROLES:
            entry["utility"] = "none"
        elif role != "internal_recovery" and heat:
            t_out = _block_outlet_temperature(block, streams_by_id)
            hinted = {}
            for e in heat:
                hint = e.get("role_hint")
                if e["value"] > 0:
                    u, c, r = suggest_hot_utility(t_out)
                elif e["value"] < 0:
                    u, c, r = suggest_cold_utility(t_out)
                else:
                    u, c, r = "none", 0.9, "负荷为 0"
                if hint:
                    hinted[hint] = u
                reasons.append(f"{hint or 'duty'}: {r}")
                conf = min(conf, c)
            if role == "heater":
                q = sum(e["value"] for e in heat)
                entry["role"] = "heater" if q >= 0 else "cooler"
            if hinted and len(heat) > 1:
                entry["duty_utilities"] = hinted
                entry["utility"] = next(iter(hinted.values()))
            else:
                entry["utility"] = (list(hinted.values()) or [None])[0] or (
                    suggest_hot_utility(t_out)[0] if sum(e["value"] for e in heat) > 0 else
                    suggest_cold_utility(t_out)[0] if sum(e["value"] for e in heat) < 0 else "none")
        elif not block["energy"] and role not in ADIABATIC_ROLES:
            entry["utility"] = "unassigned"
            reasons.append("没有读到负荷或功率；需显式给出 0 或补充节点")
            conf = min(conf, 0.4)
        entry["provenance"] = _prov(conf, reasons)
        out[block["id"]] = entry
    return out


def classify_streams(graph):
    comps = _component_index(graph)
    recycle = _recycle_streams(graph)
    out, outlet_candidates = {}, []
    for s in graph["streams"]:
        sid = s["id"]
        if s["class"] in ("HEAT", "WORK"):
            out[sid] = {"role": "utility", "provenance": _prov(0.9, [f"{s['class']} 流股 → 公用工程/能量流"])}
            continue
        mass = (s.get("total") or {}).get("mass_flow")
        if s["from"] == "BOUNDARY" and s["to"] == "BOUNDARY":
            out[sid] = {"role": "unclassified", "provenance": _prov(0.2, ["两端都是边界，未连接任何块"])}
        elif s["from"] == "BOUNDARY":
            reasons = ["来源为 BOUNDARY → 进料"]
            conf = 0.9 if mass and mass > 0 else 0.5
            if not mass:
                reasons.append("流量为 0 或缺失")
            out[sid] = {"role": "feed", "inventory": {"kind": "material"}, "provenance": _prov(conf, reasons)}
        elif s["to"] != "BOUNDARY":
            if sid in recycle:
                out[sid] = {"role": "recycle", "provenance": _prov(0.85, ["两端都在同一个块循环内 → 循环物流（边界上抵消）"])}
            else:
                out[sid] = {"role": "internal", "provenance": _prov(0.95, ["两端均为内部块"])}
        else:
            outlet_candidates.append(s)

    scored = []
    for s in outlet_candidates:
        sid, total = s["id"], s.get("total") or {}
        frac = _fractions(s, comps)
        vf = total.get("vapor_fraction")
        reasons, role, conf = [], None, 0.4
        if KEYWORDS["emission"].search(sid):
            role, conf = "emission", 0.75; reasons.append("名称含排放类关键词")
        elif KEYWORDS["waste"].search(sid):
            role, conf = "waste", 0.7; reasons.append("名称含废物类关键词")
        if frac:
            if role is None and (frac["gas"] >= 0.5 or (vf is not None and vf >= 0.99 and frac["gas"] >= 0.2)):
                role, conf = "emission", 0.65
                reasons.append(f"不凝气占 {frac['gas']:.0%}" + (f"，汽相分率 {vf:.2f}" if vf is not None else ""))
            elif role is None and frac["water"] >= 0.8:
                role, conf = "waste", 0.6; reasons.append(f"水占 {frac['water']:.0%} → 废水候选")
        if role is None:
            score = (2 if KEYWORDS["product"].search(sid) else 0) + (frac["other"] if frac else 0.5)
            scored.append((score, (total.get("mass_flow") or 0), s, reasons))
            continue
        entry = {"role": role, "provenance": _prov(conf, reasons)}
        if role == "emission":
            entry["inventory"] = {"kind": "emission", "split_by_component": True}
        else:
            entry["inventory"] = {"kind": "waste"}
            entry["treatment"] = "wastewater" if frac and frac["water"] >= 0.8 else "unassigned"
        out[s["id"]] = entry

    if not scored:
        # Every outlet looked like emission/waste (e.g. a product dissolved in
        # water). Offer the outlet with the most non-water, non-gas mass as a
        # low-confidence product candidate rather than no candidate at all.
        best, best_other = None, 0.0
        for s in outlet_candidates:
            frac = _fractions(s, comps)
            other = frac["other"] * frac["mass"] if frac else 0.0
            if other > best_other:
                best, best_other = s, other
        if best is not None:
            out.pop(best["id"], None)
            scored.append((0.0, best_other, best, [f"所有出口都像排放/废物；{best['id']} 中非水非气组分质量最多 → 低置信度产品候选"]))
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    for rank, (score, mass, s, reasons) in enumerate(scored):
        if rank == 0:
            reasons = reasons + ["出口物流中“非水非气组分占比/名称”评分最高 → 产品候选"]
            if KEYWORDS["product"].search(s["id"]):
                reasons.append("名称含产品关键词")
            out[s["id"]] = {"role": "product", "provenance": _prov(0.6 if score >= 2 else 0.45 if score > 0 else 0.3, reasons, force_confirm=True)}
        else:
            out[s["id"]] = {"role": "coproduct", "provenance": _prov(0.35, reasons + ["其他非排放/非废物出口 → 副产品候选"], force_confirm=True)}
    return out


def classify(graph, region=None):
    """Return an aspen-roles/1 auto draft for a validated graph."""
    validate(graph, "graph")
    streams = classify_streams(graph)
    blocks = classify_blocks(graph)
    product = [sid for sid, r in streams.items() if r["role"] == "product"]
    roles = {"schema": "aspen-roles/1", "model_sha256": graph["model"]["sha256"],
             "streams": streams, "blocks": blocks,
             "allocation": {"method": "none"}, "system_boundary": "gate-to-gate",
             "review": {"state": "auto_draft", "pending": []}}
    if product:
        roles["functional_unit"] = {"basis": "product_mass", "amount": 1, "unit": "kg", "stream": product[0]}
    if region:
        roles["region"] = region
    roles["review"]["pending"] = pending_items(roles)
    validate(roles, "roles")
    return roles


def pending_items(roles, functional_unit_confirmed=False):
    items = [f"stream {sid}: {r['role']}" for sid, r in roles["streams"].items()
             if r.get("provenance", {}).get("needs_confirmation")]
    items += [f"block {bid}: {r['role']}/{r.get('utility', '-')}" for bid, r in roles["blocks"].items()
              if r.get("provenance", {}).get("needs_confirmation")]
    if "functional_unit" not in roles:
        items.append("functional_unit: 未找到产品候选，需手动指定")
    elif not functional_unit_confirmed:
        items.append("functional_unit: 需人工确认产品流股与组分")
    return items
