import unittest

from aspen_study.adapters import MockAdapter
from aspen_study.classifier import classify
from aspen_study.overrides import load_override, merge
from .helpers import FIXTURES, fixture


def graph(name):
    return MockAdapter(FIXTURES / f"{name}.graph.json").discover()


class ClassifierTests(unittest.TestCase):
    def test_htl_shape(self):
        r = classify(graph("htl"))
        s, b = r["streams"], r["blocks"]
        self.assertEqual(s["FEED"]["role"], "feed")
        for sid in ("S9", "S3", "S4"):
            self.assertEqual(s[sid]["role"], "internal", "HeatX loop is heat integration, not material recycle")
        self.assertEqual(b["HEATCHAG"]["role"], "internal_recovery")
        self.assertEqual(b["PUMP"]["utility"], "electricity")
        self.assertEqual((b["COOLER"]["role"], b["COOLER"]["utility"]), ("cooler", "cooling_water"))
        self.assertEqual(b["HEATER"]["utility"], "fired_heat")
        self.assertEqual(s["S7"]["role"], "product")
        self.assertTrue(s["S7"]["provenance"]["needs_confirmation"])
        self.assertEqual(r["review"]["state"], "auto_draft")
        self.assertIn("functional_unit: 需人工确认产品流股与组分", r["review"]["pending"])

    def test_distillation_shape(self):
        r = classify(graph("distillation"))
        s, b = r["streams"], r["blocks"]
        self.assertEqual(s["VENT"]["role"], "emission")
        self.assertEqual({s["BZPROD"]["role"], s["TOLPROD"]["role"]}, {"product", "coproduct"})
        self.assertEqual(b["C1"]["role"], "column")
        self.assertEqual(b["C1"]["duty_utilities"], {"condenser": "cooling_water", "reboiler": "lp_steam"})
        self.assertEqual(b["P1"]["role"], "pump")

    def test_real_recycle_detected(self):
        g = fixture("distillation.graph.json")
        # Route part of the bottoms back to the feed pump through a splitter.
        g["blocks"].append({"id": "SPL", "type": "FSplit", "ports": {"in": ["TOLPROD"], "out": ["OUT", "REC"]}, "energy": []})
        g["blocks"][0]["ports"]["in"].append("REC")
        for st in g["streams"]:
            if st["id"] == "TOLPROD":
                st["to"] = "SPL"
        g["streams"] += [{"id": "OUT", "class": "MATERIAL", "from": "SPL", "to": "BOUNDARY"},
                         {"id": "REC", "class": "MATERIAL", "from": "SPL", "to": "P1"}]
        r = classify(g)
        self.assertEqual(r["streams"]["REC"]["role"], "recycle")
        self.assertEqual(r["blocks"]["SPL"]["role"], "mixer_splitter")


class OverrideTests(unittest.TestCase):
    def test_json_override_confirms_and_demotes(self):
        g = graph("distillation")
        auto = classify(g)
        merged = merge(auto, {"functional_unit": {"basis": "product_mass", "amount": 1, "unit": "kg", "stream": "BZPROD"},
                              "streams": {"BZPROD": {"role": "product"}}}, g)
        self.assertEqual(merged["streams"]["BZPROD"]["provenance"]["source"], "override")
        self.assertEqual(merged["streams"]["TOLPROD"]["role"], "coproduct")
        self.assertEqual(merged["review"]["state"], "partially_reviewed")
        self.assertFalse(any(p.startswith("functional_unit") for p in merged["review"]["pending"]))

    def test_reviewed_override_clears_pending(self):
        g = graph("htl")
        merged = merge(classify(g), load_override(FIXTURES / "htl.roles.json"), g)
        self.assertEqual(merged["review"]["state"], "reviewed")
        self.assertEqual(merged["streams"]["S8"]["role"], "emission")
        self.assertEqual(merged["blocks"]["HEATER"]["utility"], "electricity")

    def test_bad_overrides_rejected(self):
        g = graph("htl")
        auto = classify(g)
        with self.assertRaises(ValueError):
            merge(auto, {"streams": {"NOPE": {"role": "product"}}}, g)
        with self.assertRaises(ValueError):
            merge(auto, {"model_sha256": "0" * 64}, g)
        with self.assertRaises(ValueError):
            merge(auto, {"streams": {"S7": {"role": "gold"}}}, g)

    def test_yaml_matches_json(self):
        try:
            import yaml  # noqa: F401
        except ImportError:
            self.skipTest("PyYAML not installed")
        self.assertEqual(load_override(FIXTURES / "htl.roles.yaml"), load_override(FIXTURES / "htl.roles.json"))
