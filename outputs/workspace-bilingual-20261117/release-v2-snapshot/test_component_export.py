"""Component extraction/export checks with synthetic Aspen trees (no simulation)."""
import csv
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import test_datacatch as capture
from batch_runner import BatchRunner
from result_units import convert_quantity


class Elements:
    def __init__(self, children):
        self.children = children

    @property
    def Count(self):
        return len(self.children)

    def Item(self, index):
        return self.children[index]


class Node:
    def __init__(self, name, value=None, unit="", children=()):
        self.Name, self.Value, self.UnitString = name, value, unit
        self.Elements = Elements(list(children))


class Model:
    def __init__(self, components=(), streams=("FEED",)):
        self.Tree = self
        self.nodes = {}
        self.add(r"\Data\Components\Specifications\Input\TYPE",
                 Node("TYPE", children=[Node(c, "CONVEN") for c in components]))
        self.add(r"\Data\Streams", Node("Streams", children=[Node(s) for s in streams]))

    def FindNode(self, path):
        return self.nodes.get(path)

    def add(self, path, node):
        self.nodes[path] = node
        for child in node.Elements.children:
            self.add(path + "\\" + child.Name, child)

    def field(self, stream, field, substreams, unit):
        children = [Node(sub, children=[Node(comp, value, unit) for comp, value in values.items()])
                    for sub, values in substreams.items()]
        self.add(f"\\Data\\Streams\\{stream}\\Output\\{field}", Node(field, children=children))

    def totals(self, stream, field, substreams, unit):
        self.add(f"\\Data\\Streams\\{stream}\\Output\\{field}",
                 Node(field, children=[Node(sub, value, unit) for sub, value in substreams.items()]))


class ExtractionTests(unittest.TestCase):
    def test_failed_stream_enumeration_is_not_silently_reported_as_complete(self):
        model = Model(streams=["FEED", "OUT"])
        root = model.FindNode(r"\Data\Streams")
        root.Elements.Item = lambda index: (_ for _ in ()).throw(RuntimeError("COM read failed"))
        with self.assertRaisesRegex(RuntimeError, "完整枚举"):
            capture.capture_all(model, Path("test.bkp"))

    def test_all_streams_components_zero_trace_and_missing(self):
        model = Model(["WATER", "ZERO", "TRACE", "MISSING"], ["FEED", "OUT", "QEN"])
        model.field("FEED", "MASSFLOW", {"MIXED": {"WATER": 1, "ZERO": 0, "TRACE": 1e-12}}, "kg/sec")
        model.field("OUT", "MASSFLOW", {"MIXED": {"WATER": 2, "ZERO": 0, "TRACE": 1e-14, "MISSING": None}}, "kg/hr")
        model.totals("FEED", "MASSFLMX", {"MIXED": 1}, "kg/sec")
        result = capture.capture_all(model, Path("test.bkp"))
        self.assertEqual(set(result["streams"]), {"FEED", "OUT", "QEN"})
        self.assertEqual(result["component_ids"], ["WATER", "ZERO", "TRACE", "MISSING"])
        data = result["streams"]["FEED"]
        self.assertEqual(data["composition_kg_h"]["WATER"], 3600)
        self.assertEqual(data["composition_kg_h"]["ZERO"], 0)
        self.assertAlmostEqual(data["composition_kg_h"]["TRACE"], 3.6e-9, places=18)
        self.assertIsNone(data["composition_kg_h"]["MISSING"])
        self.assertEqual(data["component_data_status"], "partial")
        self.assertEqual(result["streams"]["QEN"]["component_data_status"], "no_component_output")
        self.assertEqual(result["streams"]["QEN"]["composition_kg_h"], {})

    def test_multiple_substreams_aggregate_without_double_counting(self):
        model = Model(["WATER", "CARBON"])
        model.field("FEED", "MASSFLOW", {"MIXED": {"WATER": 100}, "CISOLID": {"CARBON": 2}}, "kg/hr")
        model.field("FEED", "MOLEFLOW", {"MIXED": {"WATER": 5}, "CISOLID": {"CARBON": .2}}, "kmol/hr")
        model.totals("FEED", "MASSFLMX", {"MIXED": 100, "CISOLID": 2}, "kg/hr")
        model.totals("FEED", "MOLEFLMX", {"MIXED": 5, "CISOLID": .2}, "kmol/hr")
        stream = capture.capture_stream(model, "FEED", ["WATER", "CARBON"])
        self.assertEqual(stream["mass_flow_kg_h"], 102)
        self.assertEqual(stream["composition_kg_h"], {"WATER": 100, "CARBON": 2})
        self.assertAlmostEqual(stream["mass_fraction"]["CARBON"], 2/102)
        self.assertEqual(set(stream["substreams"]), {"MIXED", "CISOLID"})
        self.assertEqual(stream["component_data_status"], "complete")

    def test_unread_component_cannot_be_summed_as_zero(self):
        model = Model(["A"])
        model.field("FEED", "MASSFLOW", {"MIXED": {"A": 1}, "CISOLID": {"A": None}}, "kg/hr")
        stream = capture.capture_stream(model, "FEED", ["A"])
        self.assertIsNone(stream["composition_kg_h"]["A"])
        self.assertEqual(stream["substreams"]["MIXED"]["composition_kg_h"]["A"], 1)

    def test_unknown_component_unit_keeps_source_and_other_components(self):
        model = Model(["A", "B"])
        model.field("FEED", "MASSFLOW", {"MIXED": {"A": 1, "B": 2}}, "kg/hr")
        model.FindNode(r"\Data\Streams\FEED\Output\MASSFLOW\MIXED\A").UnitString = "unknown"
        stream = capture.capture_stream(model, "FEED", ["A", "B"])
        self.assertIsNone(stream["composition_kg_h"]["A"])
        self.assertEqual(stream["composition_kg_h"]["B"], 2)
        self.assertTrue(stream["extraction_warnings"])
        raw = stream["source_quantities"][r"\Data\Streams\FEED\Output\MASSFLOW\MIXED\A"]
        self.assertEqual(raw, {"value": 1, "unit": "unknown"})

    def test_mole_fraction_units_and_nonfinite_values(self):
        self.assertEqual(convert_quantity(1, "mol/sec", "kmol/h"), 3.6)
        model = Model(["A", "B"])
        model.field("FEED", "MASSFLOW", {"MIXED": {"A": float("nan"), "B": 0}}, "kg/hr")
        model.field("FEED", "MOLEFLOW", {"MIXED": {"A": 1, "B": 0}}, "mol/sec")
        model.field("FEED", "MASSFRAC", {"MIXED": {"A": 25, "B": 75}}, "%")
        model.field("FEED", "MOLEFRAC", {"MIXED": {"A": 1, "B": 0}}, "")
        stream = capture.capture_stream(model, "FEED", ["A", "B"])
        self.assertIsNone(stream["composition_kg_h"]["A"])
        self.assertEqual(stream["composition_kmol_h"]["A"], 3.6)
        self.assertEqual(stream["mass_fraction"]["A"], .25)
        self.assertEqual(stream["mole_fraction"]["B"], 0)
        json.dumps(stream, allow_nan=False)


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        model = Model(["ZERO", "TRACE", "MISSING"], ["FEED", "QEN"])
        model.field("FEED", "MASSFLOW", {"MIXED": {"ZERO": 0, "TRACE": 1e-14}}, "kg/hr")
        self.capture = capture.capture_all(model, Path("test.bkp"))

    def read(self, path):
        with path.open(encoding="utf-8-sig", newline="") as f:
            return list(csv.DictReader(f))

    def test_single_case_csv_and_json_preserve_every_component(self):
        with patch("test_datacatch.OUTPUT_ROOT", self.directory):
            paths = capture.save_results(self.capture, Path("test.bkp"))
            other = capture.save_results(self.capture, Path("test.bkp"))
        self.assertNotEqual(paths[0], other[0])
        streams = self.read(paths[2])
        self.assertEqual(len(streams), 2)
        self.assertEqual(streams[0]["组分.ZERO.质量流量_kg_h"], "0.0")
        self.assertGreater(float(streams[0]["组分.TRACE.质量流量_kg_h"]), 0)
        self.assertEqual(streams[0]["组分.MISSING.质量流量_kg_h"], "")
        rows = self.read(paths[0].parent / "stream_components.csv")
        totals = [r for r in rows if r["子物流"] == "TOTAL"]
        self.assertEqual({r["组分"] for r in totals}, {"ZERO", "TRACE", "MISSING"})
        self.assertTrue(any(r["物流"] == "QEN" and r["质量流量读取状态"] == "无组分输出" for r in rows))
        self.assertEqual(json.loads(paths[0].read_text(encoding="utf-8"))["component_export"], "all-stream-components-v1")

    def test_batch_wide_and_long_csv_keep_failures_and_zero_values(self):
        runner = BatchRunner(Path("test.bkp"), {}, [])
        runner.batch_results = [dict(run_index=1, run_name="baseline", status="success", parameters={},
                                    blocks={}, streams=self.capture["streams"], component_ids=self.capture["component_ids"]),
                                dict(run_index=2, run_name="failed", status="failed", parameters={}, blocks={}, streams={})]
        with patch("batch_runner.OUTPUT_ROOT", self.directory):
            _, csv_path, directory = runner.save_batch_summary()
        rows = self.read(csv_path)
        self.assertEqual(rows[0]["物流.FEED.组分.ZERO.质量流量_kg_h"], "0.0")
        self.assertEqual(rows[1]["物流.FEED.组分.ZERO.质量流量_kg_h"], "")
        details = self.read(directory / "batch_stream_components.csv")
        self.assertTrue(any(r["运行状态"] == "failed" and r["质量流量读取状态"] == "无结果" for r in details))
        self.assertTrue(any(r["组分"] == "TRACE" and float(r["质量流量_kg_h"]) > 0 for r in details))


if __name__ == "__main__":
    unittest.main()
