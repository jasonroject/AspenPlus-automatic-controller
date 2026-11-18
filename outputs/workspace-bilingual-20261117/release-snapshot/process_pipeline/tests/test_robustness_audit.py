"""Independent arithmetic and malformed-request audit; no Aspen/COM execution."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from process_pipeline.profile import canonical_hash
from process_pipeline.robustness import analyze_robustness
from process_pipeline.surrogate import SurrogateError, _x, fit
from process_pipeline.test_surrogate import acceptance_config, dataset_fixture


def design():
    return {
        "config_version": 1,
        "candidates": [{"id": name, "inputs": {"x": value, "y": 0.}}
                       for name, value in [("left", -.5), ("middle", 0.), ("right", .5)]],
        "perturbations": {"x": {"unit": "1", "halfwidth": .5},
                          "y": {"unit": "1", "halfwidth": 0.}},
        "scenarios": [{"id": name, "offsets": {"x": value, "y": 0.}}
                      for name, value in [("lower", -1.), ("center", 0.), ("upper", 1.)]],
        "preferences": [{"id": "mixed", "weights": {"energy": 1., "signed_heat": 1., "zero_impact": 2.}}]
    }


def linear_outputs(state, values):
    _x(state, values)  # Keep declared-domain and actual training-hull checks.
    return {"energy": 1., "signed_heat": values["x"], "zero_impact": 0.}


class RobustnessIndependentAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundle = fit(dataset_fixture("offline_fixture"), acceptance_config())

    def test_fixed_nominal_anchors_shared_offsets_and_partial_ties_match_hand_arithmetic(self):
        config = design()
        original_bundle, original_config = deepcopy(self.bundle), deepcopy(config)
        with patch("process_pipeline.surrogate._mean", side_effect=linear_outputs):
            result = analyze_robustness(self.bundle, config, True)
        self.assertTrue(result["rank_complete"])
        self.assertEqual(result["nominal_anchors"]["signed_heat"]["min"], -.5)
        self.assertEqual(result["nominal_anchors"]["signed_heat"]["max"], .5)
        ranking = result["preferences"][0]
        scenarios = {row["id"]: row for row in ranking["scenarios"]}
        self.assertEqual(scenarios["center"]["scores"], {"left": .625, "middle": .5, "right": .375})
        self.assertEqual(scenarios["lower"]["scores"], {"left": .625, "middle": .625, "right": .5})
        self.assertEqual(scenarios["lower"]["ranks"], {"left": 1.5, "middle": 1.5, "right": 3.})
        self.assertEqual(scenarios["upper"]["ranks"], {"left": 1., "middle": 2.5, "right": 2.5})
        candidates = {row["id"]: row for row in ranking["candidates"]}
        self.assertAlmostEqual(candidates["left"]["top_share_pct"], 250/3)
        self.assertAlmostEqual(candidates["middle"]["top_share_pct"], 50/3)
        self.assertEqual(candidates["right"]["top_share_pct"], 0.)
        self.assertAlmostEqual(ranking["total_top_share_pct"], 100.)
        queries = {(row["candidate_id"], row["scenario_id"]): row for row in result["records"]}
        for candidate in config["candidates"]:
            self.assertEqual(queries[(candidate["id"], "upper")]["inputs"]["x"] - candidate["inputs"]["x"], .5)
            self.assertEqual(queries[(candidate["id"], "lower")]["inputs"]["x"] - candidate["inputs"]["x"], -.5)
        middle = next(row for row in result["candidates"] if row["id"] == "middle")
        self.assertEqual((middle["metrics"]["signed_heat"]["min"], middle["metrics"]["signed_heat"]["nominal"], middle["metrics"]["signed_heat"]["max"]), (-.5, 0., .5))
        self.assertIsNone(middle["metrics"]["signed_heat"]["relative_span_pct"])
        self.assertEqual(middle["metrics"]["signed_heat"]["relative_span_reason"], "zero_nominal_denominator")
        self.assertEqual(self.bundle, original_bundle)
        self.assertEqual(config, original_config)
        self.assertEqual(result["config_sha256"], canonical_hash(result["config"]))
        digest = result.pop("result_sha256")
        self.assertEqual(digest, canonical_hash(result))

    def test_one_missing_response_preserves_all_queries_and_suppresses_every_preference(self):
        def one_incomplete(state, values):
            outputs = linear_outputs(state, values)
            if values["x"] == -1.:
                del outputs["zero_impact"]
            return outputs
        config = design()
        config["preferences"].append({"id": "signed-only", "weights": {"energy": 0., "signed_heat": 1., "zero_impact": 0.}})
        with patch("process_pipeline.surrogate._mean", side_effect=one_incomplete):
            result = analyze_robustness(self.bundle, config, True)
        self.assertEqual(len(result["records"]), 9)
        self.assertEqual(sum(row["constraints_passed"] for row in result["records"]), 8)
        self.assertFalse(result["rank_complete"])
        self.assertEqual(result["preferences"], [])
        self.assertEqual(result["nominal_anchors"], {})
        self.assertIsNone(result["candidates"][0]["metrics"]["signed_heat"]["min"])
        self.assertTrue(result["candidates"][1]["coverage"]["complete"])
        json.dumps(result, allow_nan=False)

    def test_oversized_json_integers_are_structured_configuration_errors_before_prediction(self):
        changes = [lambda c: c["candidates"][0]["inputs"].update(x=10**400),
                   lambda c: c["perturbations"]["x"].update(halfwidth=10**400),
                   lambda c: c["scenarios"][0]["offsets"].update(x=10**400),
                   lambda c: c["preferences"][0]["weights"].update(energy=10**400)]
        for change in changes:
            config = design(); change(config)
            with patch("process_pipeline.robustness.predict", side_effect=AssertionError("Invalid config must stop before querying")):
                with self.assertRaises(SurrogateError):
                    analyze_robustness(self.bundle, config, True)

    def test_cli_oversized_integer_returns_blocked_json_without_creating_results(self):
        config = design(); config["candidates"][0]["inputs"]["x"] = 10**400
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/"bundle.json").write_text(json.dumps(self.bundle), encoding="utf-8")
            (root/"config.json").write_text(json.dumps(config), encoding="utf-8")
            run = subprocess.run([sys.executable, "-m", "process_pipeline.robustness", str(root/"bundle.json"),
                                  "--config", str(root/"config.json"), "--output", str(root/"result.json"), "--allow-exploratory"],
                                 capture_output=True, text=True)
            self.assertEqual(run.returncode, 2)
            self.assertEqual(json.loads(run.stderr)["status"], "blocked")
            self.assertFalse((root/"result.json").exists())

    def test_finite_inputs_whose_perturbation_overflows_retain_diagnostics_and_finite_json(self):
        config = design(); config["candidates"][0]["inputs"]["x"] = 1e308
        config["perturbations"]["x"]["halfwidth"] = 1e308
        result = analyze_robustness(self.bundle, config, True)
        overflow = next(row for row in result["records"] if row["candidate_id"] == "left" and row["scenario_id"] == "upper")
        self.assertIsNone(overflow["inputs"]["x"])
        self.assertFalse(overflow["constraints_passed"])
        self.assertIn("overflow", " ".join(overflow["errors"]).lower())
        self.assertEqual(len(result["records"]), 9)
        self.assertFalse(result["rank_complete"])
        self.assertEqual(result["preferences"], [])
        json.dumps(result, allow_nan=False)


if __name__ == "__main__":
    unittest.main()
