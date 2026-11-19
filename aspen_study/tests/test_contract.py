import json
import unittest

from aspen_study.schema_check import SCHEMA_DIR, errors, load_schema, validate
from aspen_study.factors import LIBRARY, load_library
from .helpers import FIXTURES, fixture


class ContractTests(unittest.TestCase):
    def test_all_schemas_are_json_with_ids(self):
        names = sorted(p.name for p in SCHEMA_DIR.glob("*.schema.json"))
        self.assertEqual(names, ["case.schema.json", "factor-library.schema.json", "graph.schema.json",
                                 "manifest.schema.json", "results.schema.json", "roles.schema.json"])
        for n in names:
            self.assertTrue(load_schema(n)["$id"].startswith("aspen-study/2/"))

    def test_graph_fixtures_validate(self):
        for p in FIXTURES.glob("*.graph.json"):
            validate(json.loads(p.read_text(encoding="utf-8")), "graph")

    def test_validator_reports_violations(self):
        g = fixture("htl.graph.json")
        g["blocks"][0]["id"] = "BOUNDARY"
        g["streams"][0]["class"] = "FLUID"
        g["extra"] = 1
        del g["status"]
        found = " ".join(errors(g, load_schema("graph")))
        for text in ("forbidden", "must be one of ['MATERIAL'", "unexpected property 'extra'", "missing required 'status'"):
            self.assertIn(text, found)

    def test_manifest_paths_must_be_relative(self):
        schema = load_schema("manifest")
        rel = {"$ref": "#/$defs/relpath"}
        for bad in ("../x.json", "/abs.json", "C:/x.json", "a/../../b.json"):
            self.assertTrue(errors(bad, rel, schema), bad)
        self.assertFalse(errors("results/case-1.json", rel, schema))

    def test_results_schema_has_agreed_viz_fields(self):
        case = load_schema("results")["properties"]["cases"]["items"]
        for f in ("energy_edges", "internal_loops", "balance", "completeness", "case_params", "gates"):
            self.assertIn(f, case["required"])
        contrib = load_schema("results")["properties"]["contributions"]["items"]["properties"]
        for f in ("case", "category", "item", "value", "unit", "factor_id", "proxy", "value_low", "value_high"):
            self.assertIn(f, contrib)
        m = load_schema("manifest")["properties"]["cases"]["items"]
        for f in ("case_params", "kpi", "completeness"):
            self.assertIn(f, m["required"])
        self.assertNotIn("energy_edges", m["properties"])


class FactorLibraryTests(unittest.TestCase):
    def test_library_has_no_invented_values(self):
        entries = load_library()
        raw = LIBRARY.read_text(encoding="utf-8")
        self.assertNotIn("0.5703", raw)
        for e in entries:
            if e["status"] == "verified":
                self.assertTrue(e["source"] and e["year"] and e["value"] is not None, e["id"])
            else:
                self.assertIsNone(e["value"], e["id"])
        elec = [e for e in entries if e["match"].get("utility") == "electricity"]
        self.assertTrue(elec and all(e["value"] is None for e in elec))

    def test_match_priority(self):
        from aspen_study.factors import match
        entries = load_library()
        self.assertEqual(match(entries, {"utility": "electricity", "region": "CN"}, "GWP100")["id"], "elec-grid-CN")
        self.assertEqual(match(entries, {"utility": "electricity", "region": "DE"}, "GWP100")["id"], "elec-grid-generic")
        self.assertIsNone(match(entries, {"cas": "124-38-9", "flow": "emission_air"}, "GWP100"),
                          "CO2 without declared carbon origin must not match a fossil or biogenic factor")
