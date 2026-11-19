import copy
import hashlib
import json
import unittest
from pathlib import Path

from aspen_study import pipeline_to_study as P
from aspen_study.schema_check import validate as repo_validate

ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT / "analysis_web/data/study"
SOURCE = ROOT / "outputs/htl_pipeline/pipeline.json"
OBS = ROOT / "outputs/htl_pipeline/web-observations.json"
SHA = "a" * 64


def mini():
    grid = [{"temperature_C": t, "length_m": l, "target_kg_h": 5.0 + t / 1000, "HR_electricity_kWh": 10.0 + l, "STD_electricity_kWh": 40.0, "CF_STD": 15.0, "CF_HR": 11.0}
            for t in (310.0, 310.5) for l in (5.0, 5.25)]
    metric = {"n": 3, "RMSE": 0.1, "median_APE_pct": 0.2, "p95_APE_pct": 0.3, "max_APE_pct": 0.4}
    pipeline = {"version": "mini-1", "status": "validated_simulator_pilot", "prediction_enabled": True,
                "bounds": {"temperature_C": [310.0, 350.0], "length_m": [5.0, 20.0]}, "basis": {"wet_feed_kg": 100, "duration_h": 1, "pressure_MPa": 25},
                "scope": "mini scope", "accounting": {"fixed_feed_GWP": 50.0, "electricity_beta": 0.7, "scope": "acct scope"},
                "native_reference_count": 121,
                "training": {"models": {"target_kg_h": {"training_count": 90, "kernel": "Matern52"}}, "reference_sha256": SHA,
                             "selection": "Training-only four-fold CV."},
                "validation_coverage": {"holdout": {"expected_in_domain": 10}, "fresh": {"expected_in_domain": 3}},
                "holdout_metrics": {"target_kg_h": metric}, "fresh_metrics": {"target_kg_h": metric},
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


def case(files, cid, scenario="HR"):
    return next(c for c in files["manifest.json"]["cases"] if c["id"] == cid and c["scenario"] == scenario)


class ConverterTests(unittest.TestCase):
    def test_mini_package_is_valid_and_lossless(self):
        pipeline, obs = mini()
        before = copy.deepcopy((pipeline, obs))
        files = P.convert(pipeline, obs)
        self.assertEqual((pipeline, obs), before, "inputs must not be mutated")
        self.assertEqual(P.reassemble(files), before)
        keys = [(c["id"], c["scenario"]) for c in files["manifest.json"]["cases"]]
        self.assertEqual(keys, [(i, s) for i in ("T310p00_L5p00", "T320p00_L6p00", "fresh_T325p00_L8p50") for s in ("HR", "STD")])
        model = files["manifest.json"]["model"]
        self.assertEqual((model["sha256"], model["version"], model["simulator"]), (SHA, None, "Aspen Plus"))
        self.assertEqual(model["source_sha256"], P.canonical_sha256(pipeline))
        self.assertEqual(P.convert(pipeline, obs, source_sha256="c" * 64)["manifest.json"]["model"]["source_sha256"], "c" * 64)

    def test_every_file_passes_the_repo_validator_with_cross_field_rules(self):
        files = P.convert(*mini())
        repo_validate(files["manifest.json"], "manifest")
        repo_validate(files["factors.json"], "factors-snapshot")
        repo_validate(files["surrogate/surrogate.json"], "surrogate")
        for path, value in files.items():
            if path.startswith("results/"):
                repo_validate(value, "results")

    def test_scenarios_are_separate_records_without_suffixed_fields(self):
        files = P.convert(*mini())
        m = files["manifest.json"]
        self.assertEqual([s["id"] for s in m["scenarios"]], ["HR", "STD"])
        self.assertEqual(m["default_scenario"], "HR")
        for c in m["cases"]:
            for section in (c["kpi"], c["case_params"], c["completeness"]):
                self.assertFalse([k for k in section if k.upper().endswith(("_STD", "_HR"))])
        kpi_hr, kpi_std = case(files, "T310p00_L5p00")["kpi"], case(files, "T310p00_L5p00", "STD")["kpi"]
        self.assertEqual((kpi_hr["gwp_per_fu"], kpi_std["gwp_per_fu"]), (11.0, 15.0))
        self.assertAlmostEqual(kpi_hr["energy_per_fu"], 10.0 / 5.0)     # kWh / (kg target per h) at the 1 h basis
        self.assertAlmostEqual(kpi_std["energy_per_fu"], 40.0 / 5.0)
        self.assertAlmostEqual(kpi_hr["efficiency"], 5.0 / 100)

    def test_has_results_only_with_gate_evidence_and_scenario_file_names(self):
        files = P.convert(*mini())
        self.assertTrue(case(files, "fresh_T325p00_L8p50")["has_results"])
        self.assertEqual(case(files, "fresh_T325p00_L8p50")["result"], "results/fresh_T325p00_L8p50.json")
        self.assertEqual(case(files, "fresh_T325p00_L8p50", "STD")["result"], "results/fresh_T325p00_L8p50__STD.json")
        for cid in ("T310p00_L5p00", "T320p00_L6p00"):
            for scenario in ("HR", "STD"):
                c = case(files, cid, scenario)
                self.assertFalse(c["has_results"])
                self.assertNotIn("result", c)
                self.assertNotIn("file", c)
        self.assertFalse([p for p in files if p.startswith("cases/")], "no stub five-table files")
        self.assertEqual(len(files["results/summary.json"]["cases"]), 2)

    def test_completeness_is_unknown_not_complete_for_total_only_gwp(self):
        files = P.convert(*mini())
        for c in files["manifest.json"]["cases"]:
            comp = c["completeness"]["GWP"]
            self.assertEqual((comp["status"], comp["complete"]), ("unknown", False))
            self.assertIsNone(comp["contribution_coverage"])
        rec = files["results/fresh_T325p00_L8p50.json"]["cases"][0]
        self.assertEqual(rec["completeness"]["GWP"]["status"], "unknown")
        self.assertEqual(rec["completeness"]["GWP"]["total"], 11.0)

    def test_missing_source_values_are_null_not_zero(self):
        files = P.convert(*mini())
        c = case(files, "T320p00_L6p00")
        self.assertIsNone(c["kpi"]["energy_per_fu"])
        self.assertIsNone(c["kpi"]["gwp_per_fu"])
        self.assertEqual(case(files, "T320p00_L6p00", "STD")["kpi"]["gwp_per_fu"], 15.0)
        self.assertIsNone(c["kpi"]["max_balance_ratio"])
        rec = files["results/fresh_T325p00_L8p50.json"]["cases"][0]
        for key in ("energy_edges", "internal_loops", "balance"):
            self.assertEqual(rec[key], [])

    def test_gates_only_pass_with_evidence(self):
        files = P.convert(*mini())
        rec = files["results/fresh_T325p00_L8p50.json"]["cases"][0]
        gates = {g["id"]: g for g in rec["gates"]}
        self.assertEqual(rec["status"], "accepted_with_warnings")
        self.assertEqual((gates["G0_identity"]["status"], gates["G1_converged"]["status"], gates["G1_warnings"]["status"]), ("pass", "pass", "warn"))
        for gid in ("G2_completeness", "G3_balance", "G4_roles", "G5_factors"):
            self.assertEqual(gates[gid]["status"], "not_run")
        std = files["results/fresh_T325p00_L8p50__STD.json"]["cases"][0]
        self.assertTrue(any("reconstructed" in w for w in std["warnings"]))

    def test_factor_values_live_in_the_snapshot_and_results_only_reference_ids(self):
        files = P.convert(*mini())
        snapshot = {f["id"]: f for f in files["factors.json"]["factors"]}
        self.assertEqual(snapshot["fixed_feed_GWP"]["value"], 50.0)
        self.assertEqual(snapshot["electricity_beta"]["value"], 0.7)
        method = files["results/summary.json"]["method"]
        self.assertEqual(method["factors_snapshot"], "factors.json")
        self.assertTrue(all("value" not in f for f in method["factor_sources"]))
        self.assertEqual({f["factor_id"] for f in method["factor_sources"]}, set(snapshot))
        self.assertEqual(files["manifest.json"]["shards"]["factors"], "factors.json")

    def test_surrogate_part_is_separate_and_described(self):
        files = P.convert(*mini())
        self.assertEqual(files["manifest.json"]["shards"]["surrogate"], "surrogate/surrogate.json")
        d = files["surrogate/surrogate.json"]
        self.assertEqual(d["grid_files"], ["surrogate/grid.json"])
        self.assertEqual(d["extra_files"], {"details": "surrogate/details.json", "robustness_HR": "surrogate/robustness-HR.json",
                                            "robustness_STD": "surrogate/robustness-STD.json"})
        self.assertEqual([i["id"] for i in d["inputs"]], ["temperature_C", "length_m"])
        self.assertEqual({t["id"] for t in d["targets"] if t.get("scenario") == "STD"}, {"STD_electricity_kWh", "CF_STD"})
        self.assertEqual(d["data_source"]["reference_count"], 121)
        self.assertEqual(d["split"], {"method": "Training-only four-fold CV.", "training": 90, "holdout": 10, "verification": 3})
        self.assertEqual(d["model_type"], "GaussianProcessRegressor (Matern52)")
        self.assertEqual(sorted(d["metrics"]), ["fresh", "holdout"])
        self.assertTrue(d["prediction_enabled"])
        self.assertFalse([k for k in files["manifest.json"]["shards"] if k == "grid"])

    def test_rule_violations_are_rejected(self):
        files = P.convert(*mini())
        for mutate, text in [
            (lambda f: f["manifest.json"]["cases"][0].update(file="cases/x.json"), "has_results=false must not reference"),
            (lambda f: f["manifest.json"]["cases"][0]["kpi"].update(gwp_per_fu_STD=1.0), "scenario-suffixed"),
            (lambda f: f["manifest.json"]["cases"][0]["completeness"]["GWP"].update(status="complete", complete=True), "must be 'unknown'"),
            (lambda f: f["manifest.json"].update(default_scenario="X"), "default_scenario"),
            (lambda f: [f["manifest.json"]["model"].pop(k) for k in ("sha256", "source_sha256")], "give sha256"),
            (lambda f: f["manifest.json"]["cases"][0].update(has_results=True, result="../escape.json"), "result"),
            (lambda f: f["results/fresh_T325p00_L8p50.json"]["cases"][0]["energy_edges"].append(
                {"source": "a", "target": "b", "value": -1, "unit": "kW", "kind": "utility"}), "value"),
        ]:
            bad = copy.deepcopy(files)
            mutate(bad)
            with self.assertRaises(ValueError) as ctx:
                P.check(bad)
            self.assertIn(text, str(ctx.exception))

    def test_unreferenced_or_missing_files_are_rejected(self):
        files = P.convert(*mini())
        extra = copy.deepcopy(files)
        extra["surrogate/stray.json"] = {}
        with self.assertRaises(ValueError):
            P.check(extra)
        gone = copy.deepcopy(files)
        del gone["factors.json"]
        with self.assertRaises(ValueError):
            P.check(gone)

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


class PublishedPackageTests(unittest.TestCase):
    def test_published_package_validates_with_the_repo_validator(self):
        files = P.read(STUDY)
        P.check(files)
        repo_validate(files["manifest.json"], "manifest")
        n = 0
        for path, value in files.items():
            for prefix, name in P.SCHEMA_BY_PATH:
                if path == prefix or (prefix.endswith("/") and path.startswith(prefix)):
                    repo_validate(value, name)
                    n += 1
        self.assertEqual(n, 10)   # manifest, factors, surrogate descriptor, summary + 6 result shards
        self.assertFalse((ROOT / "analysis_web/data/pipeline.json").exists())
        self.assertFalse((STUDY / "cases").exists(), "stub case files are gone")

    @unittest.skipUnless(SOURCE.exists() and OBS.exists(), "pipeline sources are local to the repo checkout")
    def test_published_package_is_current_and_lossless(self):
        raw = SOURCE.read_bytes()
        pipeline, obs = json.loads(raw.decode("utf-8")), json.loads(OBS.read_text(encoding="utf-8"))
        published = P.read(STUDY)
        self.assertEqual(P.reassemble(published), (pipeline, obs))
        fresh = P.convert(pipeline, obs, source_sha256=published["manifest.json"]["model"]["source_sha256"])
        self.assertEqual(set(fresh), set(published))
        for path, value in fresh.items():
            self.assertEqual(published[path], json.loads(P.dumps(value)), f"{path} is stale: rerun python -m aspen_study.pipeline_to_study")
        if b"\r" not in raw:   # CRLF checkouts change the byte hash, not the content
            self.assertEqual(published["manifest.json"]["model"]["source_sha256"], hashlib.sha256(raw).hexdigest())


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
        self.assertEqual(files["surrogate/surrogate.json"]["grid_files"], ["surrogate/grid.json"])
        self.assertFalse(files["surrogate/surrogate.json"]["prediction_enabled"])
        self.assertEqual(files["surrogate/surrogate.json"]["extra_files"], {"details": "surrogate/details.json"})
        self.assertEqual(P.reassemble(files), (pipeline, obs))
        self.assertFalse(files["surrogate/details.json"]["prediction_enabled"])

    def test_without_a_source_model_hash_nothing_is_published(self):
        pipeline, obs = self.disabled()
        pipeline["fresh_runs"] = [{"accepted": True}] * 3
        with self.assertRaises(ValueError):
            P.convert(pipeline, obs)


if __name__ == "__main__":
    unittest.main()
