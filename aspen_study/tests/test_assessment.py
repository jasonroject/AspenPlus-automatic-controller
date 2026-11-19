import json
import tempfile
import unittest
from pathlib import Path

from aspen_study.adapters import MockAdapter
from aspen_study.build import assess_case, build_project, run_core, write_study
from aspen_study.classifier import classify
from aspen_study.factors import load_library
from aspen_study.overrides import load_override, merge
from aspen_study.schema_check import validate
from aspen_study.validation import block_balance
from .helpers import FIXTURES, HAS_NODE, fixture, user_library

ROOT = Path(__file__).resolve().parents[2]


def htl_roles(g, **override):
    o = load_override(FIXTURES / "htl.roles.json")
    o.update(override)
    return merge(classify(g), o, g)


def acyclic(edges):
    graph = {}
    for e in edges:
        graph.setdefault(e["source"], []).append(e["target"])
    state = {}

    def visit(n):
        if state.get(n) == 1:
            return False
        if state.get(n) == 2:
            return True
        state[n] = 1
        ok = all(visit(m) for m in graph.get(n, []))
        state[n] = 2
        return ok
    return all(visit(n) for n in list(graph))


@unittest.skipUnless(HAS_NODE, "Node.js is required for universal-core")
class AssessmentTests(unittest.TestCase):
    def test_errored_model_rejected_before_core(self):
        g = MockAdapter(FIXTURES / "errored.graph.json").discover()
        project, res, contrib, _, kpi = assess_case(g, classify(g))
        self.assertIsNone(project)
        self.assertEqual(res["status"], "rejected")
        gates = {x["id"]: x["status"] for x in res["gates"]}
        self.assertEqual(gates["G1_converged"], "fail")
        self.assertEqual({gates[k] for k in ("G3_balance", "G4_roles", "G5_factors")}, {"not_run"})
        self.assertIsNone(kpi["gwp_per_fu"])

    def test_htl_energy_matches_existing_reference(self):
        g = MockAdapter(FIXTURES / "htl.graph.json").discover()
        _, res, _, _, kpi = assess_case(g, htl_roles(g), "T325_L8.5", {"temperature_C": 325, "length_m": 8.5})
        ref = json.loads((ROOT / "analysis_web/data/universal-htl.json").read_text(encoding="utf-8"))
        product = ref["cases"][0]["product_rate"]
        # Native pump work 2.1717208 kW; the archived HTL inventory used a fixed 2.172 kWh pump term instead.
        self.assertAlmostEqual(kpi["energy_per_fu"], (2.1717208 + 4.0017766538844 + 6.098953051188) / product, places=12)
        elec = next(r["amount"] for r in ref["inventory"] if r["id"] == "electricity")
        self.assertAlmostEqual(elec - 4.0017766538844 - 6.098953051188, 2.172, places=9)
        self.assertAlmostEqual(kpi["efficiency"], ref["cases"][0]["product_rate"] / 100, places=12)
        gates = {x["id"]: x["status"] for x in res["gates"]}
        self.assertEqual(gates["G3_balance"], "pass")
        self.assertLess(kpi["max_balance_ratio"], 1)
        self.assertTrue(acyclic(res["energy_edges"]))
        loop = [l for l in res["internal_loops"] if l["kind"] == "heat_exchange"]
        self.assertAlmostEqual(loop[0]["value"], 39.265041)
        self.assertEqual(res["case_params"], {"temperature_C": 325, "length_m": 8.5})

    def test_missing_factor_is_incomplete_never_zero(self):
        g = MockAdapter(FIXTURES / "htl.graph.json").discover()
        _, res, contrib, _, kpi = assess_case(g, htl_roles(g))
        c = res["completeness"]["GWP100"]
        self.assertFalse(c["complete"])
        self.assertIsNone(c["total"])
        self.assertIsNone(kpi["gwp_per_fu"])
        for item in ("emis_S8_CO2", "elec_PUMP", "feed_FEED"):
            self.assertIn(item, c["missing"])
        self.assertGreater(c["lower_bound"], 0)
        self.assertAlmostEqual(c["lower_bound"], sum(x["value"] for x in contrib))
        self.assertEqual({x["status"] for x in res["gates"] if x["id"] == "G5_factors"}, {"warn"})

    def test_complete_with_user_factors_matches_hand_arithmetic(self):
        g = MockAdapter(FIXTURES / "htl.graph.json").discover()
        roles = htl_roles(g)
        roles["streams"]["S8"]["carbon_origin"] = "fossil"
        lib = user_library([("t-elec", {"utility": "electricity"}, 0.5, "kWh"),
                            ("t-cw", {"utility": "cooling_water"}, 0.01, "MJ"),
                            ("t-feed", {"component": "HTL-FEED", "flow": "material_input"}, 2.0, "kg"),
                            ("t-h2", {"cas": "1333-74-0", "flow": "emission_air"}, 0.0, "kg")])
        entries = load_library(extra=[lib])
        _, res, contrib, sources, kpi = assess_case(g, roles, entries=entries)
        c = res["completeness"]["GWP100"]
        self.assertTrue(c["complete"], c["missing"])
        product = 3.2 + 2.300864712016662
        expected = (0.5 * (2.1717208 + 4.0017766538844 + 6.098953051188) + 0.01 * 7.449536563632 * 3.6
                    + 2.0 * 100 + 0.0339951446 * 1 + 0.016028400793 * 29.8) / product
        self.assertAlmostEqual(kpi["gwp_per_fu"], expected, places=9)
        self.assertAlmostEqual(c["total"], sum(x["value"] for x in contrib), places=9)
        self.assertIn("t-elec", {s["factor_id"] for s in sources})

    def test_unreviewed_distillation_blocks_lca_but_reports_energy(self):
        g = MockAdapter(FIXTURES / "distillation.graph.json").discover()
        _, res, _, _, kpi = assess_case(g, classify(g))
        gates = {x["id"]: x["status"] for x in res["gates"]}
        self.assertEqual(gates["G4_roles"], "fail")
        self.assertEqual(gates["G3_balance"], "pass")
        self.assertEqual(res["status"], "accepted_with_warnings")
        self.assertFalse(res["completeness"]["GWP100"]["complete"])
        self.assertIn("emis_VENT_BENZENE", res["completeness"]["GWP100"]["missing"])
        self.assertAlmostEqual(res["energy"]["electricity_kW"], 1.5)
        self.assertAlmostEqual(res["energy"]["hot_utility_kW"], 570.0)
        self.assertAlmostEqual(res["energy"]["cold_utility_kW"], 500.0)
        self.assertTrue(acyclic(res["energy_edges"]))

    def test_missing_block_energy_fails_completeness(self):
        g = fixture("htl.graph.json")
        next(b for b in g["blocks"] if b["id"] == "HEATER")["energy"] = []
        g = MockAdapter(g).discover()
        _, res, _, _, _ = assess_case(g, htl_roles(g))
        gates = {x["id"]: x for x in res["gates"]}
        self.assertEqual(gates["G2_completeness"]["status"], "fail")
        self.assertEqual(gates["G3_balance"]["status"], "fail")

    def test_balance_ratio_mirrors_core_tolerance(self):
        g = fixture("distillation.graph.json")
        next(b for b in g["blocks"] if b["id"] == "H1")["energy"][0]["value"] = 125.0  # 5 kW imbalance
        g = MockAdapter(g).discover()
        roles = classify(g)
        project, _, _ = build_project(g, roles)
        core = run_core(project)["report"]["results"][0]["balance"]
        rows = {r["block"]: r for r in block_balance(core)}
        for b in core["blocks"]:
            self.assertEqual(b["within_tolerance"], rows[b["id"]]["ratio"] <= 1, b["id"])
        self.assertGreater(rows["H1"]["ratio"], 1)

    def test_write_study_bundle(self):
        g = MockAdapter(FIXTURES / "htl.graph.json").discover()
        roles = htl_roles(g)
        g2 = json.loads(json.dumps(g))
        with tempfile.TemporaryDirectory() as tmp:
            manifest = write_study(tmp, "htl-fixture", g, roles,
                                   [("T325_L8.5", g, {"temperature_C": 325, "length_m": 8.5}),
                                    ("T325_L8.5_copy", g2, {"temperature_C": 325, "length_m": 8.5})],
                                   variables=[{"id": "temperature_C", "unit": "C"}, {"id": "length_m", "unit": "m"}])
            out = Path(tmp)
            validate(json.loads((out / "manifest.json").read_text(encoding="utf-8")), "manifest")
            validate(json.loads((out / "results/summary.json").read_text(encoding="utf-8")), "results")
            for c in manifest["cases"]:
                self.assertTrue((out / c["file"]).exists() and (out / c["result"]).exists())
                self.assertIn("energy_per_fu", c["kpi"])
                self.assertIn("GWP100", c["completeness"])
                validate(json.loads((out / c["file"]).read_text(encoding="utf-8")), "case")
            self.assertNotIn("energy_edges", json.dumps(manifest))
            self.assertEqual(manifest["gates"]["G5_factors"], "warn")


if __name__ == "__main__":
    unittest.main()
