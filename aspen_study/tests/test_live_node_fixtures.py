"""Consumes fixtures saved from a real Aspen by `python -m aspen_study.verify_nodes verify ...`
(aspen_study/tests/fixtures/live/nodes/*.nodes.json). Every test is skipped until the matching fixture exists."""
import json
import unittest

from aspen_study import verify_nodes as V
from aspen_study.adapters import aspen_rules as R
from aspen_study.schema_check import validate

FIXTURES = V.load_fixtures()
HELP = "no live fixture yet: run `python -m aspen_study.verify_nodes verify <model.bkp>` on a PC with Aspen (see docs/Aspen节点验证.md)"


def blocks_of(type_name):
    return [(path.name, doc, b) for path, doc in FIXTURES for b in doc["blocks"] if b["type"].lower() == type_name.lower()]


class LiveNodeFixtures(unittest.TestCase):
    def test_fixtures_are_well_formed_and_pass_the_checks(self):
        if not FIXTURES:
            self.skipTest(HELP)
        for path, doc in FIXTURES:
            with self.subTest(fixture=path.name):
                self.assertEqual(V.check_verification(doc), [])

    def test_companion_probe_files_are_valid_and_same_model(self):
        if not FIXTURES:
            self.skipTest(HELP)
        for path, doc in FIXTURES:
            stem = path.name[:-len(".nodes.json")]
            summary_path, graph_path = path.with_name(stem + ".probe-summary.json"), path.with_name(stem + ".graph.json")
            with self.subTest(fixture=path.name):
                self.assertTrue(summary_path.is_file() and graph_path.is_file(), "save all three files together")
                summary = json.loads(summary_path.read_text(encoding="utf-8"))
                graph = json.loads(graph_path.read_text(encoding="utf-8"))
                validate(summary, "probe")
                validate(graph, "graph")
                self.assertEqual(summary["model"]["sha256"], doc["model"]["sha256"])
                self.assertEqual(graph["model"]["sha256"], doc["model"]["sha256"])

    def test_every_numeric_energy_reading_has_a_unit(self):
        if not FIXTURES:
            self.skipTest(HELP)
        for path, doc in FIXTURES:
            for b in doc["blocks"]:
                for e in b["energy_read"]:
                    with self.subTest(fixture=path.name, block=b["id"]):
                        self.assertTrue(e["unit"])
                        self.assertIsNotNone(R.to_kW(e["value"], e["unit"], doc["calorie_J"])[0])


def _make_type_test(type_name):
    def test(self):
        found = blocks_of(type_name)
        if not found:
            self.skipTest(f"{type_name}: not in any fixture yet. " + HELP)
        for name, doc, b in found:
            with self.subTest(fixture=name, block=b["id"]):
                self.assertTrue(b["energy_read"], f"{type_name} {b['id']}: RECIPES read no energy node; Output children: {b.get('output_children')}")
                recipe = R.recipe_for(type_name)
                listed = {n for _, _, nodes, _ in recipe["energy"] for n in nodes}
                for e in b["energy_read"]:
                    self.assertIn(e["path"].rsplit("\\", 1)[-1], listed)
                kinds = {e["kind"] for e in b["energy_read"]}
                self.assertEqual(kinds, {k for k, *_ in recipe["energy"]})
    test.__name__ = f"test_{type_name.lower()}_energy_node_path"
    return test


for _t in V.TARGET_TYPES:
    setattr(LiveNodeFixtures, f"test_{_t.lower()}_energy_node_path", _make_type_test(_t))


class LiveWorkSign(unittest.TestCase):
    def test_compressor_work_is_positive(self):
        sign = [(n, b) for n, _, b in blocks_of("Compr") + blocks_of("MCompr") if (b.get("work_sign") or {}).get("kind") == "compressor"]
        if not sign:
            self.skipTest("no compressor with a pressure rise in a fixture yet. " + HELP)
        for name, b in sign:
            with self.subTest(fixture=name, block=b["id"]):
                self.assertEqual(b["work_sign"]["verdict"], "consistent", b["work_sign"])
                self.assertGreater(b["work_sign"]["work"]["value"], 0)

    def test_turbine_work_is_negative(self):
        sign = [(n, b) for n, _, b in blocks_of("Compr") + blocks_of("MCompr") if (b.get("work_sign") or {}).get("kind") == "turbine"]
        if not sign:
            self.skipTest("no turbine (Compr with outlet pressure below inlet) in a fixture yet: " + HELP)
        for name, b in sign:
            with self.subTest(fixture=name, block=b["id"]):
                self.assertEqual(b["work_sign"]["verdict"], "consistent", b["work_sign"])
                self.assertLess(b["work_sign"]["work"]["value"], 0)


if __name__ == "__main__":
    unittest.main()
