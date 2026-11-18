"""Regression checks for functional-unit and temperature issues in source data."""
import unittest
from build_study import build


class StudyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = build()
        cls.cases = {case['id']: case for case in cls.data['cases']}

    def test_preserve_model_temperature(self):
        case = self.cases['T310-L5-STD']
        self.assertEqual(case['inputs']['temperature_k'], 583)
        self.assertEqual(case['inputs']['nominal_temperature_c'], 310)

    def test_corrected_functional_unit(self):
        lca = self.cases['T330-L5-STD']['lca']
        self.assertAlmostEqual(lca['gwp_kg_co2e'], 87.34177242524233)
        self.assertEqual(lca['reference_target_kg'], 4.386656)
        self.assertAlmostEqual(lca['cf_kg_co2e_per_kg_target'], 87.34177242524233 / 4.386656)
        self.assertNotEqual(lca['export_target_scale'], 1)

    def test_inventory_pump_is_separate(self):
        out = self.cases['T310-L5-STD']['outputs']
        self.assertAlmostEqual(out['pump_inventory_j'] / 3_600_000, 2.172)
        self.assertAlmostEqual(out['pump_w'], 2171.721)
        self.assertAlmostEqual(out['electricity_j'] / 3_600_000, 43.649517)

    def test_paired_outputs_and_monte_carlo(self):
        self.assertEqual(len(self.cases), 40)
        for case in self.cases.values():
            std = self.cases[case['condition_id'] + '-STD']
            self.assertEqual(case['outputs']['target_monomer_kg'], std['outputs']['target_monomer_kg'])
            self.assertEqual(case['lca']['iterations'], 1000)
            self.assertEqual(set(case['provenance']['rows']), {'process', 'inventory', 'energy', 'monte_carlo'})


if __name__ == '__main__':
    unittest.main()
