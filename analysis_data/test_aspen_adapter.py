import copy
import json
import unittest

from analysis_data.aspen_adapter import adapt_export


class AspenAdapterTests(unittest.TestCase):
    def setUp(self):
        self.data = {
            "unit_conversion": "node-unit-aware-v1",
            "component_export": "all-stream-components-v1",
            "blocks": {"B1": {"heat_kW": 1.5, "power_kW": 0}},
            "streams": {"FEED": {
                "temperature_C": 25, "pressure_MPa": 25,
                "mass_flow_kg_h": 3600, "mole_flow_kmol_h": 3.6,
                "component_ids": ["WATER", "ZERO", "MISSING"],
                "composition_kg_h": {"WATER": 3600, "ZERO": 0, "MISSING": None},
                "substreams": {"MIXED": {"mass_flow_kg_h": 3000}, "CISOLID": {"mass_flow_kg_h": 600}},
            }},
        }

    def test_si_zero_missing_and_input_immutability(self):
        original = copy.deepcopy(self.data)
        result = adapt_export(self.data)
        total = result["streams"]["FEED"]["total"]
        self.assertEqual(total["temperature_k"], 298.15)
        self.assertEqual(total["pressure_pa"], 25e6)
        self.assertEqual(total["mass_flow_kg_s"], 1)
        self.assertEqual(total["molar_flow_mol_s"], 1)
        self.assertEqual(total["component_mass_flow_kg_s"]["ZERO"], 0)
        self.assertIsNone(total["component_mass_flow_kg_s"]["MISSING"])
        self.assertEqual(result["blocks"]["B1"]["heat_duty_w"], 1500)
        self.assertEqual(result["blocks"]["B1"]["power_w"], 0)
        self.assertEqual(self.data, original)

    def test_substreams_not_added_again(self):
        stream = adapt_export(self.data)["streams"]["FEED"]
        self.assertEqual(stream["total"]["mass_flow_kg_s"], 1)
        self.assertAlmostEqual(sum(s["mass_flow_kg_s"] for s in stream["substreams"].values()), 1)
        self.assertEqual(set(stream["substreams"]), {"MIXED", "CISOLID"})

    def test_nonfinite_stays_json_safe(self):
        self.data["blocks"]["B1"]["heat_kW"] = float("nan")
        result = adapt_export(self.data)
        self.assertIsNone(result["blocks"]["B1"]["heat_duty_w"])
        self.assertEqual(result["quality"]["status"], "partial")
        json.dumps(result, allow_nan=False)

    def test_legacy_units_are_not_assumed(self):
        del self.data["unit_conversion"]
        result = adapt_export(self.data)
        self.assertEqual(result["quality"]["status"], "unverified")
        self.assertIsNone(result["streams"]["FEED"]["total"]["mass_flow_kg_s"])
        self.assertEqual(result["unverified_source_data"]["streams"]["FEED"]["mass_flow_kg_h"], 3600)

    def test_unknown_source_unit_invalidates_affected_value(self):
        self.data["blocks"]["B1"]["source_quantities"] = {
            r"\Data\Blocks\B1\Output\QCALC": {"value": 100, "unit": "mystery"}}
        result = adapt_export(self.data)
        self.assertIsNone(result["blocks"]["B1"]["heat_duty_w"])
        self.assertEqual(result["blocks"]["B1"]["power_w"], 0)
        self.assertTrue(result["diagnostics"])

    def test_missing_component_marker_remains_unverified(self):
        del self.data["component_export"]
        self.assertEqual(adapt_export(self.data)["quality"]["status"], "unverified")


if __name__ == "__main__":
    unittest.main()
