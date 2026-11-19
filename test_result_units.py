"""Unit regression: every energy number is converted from the node's own unit with 1 cal = 4.1868 J.

Real data: aspen_study/tests/fixtures/live/*.json (heatrecovery.bkp in MET -> cal/sec; mch.bkp -> Btu/hr).
"""
import importlib.util
import json
import math
import re
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import result_units as units
from aspen_study.tests.fake_aspen import FakeDoc, build_table, heatrecovery_spec

ROOT = Path(__file__).resolve().parent
LIVE = ROOT / "aspen_study/tests/fixtures/live"


def live(name):
    return json.loads((LIVE / name).read_text(encoding="utf-8"))


class RealDataConversionTests(unittest.TestCase):
    def test_every_live_duty_converts_to_the_probes_kw(self):
        checked = 0
        for name in ("live_hr_summary.json", "live_mch_summary.json"):
            for block in live(name)["blocks"]:
                for e in block["energy"]:
                    self.assertAlmostEqual(units.convert_quantity(e["value"], e["unit"], "kW"), e["kW"], places=9,
                                           msg=f"{block['id']} {e['unit']}")
                    checked += 1
        self.assertEqual(checked, 8)

    def test_aspens_calorie_is_4_1868_verified_ratio(self):
        # same enthalpy flow read in MET and SI on the real model: -81613.3056 cal/sec = -341698.588 W
        self.assertAlmostEqual(-81613.3056 * 4.1868, -341698.588, places=2)
        self.assertAlmostEqual(units.convert_quantity(-81613.3056, "cal/sec", "kW") * 1000, -341698.588, places=2)
        self.assertEqual(units.CALORIE_J, 4.1868)

    def test_cal_units_scale_with_the_calorie_and_default_is_not_4_184(self):
        for unit, per in (("cal/sec", 1), ("cal/s", 1), ("kcal/sec", 1000), ("kcal/hr", 1000 / 3600)):
            self.assertAlmostEqual(units.convert_quantity(1, unit, "kW"), per * 4.1868 / 1000, msg=unit)
            self.assertAlmostEqual(units.convert_quantity(1, unit, "kW", calorie_J=4.184), per * 4.184 / 1000, msg=unit)
        with self.assertRaises(ValueError):
            units.convert_quantity(1, "cal/sec", "kW", calorie_J=4.2)

    def test_non_calorie_units_and_unknowns(self):
        self.assertAlmostEqual(units.convert_quantity(1, "Btu/hr", "kW"), 1055.05585262 / 3600000)
        self.assertEqual(units.convert_quantity(2.1717208, "kW", "kW"), 2.1717208)
        self.assertEqual(units.convert_quantity(5, "W", "kW"), 0.005)
        with self.assertRaises(ValueError):       # unknown unit is an error, never "assume kW"
            units.convert_quantity(1, "mystery/hr", "kW")

    def test_format_quantity_always_prints_the_unit(self):
        self.assertEqual(units.format_quantity(4.189, "kW"), "4.19 kW")
        self.assertEqual(units.format_quantity(None, "kW"), "无")
        self.assertEqual(units.format_quantity(float("nan"), "kW"), "无")
        self.assertEqual(units.format_quantity(None, "°C", missing="未计算/无"), "未计算/无")

    def test_missing_units_audit_flags_bare_numbers(self):
        self.assertEqual(units.missing_units({"heat_kW": 1.0, "units": {"heat_kW": "kW"}}, {"heat_kW": "kW"}), [])
        self.assertEqual(units.missing_units({"heat": 1.0}, {"heat_kW": "kW"}), ["heat: no unit declared"])
        self.assertEqual(units.missing_units({"q": {"value": 1.0, "unit": ""}}, {}), ["q: unit is empty"])
        self.assertEqual(units.missing_units({"q": {"value": 1.0, "unit": "cal/sec"}}, {}), [])


class NoImplicitKwTests(unittest.TestCase):
    """The generated control scripts and their template must not carry 4.184 / W / K / atm / kg-per-second guesses."""
    FORBIDDEN = [r"/ 1000\b", r"\* 3600\b", r"273\.15", r"\* 0\.101325", r"\b4\.184\b", r"Value \* ", r"即为 kW"]

    def sources(self):
        files = sorted((ROOT / "generated").glob("*_control.py"))
        self.assertEqual(len(files), 3)
        return files + [ROOT / "test_aspen_control.py"]

    def test_no_hardcoded_unit_assumptions(self):
        for path in self.sources():
            text = path.read_text(encoding="utf-8")
            for pattern in self.FORBIDDEN:
                self.assertIsNone(re.search(pattern, text), f"{path.name}: {pattern}")
            self.assertIn("datacatch.capture_block", text, path.name)
            self.assertIn("format_quantity", text, path.name)

    def test_result_units_source_has_no_4_184_default(self):
        text = (ROOT / "result_units.py").read_text(encoding="utf-8")
        self.assertIsNone(re.search(r"\.004184|4\.184 / 3600|\"kcal/sec\": 4\.184\b", text))

    def test_generated_resolvers_use_node_units_on_the_real_heatrecovery_values(self):
        stubs = {"pythoncom": types.ModuleType("pythoncom"), "win32com": types.ModuleType("win32com"),
                 "win32com.client": types.ModuleType("win32com.client")}
        stubs["win32com"].client = stubs["win32com.client"]
        spec = heatrecovery_spec()
        spec[r"\Data\Blocks\HEATER\Output\QCALC"] = dict(value=1000.52531, unit="cal/sec")
        doc = FakeDoc(build_table(spec))
        for path in sorted((ROOT / "generated").glob("*_control.py")):
            with patch.dict(sys.modules, stubs):
                loader = importlib.util.spec_from_file_location("gen_" + path.stem.replace("-", "_"), path)
                module = importlib.util.module_from_spec(loader)
                loader.loader.exec_module(module)
            self.assertAlmostEqual(module.resolve_block_heat(doc, "HEATER"), 1000.52531 * 4.1868 / 1000, msg=path.name)
            self.assertAlmostEqual(module.resolve_block_heat(doc, "COOLER"), -2087.51163 * 4.1868 / 1000, msg=path.name)
            self.assertAlmostEqual(module.resolve_block_power(doc, "PUMP"), 2.1717208, msg=path.name)   # node unit is kW
            self.assertIsNone(module.resolve_block_heat(doc, "VALVE"))
            self.assertIsNone(module.resolve_block_power(doc, "VALVE"))
            self.assertEqual(module.resolve_block_power(doc, "VALVE", power_override_kW=2.17), 2.17)      # override is kW by definition
            self.assertTrue(math.isclose(module.resolve_block_power(doc, "PUMP", power_override_kW=9.9), 2.1717208))


if __name__ == "__main__":
    unittest.main()
