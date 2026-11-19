import json
import unittest

from aspen_study.schema_check import SCHEMA_DIR, errors, load_schema, validate
from aspen_study.factors import LIBRARY, load_library
from .helpers import FIXTURES, fixture


class ContractTests(unittest.TestCase):
    def test_all_schemas_are_json_with_ids(self):
        names = sorted(p.name for p in SCHEMA_DIR.glob("*.schema.json"))
        self.assertEqual(names, ["case.schema.json", "factor-library.schema.json", "factors-snapshot.schema.json",
                                 "graph.schema.json", "manifest.schema.json", "results.schema.json", "roles.schema.json",
                                 "surrogate.schema.json"])
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
        for f in ("case_params", "kpi", "completeness", "scenario", "has_results"):
            self.assertIn(f, m["required"])
        self.assertNotIn("file", m["required"])
        self.assertNotIn("energy_edges", m["properties"])


def surrogate_manifest():
    """Shape of a surrogate-only study (like Coding's HTL split): no Aspen file, grids separate."""
    return {"schema": "aspen-study/2", "study_id": "htl-pilot-20261117",
            "model": {"simulator": "Aspen Plus", "version": None, "source_sha256": "a" * 64},
            "contract": {"project_schema": 1, "results_schema": "aspen-results/1"},
            "scenarios": [{"id": "HR", "label": "热回收"}, {"id": "STD", "label": "无热回收"}], "default_scenario": "HR",
            "cases": [
                {"id": "T310_L13", "scenario": "HR", "has_results": True, "file": "cases/T310_L13.json", "result": "results/T310_L13.json", "source": "archived",
                 "split": "train", "source_record": "T310p00_L13p00", "evidence": [{"kind": "gate", "file": "results/T310_L13.json"}],
                 "case_params": {"temperature_C": 310, "length_m": 13}, "kpi": {"energy_per_fu": 2.06, "gwp_per_fu": 11.44, "max_balance_ratio": None},
                 "completeness": {"GWP100": {"status": "unknown", "complete": False, "contribution_coverage": None, "missing_count": 0, "lower_bound": None, "total": 11.44}}},
                {"id": "T310_L13", "scenario": "STD", "has_results": False, "source": "surrogate", "split": "fresh",
                 "evidence": [{"kind": "observation", "file": "observations.json", "sha256": "b" * 64}],
                 "case_params": {"temperature_C": 310, "length_m": 13}, "kpi": {"energy_per_fu": 8.9, "gwp_per_fu": None, "max_balance_ratio": None},
                 "completeness": {"GWP100": {"status": "unknown", "complete": False, "contribution_coverage": None, "missing_count": 0, "lower_bound": None}}}],
            "shards": {"factors": "factors.json", "surrogate": "surrogate/surrogate.json"}}


class ManifestRuleTests(unittest.TestCase):
    def test_surrogate_only_manifest_is_valid(self):
        validate(surrogate_manifest(), "manifest")

    def test_rules(self):
        cases = {
            "has_results=false must not reference": lambda m: m["cases"][1].update(file="cases/x.json"),
            "has_results=true requires the five-table file": lambda m: m["cases"][0].pop("file"),
            "must not carry total": lambda m: m["cases"][0]["completeness"]["GWP100"].update(status="incomplete", missing_count=2),
            "kpi.gwp_per_fu must be null": lambda m: m["cases"][0]["completeness"]["GWP100"].update(status="incomplete", missing_count=2, total=None),
            "split": lambda m: m["cases"][0].update(split="holdout"),
            "give sha256": lambda m: m["model"].pop("source_sha256"),
            "duplicate case identity": lambda m: m["cases"][1].update(scenario="HR", has_results=False),
            "scenario not declared": lambda m: m["cases"][1].update(scenario="LOW"),
            "scenario-suffixed field": lambda m: m["cases"][0]["kpi"].update(gwp_per_fu_STD=1.0),
            "must be 'unknown'": lambda m: m["cases"][0]["completeness"]["GWP100"].update(status="complete", complete=True),
            "default_scenario must be": lambda m: m.update(default_scenario="X"),
        }
        for text, mutate in cases.items():
            m = surrogate_manifest()
            mutate(m)
            with self.assertRaises(ValueError, msg=text) as ctx:
                validate(m, "manifest")
            self.assertIn(text, str(ctx.exception))

    def test_results_allocation_may_be_null_with_note(self):
        res = {"schema": "aspen-results/1", "study_id": "x",
               "method": {"functional_unit": "1 kg", "system_boundary": "gate-to-gate", "allocation": None,
                          "allocation_note": "single product; archived study did not declare allocation", "factor_sources": []},
               "cases": [], "contributions": []}
        validate(res, "results")

    def test_legacy_surrogate_array_still_accepted(self):
        m = surrogate_manifest()
        m["shards"]["surrogate"] = ["surrogate/grid.json"]
        validate(m, "manifest")

    def test_surrogate_and_snapshot_schemas(self):
        validate({"schema": "aspen-surrogate/1", "model_type": "GaussianProcessRegressor (RBF/Matern52 by CV)",
                  "prediction_enabled": True, "inputs": [{"id": "temperature_C", "unit": "C", "min": 310, "max": 350}],
                  "targets": [{"id": "energy_per_fu", "unit": "kWh/kg", "scenario": "HR"}],
                  "split": {"method": "fixed", "training": 100, "holdout": 18, "verification": 3},
                  "metrics": {"holdout": {"energy_per_fu": {"median_APE_pct": 0.5}}},
                  "data_source": {"description": "121 native reference runs", "reference_count": 121},
                  "grid_files": ["surrogate/grid.json"]}, "surrogate")
        with self.assertRaises(ValueError):
            validate({"schema": "aspen-factors-snapshot/1", "study_id": "x",
                      "factors": [{"id": "f", "category": "GWP100", "value": None, "unit": "kWh", "impact_unit": "kg CO2-eq",
                                   "source": "s", "year": 2021}]}, "factors-snapshot")


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
