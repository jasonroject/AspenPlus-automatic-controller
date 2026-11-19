"""graph.json + roles + factor library -> five-table project -> universal-core -> results.

The accounting itself is done by analysis_web/universal-core.mjs through the
existing Node bridge (process_pipeline/assess_project.mjs). This module only
maps data in and out, and adds the visualisation fields agreed for
aspen-results/1. Missing data stays missing (never 0).
"""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

from .classifier import ADIABATIC_ROLES
from .factors import load_library, match, usable
from .schema_check import validate
from . import validation as V

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / "process_pipeline" / "assess_project.mjs"
INERT_EMISSIONS = {"N2", "O2", "AR", "H2O", "WATER", "HE"}
INERT_CAS = {"7727-37-9", "7782-44-7", "7440-37-1", "7732-18-5", "7440-59-7"}
HOT = {"lp_steam", "mp_steam", "hp_steam", "fired_heat", "natural_gas"}
COLD = {"cooling_water", "refrigeration", "air_cooling"}
SIGN = "块的 heat/work 以进入块为正，冷却与对外做功为负；energy_edges.value 为非负大小，方向由 source→target 表示"


def _composition(stream):
    total = {}
    for sub in (stream.get("substreams") or {}).values():
        for cid, m in (sub.get("mass_by_component") or {}).items():
            total[cid] = total.get(cid, 0.0) + float(m)
    return total


def _factor_query_for_key(key):
    kind, _, value = (key or "").partition(":")
    return {"cas": {"cas": value}, "alias": {"alias": value}, "component": {"component": value},
            "utility": {"utility": value}}.get(kind)


def build_project(graph, roles, case_id="case-1", entries=None, categories=("GWP100",), calorie_J=None):
    """Return (project, notes). `entries` defaults to the bundled library."""
    entries = load_library() if entries is None else entries
    comps = {c["id"]: c for c in graph["components"]}
    region = roles.get("region")
    src = f"graph {graph['model']['file']} sha256 {graph['model']['sha256'][:12]}…; case {case_id}"
    notes, used, rows = [], {}, []
    sroles, broles = roles["streams"], roles["blocks"]
    fu = roles.get("functional_unit") or {}
    meta = {"name": graph["model"]["file"], "steady_state": True,
            "enthalpy_basis": "Aspen 原生焓基准（全流程同一参考态）；Q/W 进入块为正",
            "boundary": roles.get("system_boundary", ""),
            "functional_unit": "1 kg declared product" + (f" ({fu.get('stream')}{': ' + '+'.join(fu['components']) if fu.get('components') else ''})" if fu else ""),
            "allocation_method": (roles.get("allocation") or {}).get("method", ""),
            "calorie_J": calorie_J, "inventory_complete": roles["review"]["state"] == "reviewed",
            "comparable_cases": False}
    project = {"schema_version": 1, "meta": meta, "cases": [], "streams": [], "blocks": [], "inventory": [], "factors": []}

    def add_row(ident, name, kind, amount, unit, query_list, row_source):
        """Pick the most specific factor for the primary category.

        universal-core keys factors by (id, category), so one inventory row
        carries one factor_id; further categories use library entries that
        share that id (otherwise the core marks them incomplete).
        """
        primary, chosen = categories[0], None
        for q in query_list:
            q = {**q, **({"region": region} if region and "utility" in q else {})}
            chosen = match(entries, q, primary)
            if chosen is not None:
                break
        if usable(chosen):
            fid = chosen["id"]
            for category in categories:
                same = next((e for e in entries if e["id"] == fid and e["category"] == category), None)
                if usable(same):
                    used[(fid, category)] = same
        else:
            fid = ("placeholder:" + chosen["id"]) if chosen else "missing:" + ident
        rows.append({"case_id": case_id, "id": ident, "name": name, "kind": kind, "amount": amount, "unit": unit,
                     "factor_id": fid, "source": f"{src}; {row_source}"})

    streams = {s["id"]: s for s in graph["streams"]}
    for s in graph["streams"]:
        if s["class"] != "MATERIAL":
            notes.append(f"{s['class']} 流股 {s['id']} 未进入衡算表；其能量按块负荷计（需真机确认无重复计算）")
            continue
        t = s.get("total") or {}
        row = {"case_id": case_id, "id": s["id"], "from": s["from"], "to": s["to"],
               "mass_flow": t.get("mass_flow", ""), "mass_unit": t.get("mass_unit", ""), "source": src}
        if t.get("enthalpy_flow") is not None:
            row.update(enthalpy_flow=t["enthalpy_flow"], energy_unit=t.get("energy_unit", ""))
        elif t.get("h_mass") is not None:
            row.update(specific_enthalpy=t["h_mass"], enthalpy_unit=t.get("h_unit", ""))
        project["streams"].append(row)

    for b in graph["blocks"]:
        role = broles.get(b["id"], {})
        heat = [e for e in b["energy"] if e["kind"] == "heat"]
        work = [e for e in b["energy"] if e["kind"] == "work"]
        out = {"case_id": case_id, "id": b["id"], "source": src + f"; block type {b['type']}"}
        if role.get("role") == "internal_recovery":
            unit = (heat or work or [{"unit": "kW"}])[0]["unit"]
            out.update(heat=0, heat_unit=unit, power=0, power_unit=unit)
            out["source"] += "; 内部换热：交换热量只在 internal_loops 中，外部 Q=W=0"
            project["blocks"].append(out)
            continue
        if heat:
            out.update(heat=sum(e["value"] for e in heat), heat_unit=heat[0]["unit"])
        elif role.get("role") in ADIABATIC_ROLES or work:
            out.update(heat=0, heat_unit=(work[0]["unit"] if work else "kW"))
            out["source"] += "; heat=0 按块类型（绝热）或仅有轴功"
        else:
            out.update(heat="", heat_unit="")
        if work:
            out.update(power=sum(e["value"] for e in work), power_unit=work[0]["unit"])
        elif heat or role.get("role") in ADIABATIC_ROLES:
            out.update(power=0, power_unit=out.get("heat_unit") or "kW")
        else:
            out.update(power="", power_unit="")
        project["blocks"].append(out)

        # Utility inventory rows.
        if role.get("role") == "internal_recovery":
            continue
        eff = role.get("efficiency", 1.0)
        for i, e in enumerate(b["energy"]):
            if e["value"] == 0:
                continue
            if e["kind"] == "work":
                if e["value"] > 0:
                    add_row(f"elec_{b['id']}" + (f"_{i}" if len(work) > 1 else ""), f"{b['id']} 电力", "energy",
                            e["value"] / eff, e["unit"], [{"utility": "electricity"}],
                            f"{e.get('path', 'work')} / 电机效率 {eff}")
                elif role.get("credit"):
                    notes.append(f"{b['id']} 对外做功 {e['value']} {e['unit']}：抵扣尚未支持，未计入")
                continue
            utility = (role.get("duty_utilities") or {}).get(e.get("role_hint")) or role.get("utility") or "unassigned"
            if utility in ("none",):
                continue
            hot = e["value"] > 0
            kind = "energy" if hot else "material"  # cooling = service, kept out of purchased-energy intensity
            amount = (e["value"] / eff) if hot else -e["value"]
            add_row(f"{utility}_{b['id']}" + (f"_{e['role_hint']}" if e.get("role_hint") else ""),
                    f"{b['id']} {e.get('role_hint') or ''} {utility}".replace("  ", " "), kind, amount, e["unit"],
                    [{"utility": utility}], f"{e.get('path', 'duty')}" + (f" / 效率 {eff}" if hot else "；冷却服务按移出热量计"))

    # Feeds, emissions, wastes.
    product_mass, feed_mass, mass_units = 0.0, 0.0, set()
    for sid, r in sroles.items():
        s = streams.get(sid)
        if not s or s["class"] != "MATERIAL":
            continue
        t = s.get("total") or {}
        mass, unit = t.get("mass_flow"), t.get("mass_unit", "")
        comp = _composition(s)
        if r["role"] == "feed":
            feed_mass += mass or 0; mass_units.add(unit)
            key = (r.get("inventory") or {}).get("factor_key")
            queries = []
            if key and _factor_query_for_key(key):
                queries.append({**_factor_query_for_key(key), "flow": "material_input"})
            if comp and max(comp.values()) >= 0.99 * sum(comp.values()):
                main = max(comp, key=comp.get)
                info = comps.get(main, {})
                if info.get("cas"):
                    queries.append({"cas": info["cas"], "flow": "material_input"})
                queries.append({"component": main, "flow": "material_input"})
            add_row(f"feed_{sid}", f"进料 {sid}", "material", mass, unit, queries or [{"flow": "material_input", "component": sid}],
                    "boundary feed mass")
        elif r["role"] == "emission":
            if not comp:
                add_row(f"emis_{sid}", f"排放 {sid}", "emission", mass, unit, [], "no component breakdown")
            for cid, m in comp.items():
                info = comps.get(cid, {})
                if cid.upper() in INERT_EMISSIONS or info.get("cas") in INERT_CAS or m <= 0:
                    continue
                origin = r.get("carbon_origin") or info.get("carbon_origin")
                q = {"flow": "emission_air", **({"carbon_origin": origin} if origin in ("fossil", "biogenic") else {})}
                queries = ([{**q, "cas": info["cas"]}] if info.get("cas") else []) + [{**q, "component": cid}]
                sub_unit = next((sub.get("mass_unit") for sub in (s.get("substreams") or {}).values() if sub.get("mass_unit")), unit)
                add_row(f"emis_{sid}_{cid}", f"{sid} 直接排放 {cid}", "emission", m, sub_unit, queries, f"component mass flow {cid}")
        elif r["role"] == "waste":
            add_row(f"waste_{sid}", f"废物 {sid}", "waste", mass, unit,
                    [{"flow": "waste", "treatment": r.get("treatment", "unassigned")}], "boundary waste mass")
        elif r["role"] == "product":
            mass_units.add(unit)
            if fu.get("components"):
                product_mass += sum(comp.get(c, 0.0) for c in fu["components"])
            else:
                product_mass += mass or 0

    case = {"id": case_id, "product_rate": product_mass if product_mass > 0 else "", "feed_rate": feed_mass if feed_mass > 0 else "",
            "mass_unit": next(iter(mass_units)) if len(mass_units) == 1 else "",
            "allocation": _allocation_share(roles, sroles, streams), "source": src + "; product/feed from roles"}
    if len(mass_units) > 1:
        notes.append(f"产品与进料的质量单位不一致 {sorted(mass_units)}；请统一导出单位")
    project["cases"].append(case)
    project["inventory"] = rows
    for (fid, category), e in used.items():
        project["factors"].append({"id": fid, "category": category, "value": e["value"],
                                   "low": e["low"] if e["low"] is not None else "", "high": e["high"] if e["high"] is not None else "",
                                   "denominator_unit": e["denominator_unit"], "impact_unit": e["impact_unit"],
                                   "method": e["method"], "source": f"{e['source']} ({e['year']})"})
    validate(project, "case")
    return project, notes, used


def _allocation_share(roles, sroles, streams):
    alloc = roles.get("allocation") or {"method": "none"}
    product = [sid for sid, r in sroles.items() if r["role"] == "product"]
    if alloc["method"] == "none" or not product:
        return 1
    shares = alloc.get("shares") or {}
    if product[0] in shares:
        return shares[product[0]]
    if alloc["method"] == "mass":
        outs = [sid for sid, r in sroles.items() if r["role"] in ("product", "coproduct")]
        total = sum((streams[s].get("total") or {}).get("mass_flow") or 0 for s in outs)
        mine = sum((streams[s].get("total") or {}).get("mass_flow") or 0 for s in product)
        return mine / total if total > 0 else 1
    return ""  # energy/economic need explicit shares: core will report it


def run_core(project):
    if shutil.which("node") is None:
        raise RuntimeError("需要 Node.js 才能调用 universal-core（node 不在 PATH 中）")
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp, "project.json"), Path(tmp, "assessment.json")
        src.write_text(json.dumps(project, ensure_ascii=False), encoding="utf-8")
        proc = subprocess.run(["node", str(BRIDGE), str(src), str(dst)], capture_output=True, text=True, timeout=120)
        if not dst.exists():
            raise RuntimeError("universal-core bridge failed: " + proc.stderr[-2000:])
        out = json.loads(dst.read_text(encoding="utf-8"))
    if out.get("error"):
        raise RuntimeError("universal-core rejected the project: " + out["error"])
    return out


def _completeness(project, core_case, used):
    out = {}
    inventory = project["inventory"]
    for imp in core_case["impacts"]:
        cat = imp["category"]
        mass_rows = [r for r in inventory if r["kind"] in ("material", "emission", "waste") and isinstance(r["amount"], (int, float))
                     and str(r.get("unit", "")).lower().startswith(("kg", "g", "t/", "lb"))]
        ok = lambda r: (r["factor_id"], cat) in used
        total_mass = sum(r["amount"] for r in mass_rows)
        known = sum(c["nominal"] for c in imp["contributions"])
        missing = [r["id"] for r in inventory if not ok(r)]
        out[cat] = {"status": "complete" if imp["complete"] and not missing else "incomplete",
                    "complete": bool(imp["complete"]) and not missing,
                    "mass_coverage": (sum(r["amount"] for r in mass_rows if ok(r)) / total_mass) if total_mass > 0 else None,
                    "contribution_coverage": (imp["covered"] / imp["total"]) if imp["total"] else None,
                    "missing": missing,
                    "lower_bound": known if imp["contributions"] else None,
                    "total": imp["nominal_subtotal"] if imp["complete"] else None,
                    "unit": f"{imp.get('unit') or ''}/kg product"}
    # Categories with no usable factor at all never reach the core.
    return out


def _energy_edges(graph, roles, core_blocks):
    by_id = {b["id"]: b for b in core_blocks}
    edges, loops = [], []
    for b in graph["blocks"]:
        role = roles["blocks"].get(b["id"], {})
        conv = by_id.get(b["id"])
        if conv is None:
            continue
        if role.get("role") == "internal_recovery":
            for e in (e for e in b["energy"] if e["kind"] == "heat" and e["value"] != 0):
                loops.append({"source": f"hot:{b['id']}", "target": f"cold:{b['id']}", "value": abs(e["value"]), "unit": e["unit"],
                              "kind": "heat_exchange", "annotation": f"{b['id']} 内部换热（{b['type']}），不计外购公用工程，不进主桑基图；单位为原生单位"})
            continue
        heat = [e for e in b["energy"] if e["kind"] == "heat"]
        native_total = sum(e["value"] for e in heat)
        for e in heat:
            share = (e["value"] / native_total) if native_total else 0
            kw = conv["heat"] * share if native_total else 0
            utility = (role.get("duty_utilities") or {}).get(e.get("role_hint")) or role.get("utility") or "unassigned"
            utility = "excluded" if utility == "none" else utility
            if kw > 0:
                edges.append({"source": f"utility:{utility}", "target": f"block:{b['id']}", "value": kw, "unit": "kW", "kind": "utility"})
            elif kw < 0:
                edges.append({"source": f"block:{b['id']}", "target": f"sink:{utility}", "value": -kw, "unit": "kW", "kind": "loss"})
        if conv["power"] > 0:
            edges.append({"source": "utility:electricity", "target": f"block:{b['id']}", "value": conv["power"], "unit": "kW", "kind": "utility"})
        elif conv["power"] < 0:
            edges.append({"source": f"block:{b['id']}", "target": "export:electricity", "value": -conv["power"], "unit": "kW", "kind": "process"})
    for sid, r in roles["streams"].items():
        if r["role"] == "recycle":
            s = next(s for s in graph["streams"] if s["id"] == sid)
            t = s.get("total") or {}
            if t.get("mass_flow") is not None:
                loops.append({"source": f"block:{s['from']}", "target": f"block:{s['to']}", "value": t["mass_flow"],
                              "unit": t.get("mass_unit", ""), "kind": "recycle", "annotation": f"循环物流 {sid}，边界上抵消"})
    return edges, loops


def assess_case(graph, roles, case_id="case-1", case_params=None, entries=None, categories=("GWP100",), calorie_J=None, scenario="base"):
    """Return (project, case_result, contributions, factor_sources, kpi)."""
    gates = [V.g0_identity(graph), V.g1_converged(graph), V.g1_warnings(graph), V.g2_completeness(graph, roles)]
    if V.case_status(gates) == "rejected":
        result = {"case": case_id, "scenario": scenario, "status": "rejected", "case_params": case_params or {}, "gates": gates + [
            V.gate(g, "not_run", ["前置关卡未通过"]) for g in ("G3_balance", "G4_roles", "G5_factors")],
            "balance": [], "completeness": {}, "energy_edges": [], "internal_loops": [], "warnings": []}
        return None, result, [], [], {"energy_per_fu": None, "gwp_per_fu": None, "efficiency": None, "max_balance_ratio": None}
    project, notes, used = build_project(graph, roles, case_id, entries, categories, calorie_J)
    core = run_core(project)
    rc = core["report"]["results"][0]
    rows = V.block_balance(rc["balance"])
    completeness = _completeness(project, rc, used)
    for cat in categories:
        completeness.setdefault(cat, {"status": "incomplete", "complete": False, "mass_coverage": 0.0, "contribution_coverage": 0.0,
                                      "missing": [r["id"] for r in project["inventory"]], "lower_bound": None, "total": None, "unit": ""})
    gates += [V.g3_balance(rc["balance"], rows), V.g4_roles(roles), V.g5_factors(completeness)]
    edges, loops = _energy_edges(graph, roles, rc["balance"].get("blocks") or [])
    factor_rows = {f["id"]: f for f in project["factors"]}
    contributions = []
    for imp in rc["impacts"]:
        for c in imp["contributions"]:
            e = used.get((c["factor_id"], imp["category"]))
            row = {"case": case_id, "scenario": scenario, "category": imp["category"], "item": c["name"], "value": c["nominal"],
                   "unit": f"{imp.get('unit') or factor_rows.get(c['factor_id'], {}).get('impact_unit', '')}/kg product",
                   "factor_id": c["factor_id"], "proxy": bool(e and e["status"] == "proxy")}
            if e and e["low"] is not None and e["high"] is not None and e["value"]:
                row["value_low"] = c["nominal"] * e["low"] / e["value"]
                row["value_high"] = c["nominal"] * e["high"] / e["value"]
            contributions.append(row)
    hot = sum(x["value"] for x in edges if x["kind"] == "utility" and x["source"] != "utility:electricity")
    cold = sum(x["value"] for x in edges if x["kind"] == "loss")
    elec = sum(x["value"] for x in edges if x["source"] == "utility:electricity")
    by_utility = {}
    for x in edges:
        key = x["source"] if x["kind"] == "utility" else x["target"]
        by_utility[key.split(":", 1)[1]] = by_utility.get(key.split(":", 1)[1], 0) + x["value"]
    energy_intensity = rc["energy"][-1]["range"][0] if rc.get("energy") else None
    result = {"case": case_id, "scenario": scenario, "case_params": case_params or {}, "gates": gates, "balance": rows,
              "completeness": completeness, "energy_edges": edges, "internal_loops": loops,
              "energy": {"hot_utility_kW": hot, "cold_utility_kW": cold, "electricity_kW": elec, "by_utility": by_utility,
                         "intensity": energy_intensity, "intensity_unit": "kWh/kg product（外购热 + 电，不含冷却服务）"},
              "warnings": notes + rc.get("issues", [])}
    result["status"] = V.case_status(gates)
    gwp = completeness.get("GWP100", {})
    kpi = {"energy_per_fu": energy_intensity, "energy_unit": "kWh/kg",
           "gwp_per_fu": gwp.get("total") if gwp.get("complete") else None, "gwp_unit": "kg CO2-eq/kg",
           "efficiency": rc["yield"][1] if rc.get("yield") else None,
           "max_balance_ratio": max((r["ratio"] for r in rows), default=None)}
    sources = [{"factor_id": e["id"], "source": e["source"], "year": e["year"], "status": e["status"]} for e in used.values()]
    return project, result, contributions, sources, kpi


def method_block(roles, sources):
    fu = roles.get("functional_unit") or {}
    uniq = {s["factor_id"]: s for s in sources}
    return {"functional_unit": f"{fu.get('amount', '?')} {fu.get('unit', '?')} {fu.get('basis', '')} ({fu.get('stream', '')})",
            "system_boundary": roles.get("system_boundary", ""),
            "allocation": (roles.get("allocation") or {}).get("method", "none"),
            "lcia_method": roles.get("lcia_method", "IPCC 2021 GWP100"),
            "enthalpy_basis": "Aspen 原生焓基准",
            "factor_sources": list(uniq.values())}


def write_study(out_dir, study_id, graph, roles, cases, entries=None, categories=("GWP100",), calorie_J=None,
                variables=None, scenarios=None, default_scenario="base"):
    """Write an aspen-study/2 bundle.

    cases: (case_id, graph_for_case, case_params[, scenario]); the case identity
    is (case_id, scenario). scenarios: [{"id", "label"}], defaults to one
    "base" scenario.
    """
    out = Path(out_dir)
    for sub in ("cases", "results"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    scenarios = scenarios or [{"id": default_scenario}]
    manifest_cases, all_results, all_contrib, sources, used_factors = [], [], [], [], {}
    for entry in cases:
        case_id, case_graph, params = entry[:3]
        scenario = entry[3] if len(entry) > 3 else default_scenario
        stem = case_id if scenario == default_scenario else f"{case_id}__{scenario}"
        project, result, contrib, src, kpi = assess_case(case_graph, roles, case_id, params, entries, categories, calorie_J, scenario)
        sources += src
        for f in (project or {}).get("factors", []):
            used_factors[(f["id"], f["category"])] = f
        method = dict(method_block(roles, src), factors_snapshot="factors.json")
        shard = {"schema": "aspen-results/1", "study_id": study_id, "core": "analysis_web/universal-core.mjs",
                 "sign_convention": SIGN, "method": method, "cases": [result], "contributions": contrib}
        validate(shard, "results")
        (out / "results" / f"{stem}.json").write_text(json.dumps(shard, ensure_ascii=False, indent=1), encoding="utf-8")
        row = {"id": case_id, "scenario": scenario, "has_results": True, "source": "aspen",
               "result": f"results/{stem}.json", "status": result["status"], "case_params": params or {}, "kpi": kpi,
               "completeness": {cat: {"status": c["status"], "complete": c["complete"], "mass_coverage": c["mass_coverage"],
                                      "contribution_coverage": c["contribution_coverage"],
                                      "missing_count": len(c["missing"]), "lower_bound": c["lower_bound"]}
                                for cat, c in result["completeness"].items()}}
        if project is not None:
            case_file = out / "cases" / f"{stem}.json"
            case_file.write_text(json.dumps(project, ensure_ascii=False, indent=1), encoding="utf-8")
            row.update(file=f"cases/{stem}.json", bytes=case_file.stat().st_size)
        manifest_cases.append(row)
        all_results.append(result)
        all_contrib += contrib
    summary = {"schema": "aspen-results/1", "study_id": study_id, "core": "analysis_web/universal-core.mjs", "sign_convention": SIGN,
               "method": dict(method_block(roles, sources), factors_snapshot="factors.json"), "cases": all_results, "contributions": all_contrib}
    validate(summary, "results")
    (out / "results" / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    by_id = {s["factor_id"]: s for s in sources}
    snapshot = {"schema": "aspen-factors-snapshot/1", "study_id": study_id, "library_version": "fl-2026.11-draft",
                "factors": [{"id": f["id"], "category": f["category"], "value": f["value"],
                             "low": f["low"] if f["low"] != "" else None, "high": f["high"] if f["high"] != "" else None,
                             "unit": f["denominator_unit"], "impact_unit": f["impact_unit"], "method": f["method"],
                             "source": by_id.get(f["id"], {}).get("source", f["source"]),
                             "year": by_id.get(f["id"], {}).get("year"),
                             **({"status": by_id[f["id"]]["status"]} if f["id"] in by_id and by_id[f["id"]]["status"] != "placeholder" else {})}
                            for f in used_factors.values()]}
    validate(snapshot, "factors-snapshot")
    (out / "factors.json").write_text(json.dumps(snapshot, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "graph.json").write_text(json.dumps(graph, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "roles.json").write_text(json.dumps(roles, ensure_ascii=False, indent=1), encoding="utf-8")
    order = ["pass", "not_run", "warn", "fail"]
    worst = {}
    for r in all_results:
        for g in r["gates"]:
            if order.index(g["status"]) >= order.index(worst.get(g["id"], "pass")):
                worst[g["id"]] = g["status"]
    model = graph["model"]
    manifest = {"schema": "aspen-study/2", "study_id": study_id,
                "model": {"sha256": model["sha256"], "simulator": model["simulator"], "version": model.get("version"), "file": model["file"]},
                "contract": {"project_schema": 1, "graph_schema": "aspen-model-graph/1", "roles_schema": "aspen-roles/1",
                             "results_schema": "aspen-results/1", "factor_library": "fl-2026.11-draft"},
                "functional_unit": method_block(roles, [])["functional_unit"], "variables": variables or [],
                "scenarios": scenarios, "default_scenario": default_scenario,
                "gates": worst, "cases": manifest_cases,
                "shards": {"graph": "graph.json", "roles": "roles.json", "factors": "factors.json", "summary": "results/summary.json"}}
    validate(manifest, "manifest")
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    return manifest
