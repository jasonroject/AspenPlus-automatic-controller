"""Batch runner tests: adapter-driven run (polling/timeout/stop/cleanup), status + per-block messages, units.

No Aspen needed. COM is faked from the real 2026-11-19 probe outputs in aspen_study/tests/fixtures/live/
(heatrecovery.bkp, status 'warning'; mch.bkp, status 'ok'): statuses, messages and energies come from those
files, not from invented numbers.
"""
import csv
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import batch_runner
import run_status
import test_datacatch as datacatch
from aspen_study.adapters.aspen_com import AspenPlusCOMAdapter
from aspen_study.tests.fake_aspen import (FakeDoc, FakeEngine, FakeProcessOps, build_table, heatrecovery_spec,
                                          radfrac_spec)
from batch_runner import BatchRunner, positive_seconds
from result_units import BLOCK_UNITS, STREAM_UNITS, convert_quantity, missing_units

LIVE = Path(__file__).resolve().parent / "aspen_study/tests/fixtures/live"
STATUS = r"\Data\Results Summary\Run-Status\Output"


def live(name):
    return json.loads((LIVE / name).read_text(encoding="utf-8"))


def spec_from_live(summary, spec):
    """Put the real probe's run status, per-block BLKSTAT/messages and energy readings onto a fake COM spec."""
    spec = dict(spec)
    raw = summary["status"]["raw_status"]
    spec[STATUS + r"\UOSSTAT2"] = dict(value=raw["UOSSTAT2"])
    lines = summary["status"]["run_status_lines"]
    spec[STATUS + r"\PER_ERROR"] = dict(value=1, dim=1, kids=[str(i) for i in range(len(lines))])
    for i, line in enumerate(lines):
        spec[STATUS + rf"\PER_ERROR\{i}"] = dict(value=line)
    for block in summary["blocks"]:
        out = rf"\Data\Blocks\{block['id']}\Output"
        spec[out + r"\BLKSTAT"] = dict(value=block["blkstat"])
        spec.pop(out + r"\BLKMSG", None)
        lines = (["*  WARNING"] if block["status"] == "warning" else []) + block["messages"]
        spec[out + r"\PER_ERROR"] = dict(value=1, dim=1, kids=[str(i) for i in range(len(lines))])
        for i, line in enumerate(lines):
            spec[out + rf"\PER_ERROR\{i}"] = dict(value=line)
        for e in block["energy"]:
            spec[e["path"]] = dict(value=e["value"], unit=e["unit"])
    return spec


class Env:
    def __init__(self, spec, engine=None, name="m.bkp"):
        self.dir = tempfile.TemporaryDirectory()
        root = Path(self.dir.name)
        self.model = root / name
        self.model.write_bytes(b"fake archive")
        self.doc = FakeDoc(build_table(spec), engine or FakeEngine())
        self.ops = FakeProcessOps({1: (0, "explorer.exe"), 900: (1, "aspenplus.exe"), 901: (900, "apmain.exe")})
        self.out = root / "outputdata"
        self.patches = [patch.object(datacatch, "OUTPUT_ROOT", self.out), patch.object(batch_runner, "OUTPUT_ROOT", self.out)]
        for p in self.patches:
            p.start()
        self.adapters = []
        self.spawn = False

    def _document(self):
        if self.spawn:   # a new Aspen session appears after the baseline snapshot; 900/901 are the user's own
            self.ops.table[7000] = (4242, "aspenplus.exe")
            self.ops.table[7001] = (7000, "apmain.exe")
            self.ops.table[7002] = (1, "chrome.exe")
        return self.doc, "Apwn.Document.41.0"

    def factory(self, **kw):
        kw.setdefault("poll_s", 0.001)
        kw.setdefault("grace_s", 0.01)
        adapter = AspenPlusCOMAdapter(doc_factory=self._document, process_ops=self.ops, **kw)
        self.adapters.append(adapter)
        return adapter

    def runner(self, catalog=None, **kw):
        return BatchRunner(self.model, {}, [], catalog or {}, adapter_factory=self.factory, **kw)

    def close(self):
        for p in self.patches:
            p.stop()
        self.dir.cleanup()


class HeatrecoveryRegressionTests(unittest.TestCase):
    """heatrecovery.bkp: Aspen 'completed with warnings' (COOLER/VALVE phase stability, REACTOR zeroed rates)."""

    @classmethod
    def setUpClass(cls):
        cls.summary = live("live_hr_summary.json")

    def setUp(self):
        self.env = Env(spec_from_live(self.summary, heatrecovery_spec()))
        self.addCleanup(self.env.close)

    def run_once(self, **kw):
        with patch("builtins.print"):
            return self.env.runner(**kw).run_single({}, 1, "baseline")

    def test_fixture_numbers_match_the_fake_tree(self):
        table = self.env.doc.Tree.table
        for block in self.summary["blocks"]:
            for e in block["energy"]:
                self.assertEqual((table[e["path"]].Value, table[e["path"]].UnitString), (e["value"], e["unit"]), e["path"])

    def test_status_is_warning_and_maps_blkstat_2(self):
        result = self.run_once()
        self.assertEqual(result["status"], "warning")
        self.assertIsNone(result["error"])
        self.assertTrue(run_status.is_exported(result["status"]))
        self.assertEqual({b: d["status"] for b, d in result["blocks"].items()},
                         {b["id"]: b["status"] for b in self.summary["blocks"]})
        self.assertEqual({b: d["blkstat"] for b, d in result["blocks"].items() if d["blkstat"] == 2}.keys(),
                         {"COOLER", "REACTOR", "VALVE"})
        run = result["run_status"]
        self.assertEqual(run["state"], "warning")
        self.assertEqual(run["warnings"], self.summary["status"]["warnings"])
        self.assertEqual(run["errors"], [])
        self.assertEqual(run["raw_status"]["UOSSTAT2"], 10)

    def test_per_block_messages_are_aspens_own_and_match_the_probe(self):
        result = self.run_once()
        for block in self.summary["blocks"]:
            self.assertEqual(result["blocks"][block["id"]]["messages"], block["messages"], block["id"])
        self.assertIn("PHASE STABILITY CHECK", result["blocks"]["COOLER"]["messages"][0])
        self.assertIn("ZERO", result["blocks"]["REACTOR"]["messages"][0])
        self.assertEqual(result["blocks"]["PUMP"]["messages"], [])

    def test_heat_uses_cal_per_sec_and_4_1868_not_kw_or_4_184(self):
        result = self.run_once()
        heater = result["blocks"]["HEATER"]
        self.assertAlmostEqual(heater["heat_kW"], 1000.52531 * 4.1868 / 1000)
        self.assertNotAlmostEqual(heater["heat_kW"], 1000.52531 / 1000, places=2)   # old "treat cal/sec as W" bug
        self.assertNotAlmostEqual(heater["heat_kW"], 1000.52531 * 4.184 / 1000, places=4)   # thermochemical calorie
        self.assertEqual(heater["source_quantities"][r"\Data\Blocks\HEATER\Output\QCALC"], {"value": 1000.52531, "unit": "cal/sec"})
        for live_block in self.summary["blocks"]:
            block = result["blocks"][live_block["id"]]
            self.assertEqual([(e["kind"], e["value"], e["unit"]) for e in block["energy"]],
                             [(e["kind"], e["value"], e["unit"]) for e in live_block["energy"]])
            for mine, real in zip(block["energy"], live_block["energy"]):
                self.assertAlmostEqual(mine["kW"], real["kW"], places=9, msg=live_block["id"])
        self.assertAlmostEqual(result["blocks"]["PUMP"]["power_kW"], 2.1717208)
        self.assertEqual(result["calorie_J"], 4.1868)

    def test_every_numeric_result_carries_a_unit(self):
        result = self.run_once()
        for name, block in result["blocks"].items():
            self.assertEqual(block["units"], BLOCK_UNITS)
            self.assertEqual(missing_units(block, BLOCK_UNITS, name, exempt={"blkstat"}), [], name)
            for e in block["energy"]:
                self.assertTrue(e["unit"], (name, e))
        for name, stream in result["streams"].items():
            self.assertEqual(stream["units"], STREAM_UNITS)
            self.assertEqual(missing_units(stream, STREAM_UNITS, name), [], name)
        self.assertEqual(result["streams"]["FEED"]["pressure_MPa"], convert_quantity(1.0, "atm", "MPa"))   # atm, not bar
        self.assertEqual(result["streams"]["S3"]["temperature_C"], 603.0 - 273.15)                      # from K
        self.assertEqual(result["streams"]["FEED"]["mass_flow_kg_h"], 100.0)                            # kg/hr, not kg/s
        self.assertEqual(result["units"]["elapsed_time_seconds"], "s")

    def test_results_file_records_unit_conversion_and_run_cleanup(self):
        result = self.run_once()
        saved = json.loads(Path(result["output_dir"], "results.json").read_text(encoding="utf-8"))
        self.assertEqual((saved["unit_conversion"], saved["calorie_J"]), ("node-unit-aware-v2", 4.1868))
        self.assertEqual(result["cleanup"], {"killed_pids": [], "source_unchanged": True})
        self.assertEqual(self.env.doc.closed, False)       # Close(False): never saves the model
        self.assertEqual(self.env.doc.Engine.calls[:2], ["Reinit", ("Run2", 1)])
        self.assertNotIn("Run", self.env.doc.Engine.calls)  # no blocking Engine.Run()

    def test_parameters_are_written_before_the_run_and_read_back(self):
        spec = spec_from_live(self.summary, heatrecovery_spec())
        spec[r"\Data\Blocks\HEATER\Input\TEMP"] = dict(value=603.0, unit="K")
        env = Env(spec)
        self.addCleanup(env.close)
        catalog = {"HEATER.TEMP": dict(path=r"\Data\Blocks\HEATER\Input\TEMP", value=603.0, unit="K")}
        with patch("builtins.print"):
            result = env.runner(catalog).run_single({"HEATER.TEMP": 613}, 1)
        self.assertEqual(result["applied_parameters"], {"HEATER.TEMP": 613})
        self.assertEqual(env.doc.Tree.table[r"\Data\Blocks\HEATER\Input\TEMP"].Value, 613)
        self.assertEqual(result["status"], "warning")


class NormalRunTests(unittest.TestCase):
    """mch.bkp (Aspen RadFrac example): status ok; duties are native Btu/hr."""

    def test_ok_status_and_native_btu_duties_converted_with_units(self):
        summary = live("live_mch_summary.json")
        env = Env(spec_from_live(summary, radfrac_spec()), name="mch.bkp")
        self.addCleanup(env.close)
        with patch("builtins.print"):
            result = env.runner().run_single({}, 1)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["blocks"]["B1"]["status"], "ok")
        self.assertEqual(result["blocks"]["B1"]["messages"], [])
        energy = result["blocks"]["B1"]["energy"]
        real = summary["blocks"][0]["energy"]
        self.assertEqual([e["unit"] for e in energy], ["Btu/hr", "Btu/hr"])
        for mine, theirs in zip(energy, real):
            self.assertAlmostEqual(mine["kW"], theirs["kW"], places=6)
        self.assertAlmostEqual(sum(e["kW"] for e in energy if e["kW"] > 0), summary["totals_kW"]["heating"], places=3)
        # the legacy QCALC/DUTY lookup has no node on a column: missing stays None, never 0
        self.assertIsNone(result["blocks"]["B1"]["heat_kW"])


class FailureModeTests(unittest.TestCase):
    def env(self, engine, **kw):
        env = Env(heatrecovery_spec(), engine)
        self.addCleanup(env.close)
        return env, env.runner(**kw)

    def test_timeout_stops_the_engine_and_is_reported_not_raised(self):
        env, runner = self.env(FakeEngine(hang=True), timeout_s=0.05)
        with patch("builtins.print"):
            result = runner.run_single({}, 1, "slow")
        self.assertEqual(result["status"], "timeout")
        self.assertIn("0.05", result["error"])
        self.assertIn("--timeout", result["error"])
        self.assertFalse(run_status.is_exported(result["status"]))
        self.assertEqual((result["blocks"], result["streams"]), ({}, {}))
        self.assertIn("Stop", env.doc.Engine.calls)
        self.assertEqual(result["run_status"]["state"], "timeout")
        self.assertEqual(result["cleanup"]["killed_pids"], [])
        self.assertEqual(env.doc.closed, False)
        self.assertEqual(result["timeout_s"], 0.05)
        self.assertEqual(result["units"]["timeout_s"], "s")

    def test_timeout_that_ignores_stop_only_kills_the_aspen_this_run_started(self):
        class Stubborn(FakeEngine):
            def Stop(self):
                self.calls.append("Stop")      # does not actually stop
        env, runner = self.env(Stubborn(hang=True), timeout_s=0.02)
        env.spawn = True
        with patch("builtins.print"):
            result = runner.run_single({}, 1)
        self.assertEqual(result["status"], "timeout")
        self.assertEqual(sorted(env.ops.killed), [7000, 7001])
        self.assertEqual(sorted(result["cleanup"]["killed_pids"]), [7000, 7001])
        for untouched in (1, 900, 901, 7002):
            self.assertIn(untouched, env.ops.table, "never touches the user's own processes")

    def test_stop_request_during_a_run(self):
        env, runner = self.env(FakeEngine(hang=True), timeout_s=30)
        timer = threading.Timer(0.05, runner.request_stop)
        timer.start()
        self.addCleanup(timer.cancel)
        with patch("builtins.print"):
            result = runner.run_single({}, 1)
        self.assertEqual(result["status"], "stopped")
        self.assertIn("Stop", env.doc.Engine.calls)
        self.assertEqual(result["blocks"], {})

    def test_batch_stop_marks_unstarted_rows_skipped(self):
        env, runner = self.env(FakeEngine(hang=True), timeout_s=30)
        runner.request_stop()
        with patch("builtins.print"):
            results = runner.run_batch([{}, {}, {}], ["a", "b", "c"])
        self.assertEqual([r["status"] for r in results], ["skipped"] * 3)
        self.assertEqual(env.doc.Engine.calls, [], "Aspen was never started")
        counts = run_status.counts(results)
        self.assertEqual((counts["skipped"], counts["success_count"], counts["failed_count"]), (3, 0, 3))

    def test_engine_failure_and_open_failure_are_errors(self):
        env, runner = self.env(FakeEngine(fail_run=RuntimeError("boom")))
        with patch("builtins.print"):
            result = runner.run_single({}, 1)
        self.assertEqual(result["status"], "error")
        self.assertIn("boom", result["error"])
        env.model.unlink()
        with patch("builtins.print"):
            missing = runner.run_single({}, 2)
        self.assertEqual(missing["status"], "error")
        self.assertIn("找不到模型文件", missing["error"])

    def test_unknown_blkstat_is_an_error_but_the_data_is_still_exported(self):
        spec = heatrecovery_spec()
        spec[r"\Data\Blocks\HEATER\Output\BLKSTAT"] = dict(value=1)
        env = Env(spec)
        self.addCleanup(env.close)
        with patch("builtins.print"):
            result = env.runner().run_single({}, 1)
        self.assertEqual(result["status"], "error")
        self.assertIn("HEATER", result["error"])
        self.assertEqual(result["blocks"]["HEATER"]["status"], "error")
        self.assertTrue(result["output_dir"])


class BatchSummaryTests(unittest.TestCase):
    def test_summary_counts_statuses_and_csv_has_block_status_and_messages(self):
        summary = live("live_hr_summary.json")
        env = Env(spec_from_live(summary, heatrecovery_spec()))
        self.addCleanup(env.close)
        runner = env.runner()
        with patch("builtins.print"):
            runner.run_batch([{}], ["hr"])
            skipped = runner._new_result({}, 2, "later")
            skipped.update(status="timeout", error="Aspen 运行超过 1 秒")
            runner.batch_results.append(skipped)
            summary_json, summary_csv, directory = runner.save_batch_summary()
        data = json.loads(summary_json.read_text(encoding="utf-8"))
        self.assertEqual(data["summary_version"], 2)
        self.assertEqual(data["status_counts"], {"ok": 0, "warning": 1, "error": 0, "timeout": 1, "stopped": 0, "skipped": 0})
        self.assertEqual((data["success_count"], data["failed_count"]), (1, 1))
        self.assertEqual((data["timeout_s"], data["calorie_J"]), (1200, 4.1868))
        with summary_csv.open(encoding="utf-8-sig") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual([r["状态"] for r in rows], ["warning", "timeout"])
        self.assertEqual(rows[0]["设备.COOLER.状态"], "warning")
        self.assertIn("PHASE STABILITY", rows[0]["设备.COOLER.消息"])
        self.assertEqual(rows[0]["设备.PUMP.状态"], "ok")
        self.assertEqual(rows[1]["错误"], "Aspen 运行超过 1 秒")
        json.dumps(data, allow_nan=False)

    def test_legacy_status_words_still_read(self):
        self.assertTrue(run_status.is_exported("success"))
        self.assertFalse(run_status.is_exported("failed"))
        self.assertEqual(run_status.counts([{"status": "success"}, {"status": "failed"}])["success_count"], 1)


class TimeoutOptionTests(unittest.TestCase):
    def test_cli_accepts_positive_seconds_only(self):
        self.assertEqual(positive_seconds("90"), 90.0)
        for bad in ("0", "-5", "abc", "inf", "nan"):
            with self.assertRaises(Exception, msg=bad):
                positive_seconds(bad)

    def test_cli_timeout_overrides_config_overrides_default(self):
        with tempfile.TemporaryDirectory() as d:
            cfg = Path(d) / "c.json"
            cfg.write_text(json.dumps({"model_path": str(Path(d) / "m.bkp"), "parameter_catalog": {"k": {"path": "\\x", "value": 1}},
                                       "parameter_sets": [{"_name": "a", "parameters": {}}], "timeout_s": 77}), encoding="utf-8")
            seen = []

            class Spy(BatchRunner):
                def __init__(self, *a, **kw):
                    super().__init__(*a, **kw)
                    seen.append(self.timeout_s)

                def run_batch(self, *a, **kw):
                    return []

                def save_batch_summary(self):
                    return None

            with patch.object(batch_runner, "BatchRunner", Spy):
                batch_runner.main(["run", str(cfg)])
                batch_runner.main(["run", str(cfg), "--timeout", "5"])
            cfg.write_text(json.dumps({"model_path": "m.bkp", "parameter_catalog": {"k": {"path": "\\x", "value": 1}},
                                       "parameter_sets": []}), encoding="utf-8")
            with patch.object(batch_runner, "BatchRunner", Spy):
                batch_runner.main(["run", str(cfg)])
        self.assertEqual(seen, [77, 5.0, 1200])

    def test_runner_module_has_no_blocking_engine_run(self):
        source = Path(batch_runner.__file__).read_text(encoding="utf-8")
        self.assertFalse("Engine.Run()" in source)
        self.assertIn("adapter.run(", source)
        self.assertFalse("Engine.Run()" in Path(datacatch.__file__).read_text(encoding="utf-8"))

    def test_class_structure(self):
        for name in ("set_parameters", "run_single", "run_batch", "save_batch_summary", "request_stop",
                     "_print_brief_summary", "_generate_summary_csv"):
            self.assertTrue(hasattr(BatchRunner, name), name)
        runner = BatchRunner(Path("test_model.bkp"), {"REACTOR": {"_nodes": {"反应温度": "REAC_TEMP"}, "params": {"反应温度": 350}}}, ["IN"])
        self.assertEqual(runner.batch_results, [])
        self.assertEqual(len(runner.batch_id), 15)
        self.assertEqual(runner.timeout_s, 1200)


if __name__ == "__main__":
    unittest.main()
