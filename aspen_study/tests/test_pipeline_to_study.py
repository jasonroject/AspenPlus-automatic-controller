import copy
import hashlib
import json
import unittest
from pathlib import Path

try:
    import jsonschema  # noqa: F401
except ImportError:  # pragma: no cover
    jsonschema = None

from aspen_study import pipeline_to_study as P

ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT / "analysis_web/data/study"
SOURCE = ROOT / "outputs/htl_pipeline/pipeline.json"
OBS = ROOT / "outputs/htl_pipeline/web-observations.json"
SHA = "a" * 64


def mini():
    grid = [{"temperature_C": t, "length_m": l, "target_kg_h": 5.0 + t / 1000, "HR_electricity_kWh": 10.0 + l, "STD_electricity_kWh": 40.0, "CF_STD": 15.0, "CF_HR": 11.0}
            for t in (310.0, 310.5) for l in (5.0, 5.25)]
    pipeline = {"version": "mini-1", "status": "validated_simulator_pilot", "prediction_enabled": True,
                "bounds": {"temperature_C": [310.0, 350.0], "length_m": [5.0, 20.0]}, "basis": {"wet_feed_kg": 100, "duration_h": 1, "pressure_MPa": 25},
                "scope": "mini scope", "accounting": {"fixed_feed_GWP": 50.0, "electricity_beta": 0.7, "scope": "acct scope"},
                "fresh_runs": [{"temperature_C": 325.0, "length_m": 8.5, "completed": True, "accepted": True, "source_sha256": SHA,
                                "warnings": ["Calculations were completed with warnings"], "mass_residual_kg_h": 1e-4}],
                "grid": {"temperature_step_C": 0.5, "length_step_m": 0.25, "rows": grid},
                "robustness": {"samples": 4, "diagnostics": {"STD": {}}, "scenarios": {"STD": [{"temperature_C": 312.0}], "HR": [{"temperature_C": 340.0}]}},
                "limitations": ["a limitation"]}
    row = lambda t, l, **kw: {"temperature_C": t, "length_m": l, "target_kg_h": 5.0, "STD_electricity_kWh": 40.0, "HR_electricity_kWh": 10.0,
                             "CF_STD": 15.0, "CF_HR": 11.0, "split": "train", "source": "native_reference", "source_record": f"raw\\T{int(t)}p00_L{int(l)}p00.json", **kw}
    obs = {"version": 1, "scope": "s", "basis": {}, "sources": [], "rows": [
        row(310.0, 5.0), row(320.0, 6.0, CF_HR=None, HR_electricity_kWh=None),
        {**row(325.0, 8.5), "split": "fresh_verification", "source": "fresh_comparison", "source_record": "0"}]}
    return pipeline, obs


@unittest.skipIf(jsonschema is None, "jsonschema not installed")
class ConverterTests(unittest.TestCase):
    def test_mini_package_is_schema_valid_and_lossless(self):
        pipeline, obs = mini()
        before = copy.deepcopy((pipeline, obs))
        files = P.convert(pipeline, obs)
        self.assertEqual((pipeline, obs), before, "inputs must not be mutated")
        self.assertEqual(P.reassemble(files), before)
        ids = [c["id"] for c in files["manifest.json"]["cases"]]
        self.assertEqual(ids, ["T310p00_L5p00", "T320p00_L6p00", "fresh_T325p00_L8p50"])
        self.assertEqual(files["manifest.json"]["model"]["sha256"], SHA)

    def test_missing_source_values_are_null_not_zero(self):
        files = P.convert(*mini())
        case = files["manifest.json"]["cases"][1]
        self.assertIsNone(case["kpi"]["energy_per_fu"])
        self.assertIsNone(case["kpi"]["gwp_per_fu"])
        self.assertFalse(case["completeness"]["GWP_HR"]["complete"])
        self.assertTrue(case["completeness"]["GWP_STD"]["complete"])
        result = files["results/T320p00_L6p00.json"]["cases"][0]
        self.assertIsNone(result["completeness"]["GWP_HR"]["total"])
        self.assertNotIn("electricity_HR", result["energy"]["by_utility"])
        for key in ("energy_edges", "internal_loops", "balance"):
            self.assertEqual(result[key], [])
        self.assertIsNone(files["manifest.json"]["cases"][0]["kpi"]["max_balance_ratio"])

    def test_gates_only_pass_with_evidence(self):
        files = P.convert(*mini())
        plain = {g["id"]: g["status"] for g in files["results/T310p00_L5p00.json"]["cases"][0]["gates"]}
        self.assertEqual(set(plain.values()), {"not_run"})
        fresh = files["results/fresh_T325p00_L8p50.json"]["cases"][0]
        gates = {g["id"]: g for g in fresh["gates"]}
        self.assertEqual(fresh["status"], "accepted_with_warnings")
        self.assertEqual((gates["G0_identity"]["status"], gates["G1_converged"]["status"], gates["G1_warnings"]["status"]), ("pass", "pass", "warn"))
        self.assertEqual(gates["G3_balance"]["status"], "not_run")

    def test_kpi_derivation(self):
        kpi = P.convert(*mini())["manifest.json"]["cases"][0]["kpi"]
        self.assertAlmostEqual(kpi["energy_per_fu"], 10.0 / 5.0)         # HR kWh / (kg target per h) at 1 h basis
        self.assertAlmostEqual(kpi["energy_per_fu_STD"], 40.0 / 5.0)
        self.assertAlmostEqual(kpi["efficiency"], 5.0 / 100)
        self.assertEqual(kpi["gwp_per_fu"], 11.0)

    def test_schema_violations_are_reported(self):
        files = P.convert(*mini())
        bad = copy.deepcopy(files)
        bad["manifest.json"]["cases"][0]["file"] = "../escape.json"
        with self.assertRaises(ValueError):
            P.check(bad)
        bad = copy.deepcopy(files)
        bad["results/T310p00_L5p00.json"]["cases"][0]["energy_edges"] = [{"source": "a", "target": "b", "value": -1, "unit": "kW", "kind": "utility"}]
        with self.assertRaises(ValueError):
            P.check(bad)

    def test_ambiguous_model_hash_is_rejected(self):
        pipeline, obs = mini()
        pipeline["fresh_runs"].append({**pipeline["fresh_runs"][0], "source_sha256": "b" * 64})
        with self.assertRaises(ValueError):
            P.convert(pipeline, obs)

    def test_duplicate_case_ids_are_rejected(self):
        pipeline, obs = mini()
        obs["rows"].append(copy.deepcopy(obs["rows"][0]))
        with self.assertRaises(ValueError):
            P.convert(pipeline, obs)


@unittest.skipIf(jsonschema is None, "jsonschema not installed")
class PublishedPackageTests(unittest.TestCase):
    def test_published_package_validates_and_hashes_match(self):
        files = P.read(STUDY)
        P.check(files)
        for case in files["manifest.json"]["cases"]:
            data = (STUDY / case["file"]).read_bytes()
            self.assertEqual((case["bytes"], case["sha256"]), (len(data), hashlib.sha256(data).hexdigest()))
        self.assertFalse((ROOT / "analysis_web/data/pipeline.json").exists())

    @unittest.skipUnless(SOURCE.exists() and OBS.exists(), "pipeline sources are local to the repo checkout")
    def test_published_package_is_current_and_lossless(self):
        pipeline, obs = json.loads(SOURCE.read_text(encoding="utf-8")), json.loads(OBS.read_text(encoding="utf-8"))
        published = P.read(STUDY)
        self.assertEqual(P.reassemble(published), (pipeline, obs))
        fresh = P.convert(pipeline, obs)
        for path, value in fresh.items():
            if path != "manifest.json":
                self.assertEqual(published[path], json.loads(P.dumps(value)), f"{path} is stale: rerun python -m aspen_study.pipeline_to_study")
        self.assertEqual({c["id"] for c in published["manifest.json"]["cases"]}, {c["id"] for c in fresh["manifest.json"]["cases"]})


class StdlibValidatorAgreement(unittest.TestCase):
    """The repo's own stdlib validator must accept the same files (no jsonschema needed in CI)."""
    def test_stdlib_validator_accepts_published_files(self):
        from aspen_study.schema_check import validate
        manifest = json.loads((STUDY / "manifest.json").read_text(encoding="utf-8"))
        validate(manifest, "manifest")
        for case in manifest["cases"]:
            validate(json.loads((STUDY / case["result"]).read_text(encoding="utf-8")), "results")
            validate(json.loads((STUDY / case["file"]).read_text(encoding="utf-8")), "case")
        validate(json.loads((STUDY / "results/summary.json").read_text(encoding="utf-8")), "results")


if __name__ == "__main__":
    unittest.main()


@unittest.skipIf(jsonschema is None, "jsonschema not installed")
class DisabledPipelineTests(unittest.TestCase):
    """A failed validation gate must still publish a *disabled* artifact (as the old pipeline.json did)."""
    def disabled(self):
        pipeline, obs = mini()
        pipeline.update(prediction_enabled=False, status="validation_failed", robustness=None)
        pipeline["grid"]["rows"] = []
        return pipeline, obs

    def test_disabled_pipeline_round_trips_with_empty_grid_and_no_robustness(self):
        pipeline, obs = self.disabled()
        files = P.convert(pipeline, obs)
        self.assertEqual(files["surrogate/grid.json"]["data"], [])
        self.assertEqual(files["manifest.json"]["shards"]["surrogate"], ["surrogate/grid.json"])
        self.assertEqual(P.reassemble(files), (pipeline, obs))
        self.assertFalse(files["meta.json"]["prediction_enabled"])

    def test_without_a_source_model_hash_nothing_is_published(self):
        pipeline, obs = self.disabled()
        pipeline["fresh_runs"] = [{"accepted": True}] * 3
        with self.assertRaises(ValueError):
            P.convert(pipeline, obs)
