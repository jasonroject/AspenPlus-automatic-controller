"""Independent adapter regressions; mocked workers never start Aspen/COM."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from process_pipeline.adapter import run_document
from process_pipeline.normalize import normalize_capture
from process_pipeline.profile import canonical_hash
from process_pipeline.runner import scan
from process_pipeline.tests.test_profiles import FakeDocument, fixture


class BackendReviewTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source = self.root / "synthetic.bkp"
        self.source.write_bytes(b"Offline test file, never open with Aspen")
        self.profile, self.plan, self.raw = fixture(self.source)

    def tearDown(self):
        self.temporary.cleanup()

    def _batch(self, first, missing_first=False):
        plan = deepcopy(self.plan)
        plan["points"].append({"id": "case-b", "parameters": {"temperature": 330}, "split": "holdout"})
        calls = []

        def worker(command, **kwargs):
            point_path = Path(command[command.index("--point") + 1])
            point = json.loads(point_path.read_text(encoding="utf-8"))
            calls.append(point["id"])
            if not (missing_first and len(calls) == 1):
                raw = deepcopy(self.raw)
                raw.update(case_id=point["id"], parameters=point["parameters"], split=point["split"],
                           private_document_closed=True, source_unchanged=True,
                           control_succeeded=False, solver_accepted=False,
                           error="Synthetic ordinary solver failure")
                if len(calls) == 1:
                    raw.update(first)
                (point_path.parent / "raw.json").write_text(json.dumps(raw), encoding="utf-8")
            return SimpleNamespace(returncode=0)

        with patch("process_pipeline.runner.subprocess.run", side_effect=worker):
            ledger = scan(self.profile, plan, self.root / "scan")
        return calls, ledger

    def test_soft_timeout_stops_remaining_plan_even_after_close(self):
        calls, ledger = self._batch({"timed_out": True, "error": "Declared timeout; Stop requested"})
        self.assertEqual(calls, ["case-a"])
        self.assertFalse(ledger["cases"][1]["attempted"])
        self.assertTrue(ledger["all_planned_cases_retained"])

    def test_ordinary_solver_failure_with_confirmed_close_may_continue(self):
        calls, ledger = self._batch({})
        self.assertEqual(calls, ["case-a", "case-b"])
        self.assertEqual(ledger["failed_count"], 2)
        self.assertTrue(ledger["all_planned_cases_retained"])

    def test_missing_raw_record_stops_even_if_worker_exit_code_is_zero(self):
        calls, ledger = self._batch({}, missing_first=True)
        self.assertEqual(calls, ["case-a"])
        self.assertFalse(ledger["cases"][1]["attempted"])

    def test_unknown_cleanup_stops_remaining_native_plan(self):
        calls, ledger = self._batch({"private_document_closed": None})
        self.assertEqual(calls, ["case-a"])
        self.assertFalse(ledger["cases"][1]["attempted"])

    def test_timeout_flag_survives_stop_exception(self):
        document = FakeDocument(self.profile, self.raw)
        document.Engine.IsRunning = True
        document.Engine.Stop = lambda: (_ for _ in ()).throw(RuntimeError("Synthetic Stop failure"))
        with patch("process_pipeline.adapter.time.monotonic", side_effect=[0, 2, 3]):
            raw = run_document(document, self.profile, self.plan["points"][0], poll_seconds=0)
        self.assertTrue(raw.get("timed_out"), raw)
        self.assertFalse(raw["control_succeeded"])

    def test_capture_declared_profile_hash_must_match(self):
        self.raw["profile_sha256"] = canonical_hash(self.profile)
        normalize_capture(self.profile, self.raw)
        changed = deepcopy(self.profile)
        changed["mapping"]["factors"][0]["value"] = .75
        with self.assertRaisesRegex(ValueError, "profile|identity|hash"):
            normalize_capture(changed, self.raw)

    def test_declared_readout_is_required_even_if_not_used_by_mapping(self):
        self.profile["readouts"].append({"id": "diagnostic", "path": r"\Data\Blocks\H\Output\UNUSED", "native_unit": "kW"})
        self.raw["readouts"]["diagnostic"] = {"path": r"\Data\Blocks\H\Output\UNUSED", "unit": "kW", "value": None, "error": "Unavailable declared diagnostic"}
        with self.assertRaisesRegex(ValueError, "readout|Readout|finite|diagnostic"):
            normalize_capture(self.profile, self.raw)


if __name__ == "__main__":
    unittest.main()
