"""Regression checks; no Aspen launch required."""
import unittest
from parameter_catalog import build_cases, apply_parameters, discover_parameters
from result_units import convert_quantity


class Elements:
    def __init__(self, nodes=()):
        self.nodes = list(nodes)
        self.Count = len(self.nodes)

    def Item(self, i):
        return self.nodes[i]


class Node:
    def __init__(self, name, value=None, children=()):
        self.Name = name
        self.Value = value
        self.Elements = Elements(children)
        self.UnitString = "K"


class Model:
    def __init__(self, nodes):
        self.nodes = nodes
        self.Tree = self

    def FindNode(self, path):
        return self.nodes.get(path)


class ControlTests(unittest.TestCase):
    def test_actual_aspen_units(self):
        self.assertEqual(convert_quantity(100, "kg/hr", "kg/h"), 100)
        self.assertAlmostEqual(convert_quantity(1, "kg/sec", "kg/h"), 3600)
        self.assertAlmostEqual(convert_quantity(1000.52531, "cal/sec", "kW"), 4.18619789704)
        self.assertAlmostEqual(convert_quantity(1, "atm", "MPa"), .101325)
        self.assertAlmostEqual(convert_quantity(298.15, "K", "C"), 25)
        with self.assertRaises(ValueError):
            convert_quantity(1, "unknown", "kW")

    def test_linked_and_baseline(self):
        cases = build_cases({"reactor": [613, 623], "heater": [613, 623], "pump": [200]}, baseline={"feed": 100})
        self.assertEqual(cases, [{"reactor": 613, "heater": 613, "pump": 200, "feed": 100},
                                 {"reactor": 623, "heater": 623, "pump": 200, "feed": 100}])

    def test_factorial(self):
        cases = build_cases({"reactor": [613, 623], "pump": [100, 200, 300]}, "factorial")
        self.assertEqual(len(cases), 6)
        self.assertEqual(cases[-1], {"reactor": 623, "pump": 300})

    def test_invalid_lengths_and_limit(self):
        with self.assertRaises(ValueError):
            build_cases({"a": [1, 2], "b": [1, 2, 3]})
        with self.assertRaises(ValueError):
            build_cases({"a": list(range(101)), "b": list(range(100))}, "factorial")

    def test_recursive_stream_discovery(self):
        stream = Node("FEED")
        root = Node("Streams", children=[stream])
        leaf = Node("WATER", 10)
        inp = Node("Input", children=[Node("FLOW", children=[Node("MIXED", children=[leaf])])])
        cat = discover_parameters(Model({r"\Data\Streams": root, r"\Data\Streams\FEED\Input": inp}))
        self.assertEqual(cat["Streams.FEED.FLOW/MIXED/WATER"]["path"], r"\Data\Streams\FEED\Input\FLOW\MIXED\WATER")

    def test_multi_device_write_and_preflight(self):
        a, b = Node("a", 600), Node("b", 200)
        model = Model({"a": a, "b": b})
        cat = {"reactor": {"path": "a"}, "pump": {"path": "b"}}
        self.assertEqual(apply_parameters(model, cat, {"reactor": "623", "pump": 220}), {"reactor": 623, "pump": 220})
        with self.assertRaises(ValueError):
            apply_parameters(model, cat, {"reactor": 700, "unknown": 1})
        self.assertEqual(a.Value, 623)
        with self.assertRaises(ValueError):
            apply_parameters(model, cat, {"reactor": "NaN"})

    def test_duplicate_alias(self):
        model = Model({"a": Node("a", 1)})
        with self.assertRaises(ValueError):
            apply_parameters(model, {"old": {"path": "a"}, "new": {"path": "a"}}, {"old": 2, "new": 3})

    def test_string_selector_and_readback(self):
        model = Model({"a": Node("a", "YES")})
        self.assertEqual(apply_parameters(model, {"flag": {"path": "a"}}, {"flag": "NO"}), {"flag": "NO"})
        class ReadOnly:
            Value = property(lambda self: 1, lambda self, value: None)
        model.nodes["a"] = ReadOnly()
        with self.assertRaises(ValueError):
            apply_parameters(model, {"flag": {"path": "a"}}, {"flag": 2})


if __name__ == "__main__":
    unittest.main()
