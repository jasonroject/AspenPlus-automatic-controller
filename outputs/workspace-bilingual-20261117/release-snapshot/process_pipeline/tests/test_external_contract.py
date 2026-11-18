"""Independent offline recycle-process contract checks. No Aspen/COM run occurs.

Hand arithmetic: 10 kg/h feed plus 4 kg/h internal recycle enters a filter.
The filter exports 10 kg/h product carrier and 4 kg/h retentate. The latter
cools before recycling. H rates are feed=0, mix=3, carrier=9, retentate=6,
recycle=3 kW; Q_filter=10 kW, W_filter=2 kW, Q_cooler=-3 kW.
Thus boundary energy is 9 - 0 - (10 + 2 - 3) = 0, and mass is 10 - 10 = 0.
The declared target is 3 kg/h. Purchased heat+work intensity=(10+2)/3=4.
Illustrative climate=(36*.1 + 2*.6 + 10*.2)/3=6.8/3.
Illustrative acidification=(36*.002 + 2*.02 + 10*.004)/3=.152/3.
Factors are arithmetic fixtures, not environmental database evidence.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from process_pipeline.adapter import capture_readouts, check_solver
from process_pipeline.normalize import normalize_capture
from process_pipeline.profile import canonical_hash, validate_profile, validate_plan
from process_pipeline.runner import replay


ROOT = Path(__file__).resolve().parents[1]
SOURCE = "Offline membrane-recycle arithmetic fixture; not Aspen simulation or measured data"


def fixture():
    """Build a named external topology with explicit captured quantities/units."""
    definitions = {}

    def readout(ident, path, value, unit):
        definitions[ident] = {"id": ident, "path": path, "native_unit": unit, "fixture_value": value}
        return {"readout": ident}

    def stream(ident, origin, destination, mass, mass_unit, enthalpy):
        prefix = f"\\Data\\Streams\\{ident}\\Output\\"
        return {"id": ident, "from": origin, "to": destination,
                "mass": readout(ident + "-mass", prefix + "MASSFLMX", mass, mass_unit),
                "enthalpy": readout(ident + "-enthalpy", prefix + "H_FLOW", enthalpy, "MJ/h")}

    zero = {"constant": 0, "unit": "kW", "source": "Explicitly unpowered/adiabatic fixture equipment"}
    streams = [stream("FEED", "BOUNDARY", "MIXER", 10, "kg/hr", 0),
               stream("MIXED", "MIXER", "FILTER", 14, "kg/hr", 10.8),
               stream("CARRIER", "FILTER", "BOUNDARY", 10, "kg/hr", 32.4),
               stream("RETENTATE", "FILTER", "COOLER", 4, "kg/hr", 21.6),
               stream("RECYCLE", "COOLER", "MIXER", 4 / 3600, "kg/s", 10.8)]
    heat = readout("filter-heat", "\\Data\\Blocks\\FILTER\\Output\\QCALC", 10000 / 4.184, "cal/sec")
    work = readout("filter-work", "\\Data\\Blocks\\FILTER\\Output\\WNET", 2, "kW")
    cooling = readout("cooler-heat", "\\Data\\Blocks\\COOLER\\Output\\QCALC", -10.8, "MJ/h")
    target = readout("target-mass", "\\Data\\Streams\\CARRIER\\Output\\MASSFLOW\\MIXED\\TARGET", 3, "kg/hr")
    factors = []
    for category, unit, values in [("Fixture climate", "kg CO2-eq", (.1, .6, .2)),
                                    ("Fixture acidification", "mol H+-eq", (.002, .02, .004))]:
        for ident, denominator, value in zip(("heat", "electricity", "feed"), ("MJ", "kWh", "kg"), values):
            factors.append({"id": ident, "category": category, "value": value,
                            "denominator_unit": denominator, "impact_unit": unit,
                            "method": "Independent fixture arithmetic v1", "source": SOURCE})
    profile = {
        "profile_version": 1, "id": "external-membrane-recycle", "name": "Offline membrane recycle contract",
        "model": {"path": "offline-membrane-fixture.bkp", "sha256": hashlib.sha256(SOURCE.encode()).hexdigest()},
        "variables": [{"id": "pressure", "path": "\\Data\\Blocks\\FILTER\\Input\\PRES", "native_unit": "bar", "min": 1, "max": 4}],
        "readouts": [{k: v for k, v in row.items() if k != "fixture_value"} for row in definitions.values()],
        "solver_checks": [{"path": "\\Data\\Results Summary\\Run-Status\\Output\\CVSTAT", "accepted_values": [0], "label": "Offline fixture status only"}],
        "mapping": {
            "meta": {"name": "Independent membrane recycle", "steady_state": True,
                     "enthalpy_basis": "Shared signed enthalpy reference; all material flows; Q/W inward positive",
                     "boundary": "Declared feed supply, purchased heating and motor electricity; cooling-service upstream burden excluded",
                     "functional_unit": "1 kg declared target product", "allocation_method": "No co-product allocation; share 1",
                     "calorie_J": 4.184, "inventory_complete": True, "comparable_cases": True},
            "product": {"quantity": target, "feed": {"readout": "FEED-mass"}, "allocation": 1, "source": SOURCE},
            "streams": streams,
            "blocks": [{"id": "MIXER", "heat": deepcopy(zero), "power": deepcopy(zero), "source": SOURCE},
                       {"id": "FILTER", "heat": heat, "power": work, "source": SOURCE},
                       {"id": "COOLER", "heat": cooling, "power": deepcopy(zero), "source": SOURCE}],
            "inventory": [{"id": "purchased-heat", "name": "External heating", "kind": "energy", "quantity": heat, "factor_id": "heat", "source": SOURCE},
                          {"id": "motor-electricity", "name": "Motor electricity", "kind": "energy", "quantity": work, "factor_id": "electricity", "source": SOURCE},
                          {"id": "external-feed", "name": "External feed", "kind": "material", "quantity": {"readout": "FEED-mass"}, "factor_id": "feed", "source": SOURCE}],
            "factors": factors,
        },
        "limits": {"max_cases": 12, "timeout_seconds": 5},
    }
    point = {"id": "EXT-001", "parameters": {"pressure": 2}, "split": "verification"}
    plan = {"plan_version": 1, "profile_id": profile["id"], "model_sha256": profile["model"]["sha256"], "points": [point]}
    nodes = {row["path"]: SimpleNamespace(Value=row["fixture_value"], UnitString=row["native_unit"]) for row in definitions.values()}
    nodes[profile["solver_checks"][0]["path"]] = SimpleNamespace(Value=0, UnitString="")
    document = SimpleNamespace(Tree=SimpleNamespace(FindNode=nodes.get))
    accepted, solver_records = check_solver(document, profile["solver_checks"])
    raw = {"capture_version": 1, "profile_id": profile["id"], "profile_sha256": canonical_hash(profile),
           "model_sha256": profile["model"]["sha256"], "case_id": point["id"], "split": point["split"],
           "parameters": deepcopy(point["parameters"]), "control_succeeded": True, "solver_accepted": accepted,
           "solver_checks": solver_records, "readouts": capture_readouts(document, profile["readouts"]),
           "input_readback_after_run": {"pressure": {"path": profile["variables"][0]["path"], "unit": "bar", "value": 2}},
           "warnings": [SOURCE], "evidence_type": "offline_fixture", "physical_validation": False}
    return profile, plan, raw, document


def assess(project):
    with TemporaryDirectory(prefix="process-contract-") as temporary:
        directory = Path(temporary)
        input_path, output_path = directory / "project.json", directory / "assessment.json"
        input_path.write_text(json.dumps(project), encoding="utf-8")
        process = subprocess.run(["node", str(ROOT / "assess_project.mjs"), str(input_path), str(output_path)],
                                 check=False, text=True, capture_output=True, timeout=30)
        if process.returncode:
            raise AssertionError(process.stderr or output_path.read_text(encoding="utf-8"))
        return json.loads(output_path.read_text(encoding="utf-8"))


class ExternalModelContractTests(unittest.TestCase):
    def test_mixed_units_recycle_cancellation_and_two_impact_categories(self):
        profile, plan, raw, _ = fixture()
        validate_profile(profile); validate_plan(plan, profile)
        before = deepcopy(raw)
        project = normalize_capture(profile, raw)
        self.assertEqual(project["cases"][0]["id"], "EXT-001")
        self.assertEqual(project["meta"]["evidence_type"], "offline_fixture")
        self.assertFalse(project["meta"]["physical_validation"])
        self.assertEqual(next(b for b in project["blocks"] if b["id"] == "FILTER")["heat_unit"], "cal/sec")
        self.assertEqual(next(s for s in project["streams"] if s["id"] == "RECYCLE")["mass_unit"], "kg/s")
        result = assess(project); case = result["cases"][0]; balance = result["report"]["results"][0]["balance"]
        self.assertTrue(case["numerical_closure"]); self.assertTrue(case["lcia_complete"])
        self.assertAlmostEqual(balance["total"]["mass_residual_kg_h"], 0)
        self.assertAlmostEqual(balance["total"]["energy_residual_kW"], 0)
        self.assertAlmostEqual(balance["total"]["external_heat_in_kW"], 10)
        self.assertAlmostEqual(balance["total"]["external_heat_out_kW"], 3)
        self.assertAlmostEqual(case["metrics"]["purchased_energy_kWh_kg"], 4)
        self.assertAlmostEqual(case["metrics"]["yield_fraction"], .3)
        self.assertAlmostEqual(case["metrics"]["impacts"]["Fixture climate"]["value"], 6.8 / 3)
        self.assertAlmostEqual(case["metrics"]["impacts"]["Fixture acidification"]["value"], .152 / 3)
        self.assertEqual(raw, before)
        self.assertNotIn("RECYCLE", {row["id"] for row in project["inventory"]})

    def test_replay_keeps_valid_missing_node_and_unsupplied_cases_without_running_aspen(self):
        profile, plan, good, document = fixture()
        second = {"id": "EXT-002", "parameters": {"pressure": 2}, "split": "holdout"}
        third = {"id": "EXT-003", "parameters": {"pressure": 2}, "split": "training"}
        plan["points"] += [second, third]
        bad = deepcopy(good); bad.update(case_id=second["id"], split=second["split"])
        original_find = document.Tree.FindNode
        missing_path = next(row["path"] for row in profile["readouts"] if row["id"] == "filter-work")
        document.Tree.FindNode = lambda path: None if path == missing_path else original_find(path)
        bad["readouts"] = capture_readouts(document, profile["readouts"])
        self.assertIn("error", bad["readouts"]["filter-work"])
        with TemporaryDirectory(prefix="external-replay-") as temporary:
            base = Path(temporary); source = base / "captures.json"
            source.write_text(json.dumps([good, bad]), encoding="utf-8")
            source_before = source.read_bytes()
            with patch("process_pipeline.runner.native_case", side_effect=AssertionError("Replay must not start Aspen")):
                ledger = replay(profile, plan, [good, bad], base / "results", source_file=source)
            self.assertEqual(source.read_bytes(), source_before)
            self.assertEqual(ledger["planned_count"], 3); self.assertEqual(ledger["accepted_count"], 1); self.assertEqual(ledger["failed_count"], 2)
            self.assertTrue(ledger["all_planned_cases_retained"])
            dataset = json.loads((base / "results" / "dataset.json").read_text(encoding="utf-8"))
            self.assertEqual(len(dataset["rows"]), 3); self.assertEqual(dataset["evidence_type"], "offline_fixture")
            self.assertEqual([row["accepted"] for row in dataset["rows"]], [True, False, False])
            combined = json.loads((base / "results" / "project.json").read_text(encoding="utf-8"))
            self.assertEqual(combined["meta"]["omitted_failed_case_ids"], ["EXT-002", "EXT-003"])
            self.assertEqual(combined["meta"]["scan_audit"]["failed"], 2)
            for ident in ("EXT-001", "EXT-002", "EXT-003"):
                self.assertTrue((base / "results" / "runs" / ident / "raw.json").exists())
                self.assertTrue((base / "results" / "runs" / ident / "case-status.json").exists())

    def test_missing_factor_retains_normalized_case_and_diagnostics_without_complete_lca(self):
        profile, plan, raw, _ = fixture()
        profile["mapping"]["factors"] = [row for row in profile["mapping"]["factors"] if not (row["id"] == "heat" and row["category"] == "Fixture climate")]
        # This deliberately incomplete offline profile is a distinct fixture.
        raw["profile_sha256"] = canonical_hash(profile)
        with TemporaryDirectory(prefix="external-factor-") as temporary:
            directory = Path(temporary) / "results"; ledger = replay(profile, plan, [raw], directory)
            case = ledger["cases"][0]
            self.assertFalse(case["accepted"]); self.assertTrue(case["normalization_complete"])
            self.assertTrue(case["gates"]["numerical_closure"]); self.assertFalse(case["gates"]["lcia_complete"])
            self.assertIsNone(case["metrics"]["impacts"]["Fixture climate"]["value"])
            self.assertAlmostEqual(case["metrics"]["impacts"]["Fixture acidification"]["value"], .152 / 3)
            result = json.loads((directory / "runs" / "EXT-001" / "assessment.json").read_text(encoding="utf-8"))
            errors = result["report"]["results"][0]["impacts"][0]["errors"]
            self.assertTrue(any("Missing Fixture climate factor heat" in error for error in errors))
            combined = json.loads((directory / "project.json").read_text(encoding="utf-8"))
            self.assertEqual(len(combined["cases"]), 1)
            self.assertFalse(combined["meta"]["scan_audit"]["cases"][0]["accepted"])

    def test_readout_unit_change_is_not_relabelled_and_native_readback_tolerance_is_consistent(self):
        profile, plan, raw, _ = fixture()
        wrong = deepcopy(raw); wrong["readouts"]["filter-heat"]["unit"] = "kW"
        with self.assertRaisesRegex(ValueError, "path/unit mismatch"):
            normalize_capture(profile, wrong)
        raw["input_readback_after_run"]["pressure"]["value"] = 2 + 1e-10
        with TemporaryDirectory(prefix="external-readback-") as temporary:
            ledger = replay(profile, plan, [raw], Path(temporary) / "results")
            self.assertTrue(ledger["cases"][0]["accepted"], ledger["cases"][0]["error"])

    def test_replayed_external_dataset_fits_only_an_explicit_offline_surrogate(self):
        from process_pipeline.surrogate import fit, predict, SurrogateError
        profile, plan, raw, _ = fixture()
        plan["points"], captures = [], []
        # Constant outputs are intentional hand arithmetic, not response evidence
        # for a membrane model. Distinct coordinates test the real split contract.
        for index, (pressure, split) in enumerate([(1, "training"), (1.5, "training"),
                (2, "training"), (2.5, "training"), (3, "training"), (4, "training"),
                (1.75, "holdout"), (3.25, "holdout")], 1):
            point = {"id": f"EXT-{index:03}", "parameters": {"pressure": pressure}, "split": split}
            captured = deepcopy(raw)
            captured.update(case_id=point["id"], parameters=deepcopy(point["parameters"]), split=split)
            captured["input_readback_after_run"]["pressure"]["value"] = pressure
            plan["points"].append(point); captures.append(captured)
        with TemporaryDirectory(prefix="external-surrogate-") as temporary:
            directory = Path(temporary) / "results"
            ledger = replay(profile, plan, captures, directory)
            self.assertEqual(ledger["accepted_count"], 8)
            dataset = json.loads((directory / "dataset.json").read_text(encoding="utf-8"))
            criteria = {"criteria": {response["id"]: {"unit": response["unit"], "max_mae": 1e-8} for response in dataset["responses"]}}
            bundle = fit(dataset, criteria)
            self.assertEqual(bundle["evidence_type"], "offline_fixture")
            self.assertEqual(bundle["status"], "offline_fixture_demo")
            self.assertTrue(bundle["validation"]["passed"])
            self.assertFalse(bundle["prediction_enabled"])
            self.assertEqual(len(bundle["model"]["training_case_ids"]), 6)
            with self.assertRaises(SurrogateError):
                predict(bundle, [{"pressure": 2.75}])
            predicted = predict(bundle, [{"pressure": 2.75}, {"pressure": 4.1}], allow_exploratory=True)
            self.assertTrue(predicted["exploratory"])
            self.assertTrue(predicted["records"][0]["constraints_passed"])
            self.assertAlmostEqual(predicted["records"][0]["outputs"]["purchased_energy_kWh_kg"], 4)
            self.assertFalse(predicted["records"][1]["constraints_passed"])
            self.assertFalse(predicted["all_queries_supported"])


if __name__ == "__main__":
    unittest.main()
