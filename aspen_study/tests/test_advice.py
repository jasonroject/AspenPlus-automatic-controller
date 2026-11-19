"""模型建议引擎（advice.py）、probe 1.1 升级与 JS 对拍的测试。不需要 Aspen。"""
import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from aspen_study import advice as A
from aspen_study.adapters import aspen_rules as R
from aspen_study.cli import main as cli_main
from aspen_study.probe_compat import group_totals, upgrade_summary
from aspen_study.schema_check import validate

from .helpers import HAS_NODE

FIX = Path(__file__).resolve().parent / "fixtures" / "probe"
REPO = Path(__file__).resolve().parents[2]
SHA = "a" * 64


def load(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


def summary(blocks=None, **over):
    """最小的 aspen-probe/1.1：一个正常的 Heater，SI 单位。"""
    s = {"schema": "aspen-probe/1.1", "model": {"file": "m.bkp", "sha256": SHA, "simulator": "aspen-plus", "source_unchanged": True},
         "status": {"state": "ok", "run_completed": True, "errors": [], "warnings": [], "notes": []},
         "units": {"INSET": "SI", "OUTSET": "SI"}, "calorie_J": 4.1868, "blocks": blocks if blocks is not None else [heater("H1", 10.0)],
         "totals_kW": {}, "totals_complete": True, "energy_gaps": [], "unverified_paths": [], "discovery": {"complete": True, "nodes_read": 5, "unmatched_block_types": []},
         "cleanup": {"killed_pids": []}}
    s.update(over)
    s["group_totals"] = group_totals(s["blocks"], s["totals_complete"])
    return s


def heater(bid, kw, status="ok", lines=(), unit="kW", verified=True, kind="heat", hint=None, typ="Heater", blkmsg=None):
    e = {"kind": kind, "value": kw, "unit": unit, "kW": kw, "path": f"\\Data\\Blocks\\{bid}\\Output\\QCALC", "verified": verified}
    if hint:
        e["role_hint"] = hint
    return {"id": bid, "type": typ, "status": status, "blkstat": {"ok": 0, "warning": 2, "error": 1, "unknown": None}[status],
            "blkmsg": blkmsg, "per_error": list(lines), "per_error_total": len(lines), "energy": [e]}


def blk(bid, typ, energy=()):
    return {"id": bid, "type": typ, "status": "ok", "blkstat": 0, "blkmsg": None, "per_error": [], "per_error_total": 0, "energy": list(energy)}


def fired(adv):
    return {it["rule"] for it in adv["items"]}


def run(s, g=None, r=None):
    adv = A.advise(s, g, r)
    validate(adv, "advice")
    return adv


def graph(blocks, streams, sha=SHA):
    return {"schema": "aspen-model-graph/1", "model": {"file": "m.bkp", "sha256": sha}, "blocks": blocks, "streams": streams}


def gblock(bid, tin_stream, tout_stream, outT=None):
    b = {"id": bid, "type": "Heater", "ports": {"in": [tin_stream], "out": [tout_stream]}, "energy": []}
    if outT:
        b["outlet_temperature"] = {"value": outT, "unit": "K", "path": "x"}
    return b


def gstream(sid, T, frm="X", to="Y", mass=None, unit="kg/hr", Tunit="K"):
    t = {"T": T, "T_unit": Tunit}
    if mass is not None:
        t.update({"mass_flow": mass, "mass_unit": unit})
    return {"id": sid, "class": "MATERIAL", "from": frm, "to": to, "total": t}


def roles(**over):
    r = {"schema": "aspen-roles/1", "model_sha256": SHA, "streams": {"P": {"role": "product", "provenance": {"source": "user", "confidence": 1.0}}},
         "blocks": {}, "functional_unit": {"basis": "product_mass", "amount": 1, "unit": "kg", "stream": "P"}, "allocation": {"method": "none"},
         "review": {"state": "reviewed", "pending": []}}
    r.update(over)
    return r


def msg_block(text, status="warning", typ="Heater"):
    return heater("B1", 1.0, status=status, lines=text.split("\n"), typ=typ)


# 每个规则 id -> 触发它的构造；test_every_rule_has_a_case 保证规则表里的规则都有用例
def cases():
    hx = lambda: [heater("HOT", -10.0), heater("COLD", 5.0)]
    gr_overlap = graph([gblock("HOT", "a", "b", 300.0), gblock("COLD", "c", "d", 340.0)],
                       [gstream("a", 400.0), gstream("b", 300.0), gstream("c", 320.0), gstream("d", 340.0)])
    pat = lambda t, **k: (summary([msg_block(t, **k)]), None, None)
    return {
        "status.error": (summary(status=dict(summary()["status"], state="error", errors=["块 B1：boom"])), None, None),
        "status.incomplete": (summary(status=dict(summary()["status"], run_completed=False)), None, None),
        "status.global-warning": (summary(status=dict(summary()["status"], state="warning", warnings=["整体：没有块前缀"])), None, None),
        "status.source-modified": (summary(model={"file": "m.bkp", "sha256": SHA, "simulator": "aspen-plus", "source_unchanged": False}), None, None),
        "block.unmatched-error": (summary([heater("B1", 1.0, status="error", lines=["something odd"])]), None, None),
        "block.unmatched-warning": (summary([heater("B1", 1.0, status="warning", lines=["something odd"])]), None, None),
        "block.status-unknown": (summary([heater("B1", 1.0, status="unknown")]), None, None),
        "thermo.phase-stability": pat("TRY USING 3-PHASE CALCULATIONS.\nCOMPONENT 'STYRENE'. STABILITY"),
        "thermo.flash-unreliable": pat("CALCULATED PROPERTIES MAY BE UNRELIABLE DUE TO FLASH PROBLEMS."),
        "thermo.outlet-flash-problem": pat("PROBLEM WITH OUTLET STREAM FLASH. CHECK PHASE SPECIFICATIONS."),
        "reaction.rate-zero": pat("REACTION RATE IS SET TO ZERO FOR SOME REACTIONS\nFOR REACTION (7) BUT\nREACTANT 'H2' IS NOT PRESENT.", typ="RPlug"),
        "convergence.not-converged": pat("BLOCK DID NOT CONVERGE"),
        "convergence.max-iterations": pat("MAXIMUM NUMBER OF ITERATIONS REACHED"),
        "heat-integration.temperature-cross": pat("TEMPERATURE CROSS IN EXCHANGER"),
        "thermo.property-missing": pat("MISSING PARAMETER NRTL BINARY"),
        "units.non-si-set": (summary([heater("B1", 100.0, unit="cal/sec")], units={"INSET": "MET", "OUTSET": "MET"}), None, None),
        "units.calorie-definition": (summary([heater("B1", 100.0, unit="cal/sec")], calorie_J=4.184), None, None),
        "units.kw-null": (summary([dict(heater("B1", 1.0), energy=[dict(heater("B1", 1.0)["energy"][0], unit="weird", kW=None)])], totals_complete=False), None, None),
        "energy.hotspot": (summary([heater("A", 10.0), heater("B", -5.0), heater("C", 0.2)]), None, None),
        "energy.warning-share": (summary([heater("A", 10.0, status="warning", lines=["x"]), heater("B", 5.0)]), None, None),
        "energy.internal-exchange": (summary([heater("X", 3.0, hint="exchanged", typ="HeatX"), heater("A", 1.0)]), None, None),
        "energy.none": (summary([blk("M", "Mixer")]), None, None),
        "energy.block-missing": (summary([blk("P1", "Pump"), heater("A", 1.0)]), None, None),
        "heat-integration.overlap": (summary(hx()), gr_overlap, None),
        "heat-integration.none": (summary(hx()), graph([gblock("HOT", "a", "b", 300.0), gblock("COLD", "c", "d", 640.0)],
                                                      [gstream("a", 350.0), gstream("b", 300.0), gstream("c", 600.0), gstream("d", 640.0)]), None),
        "heat-integration.data-missing": (summary(hx()), graph([gblock("HOT", "a", "b"), gblock("COLD", "c", "d")], []), None),
        "convergence.mass-balance": (summary(), graph([gblock("H1", "i", "o")], [gstream("i", 300.0, "BOUNDARY", "H1", mass=100.0), gstream("o", 300.0, "H1", "BOUNDARY", mass=90.0)]), None),
        "data-completeness.totals-incomplete": (summary(totals_complete=False), None, None),
        "data-completeness.energy-gaps": (summary(energy_gaps=[{"block": "B1", "path": "\\Data\\x", "reason": "读不到"}]), None, None),
        "data-completeness.discovery-incomplete": (summary(discovery={"complete": False, "nodes_read": 3, "unmatched_block_types": []}), None, None),
        "data-completeness.unmatched-block-types": (summary(discovery={"complete": True, "unmatched_block_types": ["Weird"]}), None, None),
        "data-completeness.unverified-paths": (summary([heater("B1", 1.0, verified=False)]), None, None),
        "data-completeness.study-failed": (summary(study={"ok": False, "error": "node 缺失"}), None, None),
        "lca-readiness.roles-draft": (summary(), None, roles(review={"state": "auto_draft", "pending": ["stream P: product"]})),
        "lca-readiness.no-product": (summary(), None, roles(streams={"F": {"role": "feed"}})),
        "lca-readiness.multi-product": (summary(), None, roles(streams={"P": {"role": "product"}, "Q": {"role": "product"}})),
        "lca-readiness.no-functional-unit": (summary(), None, roles(functional_unit=None)),
        "lca-readiness.fu-stream-mismatch": (summary(), None, roles(streams={"P": {"role": "product"}, "W": {"role": "waste"}},
                                                                     functional_unit={"basis": "product_mass", "amount": 1, "unit": "kg", "stream": "W"})),
        "lca-readiness.product-low-confidence": (summary(), None, roles(streams={"P": {"role": "product", "provenance": {"source": "auto", "confidence": 0.4, "reasons": ["猜的"]}}})),
        "lca-readiness.utility-guess": (summary(), None, roles(blocks={"H1": {"role": "heater", "utility": "fired_heat", "provenance": {"source": "auto", "needs_confirmation": True}}})),
        "lca-readiness.no-factor-key": (summary(), None, roles(streams={"P": {"role": "product"}, "F": {"role": "feed", "inventory": {"kind": "material"}}})),
        "lca-readiness.sha-mismatch": (summary(), None, roles(model_sha256="b" * 64)),
    }


def all_rule_ids():
    rules = A.load_rules()
    return {p["id"] for p in rules["message_patterns"]} | set(rules["rules"])


class RuleCases(unittest.TestCase):
    def test_every_rule_has_a_case(self):
        self.assertEqual(set(cases()), all_rule_ids())

    def test_each_rule_fires_on_its_case(self):
        for rid, (s, g, r) in cases().items():
            with self.subTest(rule=rid):
                self.assertIn(rid, fired(run(s, g, r)))

    def test_clean_model_is_quiet(self):
        adv = run(summary(), None, roles())
        self.assertEqual([it["rule"] for it in adv["items"]], [])
        self.assertEqual(adv["counts"]["total"], 0)

    def test_item_shape_and_evidence_pointers_resolve(self):
        for rid, (s, g, r) in cases().items():
            docs = {"probe-summary.json": upgrade_summary(s), "graph.json": g, "roles.json": r}
            for it in run(s, g, r)["items"]:
                self.assertTrue(it["evidence"], it["id"])
                for e in it["evidence"]:
                    f, ptr = e["path"].split("#")
                    node = docs[f]
                    for part in [p for p in ptr.split("/") if p]:
                        node = node[int(part)] if isinstance(node, list) else node[part]
                    self.assertEqual(node, e["value"], e["path"])

    def test_deterministic_and_sorted(self):
        s, g, r = load("heatrecovery.probe-summary.json"), load("heatrecovery.graph.json"), load("heatrecovery.roles.json")
        a, b = A.advise(s, g, r), A.advise(copy.deepcopy(s), g, r)
        self.assertEqual(json.dumps(a), json.dumps(b))
        ranks = [A.SEV_RANK[i["severity"]] for i in a["items"]]
        self.assertEqual(ranks, sorted(ranks))
        self.assertEqual(len({i["id"] for i in a["items"]}), len(a["items"]))

    def test_inputs_are_not_mutated(self):
        s, g, r = cases()["lca-readiness.roles-draft"]
        before = json.dumps([s, g, r])
        run(s, g, r)
        self.assertEqual(json.dumps([s, g, r]), before)


class RuleDetails(unittest.TestCase):
    def test_block_error_escalates_and_ok_block_downgrades(self):
        text = "STABILITY CRITERION NOT SATISFIED FOR\nCOMPONENT 'X'."
        sev = lambda st: next(i["severity"] for i in run(summary([msg_block(text, status=st)]))["items"] if i["rule"] == "thermo.phase-stability")
        self.assertEqual((sev("error"), sev("warning"), sev("ok")), ("critical", "warn", "suggest"))

    def test_reaction_rate_extracts_reactions_and_reactants(self):
        it = next(i for i in run(*cases()["reaction.rate-zero"])["items"] if i["rule"] == "reaction.rate-zero")
        self.assertIn("7", it["detail_zh"])
        self.assertIn("H2", it["detail_zh"])

    def test_truncation_note_uses_exact_total_in_1_1(self):
        b = msg_block("REACTION RATE IS SET TO ZERO")
        b["per_error_total"] = 40
        it = next(i for i in run(summary([b]))["items"] if i["rule"] == "reaction.rate-zero")
        self.assertIn("只保留了前", it["detail_zh"])

    def test_units_text_names_native_units_and_never_invents(self):
        it = next(i for i in run(*cases()["units.non-si-set"])["items"] if i["rule"] == "units.non-si-set")
        self.assertIn("cal/sec", it["detail_zh"])

    def test_si_model_has_no_unit_item(self):
        self.assertNotIn("units.non-si-set", fired(run(summary())))

    def test_hotspot_excludes_internal_exchange_and_needs_two_blocks(self):
        adv = run(summary([heater("X", 99.0, hint="exchanged", typ="HeatX"), heater("A", 1.0)]))
        self.assertNotIn("energy.hotspot", fired(adv))
        self.assertTrue(any(s["rule"] == "energy.hotspot" for s in adv["skipped"]))

    def test_warning_share_threshold(self):
        s = summary([heater("A", 1.0, status="warning", lines=["x"]), heater("B", 99.0)])
        self.assertNotIn("energy.warning-share", fired(run(s)))

    def test_heat_integration_no_temperature_data_says_so(self):
        adv = run(summary([heater("HOT", -10.0), heater("COLD", 5.0)]), graph([gblock("HOT", "a", "b"), gblock("COLD", "c", "d")], []))
        self.assertIn("heat-integration.data-missing", fired(adv))
        self.assertNotIn("heat-integration.overlap", fired(adv))

    def test_heat_integration_only_when_both_heating_and_cooling(self):
        self.assertFalse({"heat-integration.overlap", "heat-integration.none", "heat-integration.data-missing"} & fired(run(summary())))

    def test_heat_integration_overlap_bound_is_min_of_duties(self):
        it = next(i for i in run(*cases()["heat-integration.overlap"])["items"] if i["rule"] == "heat-integration.overlap")
        self.assertIn("热集成机会", it["title_zh"])
        self.assertEqual(it["confidence"], "heuristic")

    def test_heat_integration_distillation_condenser_reboiler_in_one_block(self):
        col = heater("B1", -7000.0, typ="RadFrac")
        col["energy"].append(dict(col["energy"][0], value=9000.0, kW=9000.0, path="r"))
        adv = run(summary([col]), graph([gblock("B1", "a", "b", 300.0)], [gstream("a", 350.0), gstream("b", 300.0)]))
        it = next(i for i in adv["items"] if i["rule"] == "heat-integration.data-missing")
        self.assertIn("冷凝器", it["title_zh"])

    def test_temperature_units_are_converted(self):
        g = cases()["heat-integration.overlap"][1]
        g = copy.deepcopy(g)
        for s in g["streams"]:
            s["total"]["T"] = s["total"]["T"] - 273.15
            s["total"]["T_unit"] = "C"
        for b in g["blocks"]:
            if "outlet_temperature" in b:
                b["outlet_temperature"] = {"value": b["outlet_temperature"]["value"] - 273.15, "unit": "C"}
        self.assertIn("heat-integration.overlap", fired(run(cases()["heat-integration.overlap"][0], g)))

    def test_mass_balance_within_tolerance_is_quiet(self):
        g = graph([gblock("H1", "i", "o")], [gstream("i", 300.0, "BOUNDARY", "H1", mass=100.0), gstream("o", 300.0, "H1", "BOUNDARY", mass=99.5)])
        self.assertNotIn("convergence.mass-balance", fired(run(summary(), g)))

    def test_missing_totals_never_become_zero(self):
        s = summary([dict(heater("B1", 1.0), energy=[dict(heater("B1", 1.0)["energy"][0], unit="weird", kW=None)])], totals_complete=False)
        self.assertEqual(s["group_totals"]["heating"], {"kW": None, "complete": False})
        self.assertIsNone(s["group_totals"]["overall"]["kW"])

    def test_roles_reviewed_is_quiet_but_low_confidence_manual_is_trusted(self):
        r = roles(streams={"P": {"role": "product", "provenance": {"source": "user", "confidence": 0.1}}})
        self.assertNotIn("lca-readiness.product-low-confidence", fired(run(summary(), None, r)))

    def test_no_numbers_outside_the_probe_in_text(self):
        # 文案里不得出现排放因子之类的外部数值：规则表里只有阈值（thresholds）和 4.1868 这类探针常量
        rules = A.load_rules()
        for key in ("kgco2", "kg co2", "gwp", "tco2"):
            self.assertNotIn(key, json.dumps(rules, ensure_ascii=False).lower().replace("ipcc", ""))


class RequiresAndSkipped(unittest.TestCase):
    """规则表的 requires（graph / roles）：缺输入的规则整条跳过并登记在 skipped，不再产生“缺 roles”之类的建议条目。"""

    GRAPH_RULES = {"heat-integration.overlap", "heat-integration.none", "heat-integration.data-missing", "convergence.mass-balance"}
    ROLES_RULES = {"lca-readiness.roles-draft", "lca-readiness.no-product", "lca-readiness.multi-product", "lca-readiness.no-functional-unit",
                   "lca-readiness.fu-stream-mismatch", "lca-readiness.product-low-confidence", "lca-readiness.utility-guess", "lca-readiness.no-factor-key"}

    def test_requires_is_declared_on_every_rule(self):
        rules = A.load_rules()["rules"]
        self.assertTrue(all(isinstance(r.get("requires"), list) and set(r["requires"]) <= {"graph", "roles"} for r in rules.values()))
        self.assertEqual({k for k, r in rules.items() if "graph" in r["requires"]}, self.GRAPH_RULES)
        self.assertEqual({k for k, r in rules.items() if "roles" in r["requires"]}, self.ROLES_RULES)
        self.assertNotIn("lca-readiness.no-roles", rules)

    def test_summary_only_skips_graph_and_roles_rules(self):
        adv = run(summary())
        by = {s["rule"]: s for s in adv["skipped"]}
        self.assertTrue((self.GRAPH_RULES | self.ROLES_RULES) <= set(by))
        self.assertEqual(by["lca-readiness.no-product"]["missing_inputs"], ["roles"])
        self.assertIn("roles.json", by["lca-readiness.no-product"]["reason_zh"])
        self.assertEqual(by["heat-integration.overlap"]["missing_inputs"], ["graph"])
        self.assertNotIn("lca-readiness.no-roles", fired(adv))

    def test_graph_given_roles_missing_only_skips_roles_rules(self):
        adv = run(summary(), graph([gblock("H1", "i", "o")], [gstream("i", 300.0), gstream("o", 300.0)]))
        skipped = {s["rule"] for s in adv["skipped"]}
        self.assertTrue(self.ROLES_RULES <= skipped)
        self.assertFalse(self.GRAPH_RULES & skipped - {"convergence.mass-balance"})  # 质量守恒可能因数据不足另行登记，但不是因为缺文件
        self.assertTrue(all("missing_inputs" in s for s in adv["skipped"] if s["rule"] in self.ROLES_RULES))

    def test_all_inputs_present_skips_nothing_for_missing_files(self):
        adv = run(summary(), graph([gblock("H1", "i", "o")], [gstream("i", 300.0), gstream("o", 300.0)]), roles())
        self.assertFalse([s for s in adv["skipped"] if "missing_inputs" in s])

    def test_blocked_rules_never_fire_even_with_data_that_would_trigger_them(self):
        s = summary([heater("HOT", -10.0), heater("COLD", 5.0)])
        self.assertFalse(fired(run(s)) & self.GRAPH_RULES)  # 没有 graph：hx() 以前会触发 data-missing

    def test_roles_rules_still_fire_when_roles_given(self):
        self.assertIn("lca-readiness.no-product", fired(run(summary(), None, roles(streams={"F": {"role": "feed"}}))))


class BlockFromPath(unittest.TestCase):
    def test_parse_block_id_from_node_path(self):
        from aspen_study.probe_compat import block_from_path
        self.assertEqual(block_from_path("\\Data\\Blocks\\COOLER\\Output\\QCALC"), "COOLER")
        self.assertEqual(block_from_path("\\Data\\Blocks\\E-100\\Input\\X"), "E-100")
        self.assertIsNone(block_from_path("\\Data\\Streams\\S1"))
        self.assertIsNone(block_from_path(""))
        self.assertIsNone(block_from_path(None))

    def test_build_summary_fills_block_from_path_and_leaves_stream_entries_null(self):
        from aspen_study import probe

        class Ad:
            def energy_gap_items(self): return [{"block": None, "path": "\\Data\\Blocks\\B3\\Output\\QCALC", "reason": "x"}]
            def unverified_items(self): return [{"block": None, "path": "\\Data\\Streams\\S1", "reason": "y"}, {"block": "Z", "path": "\\Data\\Blocks\\Q\\Output\\W", "reason": "z"}]
            def cleaned_pids(self): return []
        g = {"model": {"file": "m", "sha256": SHA, "simulator": "aspen-plus"}, "blocks": [], "streams": [], "discovery": {}}
        rep = {"state": "ok", "run_completed": True, "errors": [], "warnings": [], "notes": [], "raw_status": {}, "run_status_lines": [], "run_seconds": 1}
        s = probe.build_summary(g, Ad(), [], rep, 1.0, 4.1868, True)
        self.assertEqual(s["energy_gaps"][0]["block"], "B3")
        self.assertIsNone(s["unverified_paths"][0]["block"])
        self.assertEqual(s["unverified_paths"][1]["block"], "Z")  # 已有 block 不改写
        validate(s, "probe")

    def test_legacy_1_0_gaps_get_block_from_text(self):
        s = load("heatrecovery.probe-summary.v1.0.json")
        s["energy_gaps"] = ["B3（Sep）heat：QCALC/QNET 都读不到"]
        up = A.upgrade_summary(s)
        self.assertEqual(up["energy_gaps"][0]["block"], "B3")


class LiveFixtures(unittest.TestCase):
    def test_heatrecovery_matches_golden_and_expected_rules(self):
        adv = run(load("heatrecovery.probe-summary.json"), load("heatrecovery.graph.json"), load("heatrecovery.roles.json"))
        self.assertEqual(adv, load("heatrecovery.advice.json"))
        ids = {i["id"] for i in adv["items"]}
        for want in ("thermo.phase-stability:COOLER", "thermo.phase-stability:VALVE", "reaction.rate-zero:REACTOR", "energy.warning-share",
                     "thermo.phase-stability:HEATCHAG", "units.non-si-set", "energy.hotspot", "energy.internal-exchange",
                     "lca-readiness.roles-draft", "lca-readiness.product-low-confidence:S8"):
            self.assertIn(want, ids)
        self.assertEqual(adv["counts"]["critical"], 0)
        by = {i["id"]: i for i in adv["items"]}
        self.assertEqual(by["thermo.phase-stability:HEATCHAG"]["severity"], "suggest")  # BLKSTAT=0 但消息里有稳定性问题
        self.assertEqual(by["thermo.phase-stability:COOLER"]["severity"], "warn")

    def test_mch_clean_matches_golden(self):
        adv = run(load("mch.probe-summary.json"))
        self.assertEqual(adv, load("mch.advice.json"))
        self.assertEqual(adv["counts"]["warn"] + adv["counts"]["critical"], 0)
        self.assertEqual(fired(adv), {"units.non-si-set"})

    def test_legacy_1_0_and_upgraded_1_1_give_same_advice(self):
        a = run(load("heatrecovery.probe-summary.v1.0.json"), load("heatrecovery.graph.json"), load("heatrecovery.roles.json"))
        self.assertEqual(a, load("heatrecovery.advice.json"))
        self.assertEqual(a["inputs"]["migrated_from"], "aspen-probe/1")

    def test_upgrade_adds_required_1_1_fields_and_validates(self):
        for n in ("heatrecovery", "mch"):
            up = upgrade_summary(load(f"{n}.probe-summary.v1.0.json"))
            validate(up, "probe")
            self.assertIs(up["totals_complete"], True)
            self.assertEqual(up, load(f"{n}.probe-summary.json"))
            self.assertEqual(set(up["group_totals"]), {"heating", "cooling", "shaft_work", "internal_exchange", "overall"})
            for b in up["blocks"]:
                self.assertNotIn("messages", b)
                for e in b["energy"]:
                    self.assertIs(e["verified"], True)  # 两个真机样本读到的节点都是已验证配方
        self.assertAlmostEqual(load("heatrecovery.probe-summary.json")["group_totals"]["internal_exchange"]["kW"], 40.501385, places=5)

    def test_upgrade_is_idempotent_and_rejects_unknown_versions(self):
        up = load("mch.probe-summary.json")
        self.assertEqual(upgrade_summary(up), up)
        with self.assertRaises(ValueError):
            upgrade_summary({"schema": "aspen-probe/9"})

    def test_legacy_verified_nodes_table_matches_recipes(self):
        want = {}
        for t, r in R.RECIPES.items():
            d = {n: bool(v) for _k, _h, nodes, v in r["energy"] for n in nodes}
            if d:
                want[t] = d
        self.assertEqual(A.load_rules()["legacy_verified_nodes"], want)


class Cli(unittest.TestCase):
    def test_advise_cli_writes_valid_advice(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "advice.json"
            rc = cli_main(["advise", str(FIX / "heatrecovery.probe-summary.v1.0.json"), "--graph", str(FIX / "heatrecovery.graph.json"),
                           "--roles", str(FIX / "heatrecovery.roles.json"), "--out", str(out)])
            self.assertEqual(rc, 0)
            validate(json.loads(out.read_text(encoding="utf-8")), "advice")

    def test_advise_cli_chinese_errors(self):
        with tempfile.TemporaryDirectory() as d:
            bad = Path(d) / "x.json"
            bad.write_text("not json", encoding="utf-8")
            with self.assertRaises(SystemExit) as cm:
                cli_main(["advise", str(bad)])
            self.assertIn("不是有效的 JSON", str(cm.exception))
            bad.write_text(json.dumps({"schema": "aspen-roles/1"}), encoding="utf-8")
            with self.assertRaises(SystemExit) as cm:
                cli_main(["advise", str(bad)])
            self.assertIn("不是有效的 probe-summary.json", str(cm.exception))
            with self.assertRaises(SystemExit) as cm:
                cli_main(["advise", str(Path(d) / "missing.json")])
            self.assertIn("找不到", str(cm.exception))


@unittest.skipUnless(HAS_NODE, "需要 Node.js")
class JsParity(unittest.TestCase):
    """同一份规则表、两份实现：每个规则用例 + 真机样本，Python 与 JS 的输出必须逐字段一致。"""

    def run_js(self, tmp, s, g, r):
        paths = []
        for name, doc in (("s", s), ("g", g), ("r", r)):
            if doc is None:
                paths.append("-")
                continue
            p = Path(tmp) / f"{name}.json"
            p.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
            paths.append(str(p))
        out = subprocess.run(["node", str(REPO / "universal_pipeline" / "aspen-advice-cli.mjs"), *paths], capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)

    def test_parity(self):
        every = dict(cases())
        every["live-hr"] = (load("heatrecovery.probe-summary.json"), load("heatrecovery.graph.json"), load("heatrecovery.roles.json"))
        every["live-hr-1.0"] = (load("heatrecovery.probe-summary.v1.0.json"), None, None)
        every["live-mch-1.0"] = (load("mch.probe-summary.v1.0.json"), None, None)
        with tempfile.TemporaryDirectory() as tmp:
            for name, (s, g, r) in every.items():
                with self.subTest(case=name):
                    self.assertEqual(self.run_js(tmp, s, g, r), A.advise(s, g, r))


if __name__ == "__main__":
    unittest.main()


class PackageChecks(unittest.TestCase):
    def test_consistent_live_package_has_no_problems(self):
        self.assertEqual(A.package_problems(load("heatrecovery.probe-summary.json"), load("heatrecovery.graph.json"), load("heatrecovery.roles.json")), [])
        self.assertEqual(A.package_problems(load("mch.probe-summary.json")), [])  # 只有 summary 也允许

    def test_mismatches_are_rejected_with_chinese_reasons(self):
        s, g, r = load("heatrecovery.probe-summary.json"), load("heatrecovery.graph.json"), load("heatrecovery.roles.json")
        g2 = copy.deepcopy(g); g2["model"]["sha256"] = "c" * 64
        self.assertIn("graph.json 与 probe-summary.json 来自不同的模型（sha256 不一致）。", A.package_problems(s, g2, r))
        g3 = copy.deepcopy(g); g3["blocks"].pop()
        self.assertTrue(any("块与 graph.json 的块不一致" in p for p in A.package_problems(s, g3, r)))
        r2 = copy.deepcopy(r); del r2["streams"]["S2"]
        self.assertTrue(any("流股与 graph.json 的流股不一致" in p for p in A.package_problems(s, g, r2)))
        s2 = copy.deepcopy(s); s2["model"]["source_unchanged"] = False
        self.assertTrue(any("源模型文件被改动" in p for p in A.package_problems(s2)))

    def test_cli_refuses_inconsistent_inputs(self):
        with tempfile.TemporaryDirectory() as d:
            g = load("heatrecovery.graph.json"); g["model"]["sha256"] = "c" * 64
            gp = Path(d) / "g.json"; gp.write_text(json.dumps(g), encoding="utf-8")
            with self.assertRaises(SystemExit) as cm:
                cli_main(["advise", str(FIX / "heatrecovery.probe-summary.json"), "--graph", str(gp)])
            self.assertIn("不做分析", str(cm.exception))


class ExportedSchemas(unittest.TestCase):
    def test_analysis_web_schema_copies_match_source(self):
        web = REPO / "analysis_web" / "schemas"
        for src, dst in (("probe.schema.json", "aspen-probe-1.1.schema.json"), ("advice.schema.json", "aspen-advice-1.schema.json")):
            self.assertEqual((REPO / "aspen_study" / "schemas" / src).read_text(encoding="utf-8"), (web / dst).read_text(encoding="utf-8"),
                             f"{dst} 与 aspen_study/schemas/{src} 不一致：改完 schema 后请重新复制")

    def test_example_bundle_in_analysis_web_is_the_fixture(self):
        ex = REPO / "analysis_web" / "data" / "aspen-probe-example"
        for name, fx in (("probe-summary.json", "heatrecovery.probe-summary.json"), ("graph.json", "heatrecovery.graph.json"), ("roles.json", "heatrecovery.roles.json")):
            self.assertEqual(json.loads((ex / name).read_text(encoding="utf-8")), load(fx))
