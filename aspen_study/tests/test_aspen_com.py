"""Aspen COM 适配器、节点规则与 probe CLI 的测试。全部使用假 COM，不需要 Aspen / Windows。"""
import contextlib
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from aspen_study.adapters import aspen_rules as R
from aspen_study.adapters.aspen_com import AspenPlusCOMAdapter
from aspen_study.adapters.errors import AspenConnectionLost, AspenError, AspenTimeout, ModelOpenError
from aspen_study.cli import main as cli_main
from aspen_study.probe_compat import group_totals
from aspen_study.probe import energy_table, format_report, run_probe, totals_kW
from aspen_study.schema_check import validate

from .fake_aspen import (FakeDoc, FakeEngine, FakeProcessOps, build_table, heatrecovery_spec, radfrac_spec)
from .helpers import HAS_NODE


class Env:
    """一个临时模型文件 + 假文档 + 假进程表。"""

    def __init__(self, spec=None, engine=None, ops=None, name="m.bkp"):
        self.dir = tempfile.TemporaryDirectory()
        self.model = Path(self.dir.name) / name
        self.model.write_bytes(b"fake archive")
        self.table = build_table(spec or heatrecovery_spec())
        self.doc = FakeDoc(self.table, engine or FakeEngine())
        self.ops = ops or FakeProcessOps({1: (0, "explorer.exe"), 900: (1, "aspenplus.exe"), 901: (900, "apmain.exe")})

    def adapter(self, **kw):
        kw.setdefault("poll_s", 0.001)
        kw.setdefault("grace_s", 0.01)
        return AspenPlusCOMAdapter(doc_factory=lambda: (self.doc, "Apwn.Document.41.0"), process_ops=self.ops, **kw)

    def close(self):
        self.dir.cleanup()


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.addCleanup(self.env.close)

    def discover(self, adapter=None):
        a = adapter or self.env.adapter()
        a.open(self.env.model)
        a.run()
        graph = a.discover()
        return a, graph

    def test_happy_path_graph_validates_and_maps_blocks(self):
        a, g = self.discover()
        a.close()
        validate(g, "graph")
        blocks = {b["id"]: b for b in g["blocks"]}
        self.assertEqual({b: x["type"] for b, x in blocks.items()}["REACTOR"], "RPlug")
        # 加热器 / 冷却器：QCALC，单位取节点自己的 cal/sec（不是 kW）
        self.assertEqual(blocks["HEATER"]["energy"], [{"kind": "heat", "value": 1000.52531, "unit": "cal/sec",
                                                       "path": r"\Data\Blocks\HEATER\Output\QCALC"}])
        self.assertLess(blocks["COOLER"]["energy"][0]["value"], 0)
        # HeatX：HX_DUTY，role_hint=exchanged；DUTY_HOT 是 Dimension=1 的向量占位，不能被读成 1
        self.assertEqual([(e["kind"], e["role_hint"], e["value"]) for e in blocks["HEATCHAG"]["energy"]],
                         [("heat", "exchanged", 9673.5897)])
        # 泵：优先 ELEC_POWER，单位 kW
        self.assertEqual((blocks["PUMP"]["energy"][0]["unit"], blocks["PUMP"]["energy"][0]["path"].rsplit("\\", 1)[1]),
                         ("kW", "ELEC_POWER"))
        # 阀：绝热，没有负荷节点，能量为空而不是 0
        self.assertEqual(blocks["VALVE"]["energy"], [])
        # RPlug：B_TEMP 是剖面，出口温度取最后一点，不能是占位 1
        self.assertEqual(blocks["REACTOR"]["outlet_temperature"]["value"], 601.5)
        self.assertEqual(blocks["B6"]["outlet_temperature"]["value"], 313.0)

    def test_stream_graph_ports_and_totals(self):
        a, g = self.discover()
        a.close()
        s = {x["id"]: x for x in g["streams"]}
        self.assertEqual((s["FEED"]["from"], s["FEED"]["to"]), ("BOUNDARY", "PUMP"))
        self.assertEqual((s["S2"]["from"], s["S2"]["to"]), ("PUMP", "HEATER"))
        self.assertEqual(s["FEED"]["total"]["T_unit"], "K")
        self.assertEqual(s["FEED"]["total"]["energy_unit"], "cal/sec")
        self.assertAlmostEqual(s["FEED"]["substreams"]["MIXED"]["mass_by_component"]["H2O"], 90.0)
        self.assertEqual([c["id"] for c in g["components"]], ["H2O", "STYRENE"])
        self.assertEqual(g["components"][1]["cas"], "100-42-5")
        self.assertEqual(g["units"]["OUTSET"], "MET")
        self.assertEqual(g["model"]["version"], "41.0")
        self.assertEqual(g["model"]["progid"], "Apwn.Document.41.0")

    def test_status_is_classified_from_real_nodes(self):
        a, g = self.discover()
        rep = a.run_report()
        a.close()
        self.assertEqual(rep["state"], "warning")
        self.assertTrue(rep["run_completed"])
        self.assertEqual({b: i["state"] for b, i in rep["blocks"].items()},
                         {"B6": "ok", "COOLER": "warning", "HEATCHAG": "ok", "HEATER": "ok", "PUMP": "ok",
                          "REACTOR": "warning", "VALVE": "warning"})
        self.assertEqual(rep["errors"], [])
        self.assertEqual(sorted(w.split("：")[0] for w in rep["warnings"]), ["块 COOLER", "块 REACTOR", "块 VALVE"])
        self.assertIn("PHASE STABILITY", " ".join(rep["warnings"]))
        self.assertEqual(g["status"]["run_completed"], True)
        self.assertEqual(g["status"]["block_status"]["COOLER"], 2)
        self.assertEqual(g["status"]["block_status_accepted"], [0, 2])
        self.assertNotIn("cvstat", g["status"])  # CVSTAT 在真机上不是通过/失败码（干净模型也可能是 2），不进 G1

    def test_blkstat_error_code_fails_the_run(self):
        spec = heatrecovery_spec()
        spec[r"\Data\Blocks\HEATER\Output\BLKSTAT"] = dict(value=1)
        spec[r"\Data\Results Summary\Run-Status\Output\UOSSTAT2"] = dict(value=9)
        env = Env(spec)
        self.addCleanup(env.close)
        a = env.adapter()
        a.open(env.model); a.run(); g = a.discover(); a.close()
        self.assertEqual(g["status"]["run_completed"], False)
        self.assertTrue(any("HEATER" in e for e in g["status"]["errors"]))
        from aspen_study import validation
        self.assertEqual(validation.g1_converged(g)["status"], "fail")

    def test_missing_values_are_absent_never_zero(self):
        spec = heatrecovery_spec()
        del spec[r"\Data\Blocks\HEATER\Output\QCALC"]
        spec[r"\Data\Blocks\COOLER\Output\QCALC"] = dict(value=None, unit="cal/sec")
        env = Env(spec)
        self.addCleanup(env.close)
        a = env.adapter()
        a.open(env.model); a.run(); g = a.discover()
        gaps = a.energy_gaps(); a.close()
        blocks = {b["id"]: b for b in g["blocks"]}
        self.assertEqual(blocks["HEATER"]["energy"], [])
        self.assertEqual(blocks["COOLER"]["energy"], [])
        self.assertEqual(len(gaps), 2)
        validate(g, "graph")

    def test_explicit_zero_is_marked(self):
        spec = heatrecovery_spec()
        spec[r"\Data\Blocks\HEATER\Output\QCALC"] = dict(value=0.0, unit="cal/sec")
        env = Env(spec)
        self.addCleanup(env.close)
        a = env.adapter()
        a.open(env.model); a.run(); g = a.discover(); a.close()
        e = [b for b in g["blocks"] if b["id"] == "HEATER"][0]["energy"][0]
        self.assertEqual((e["value"], e["explicit_zero"]), (0.0, True))

    def test_radfrac_condenser_and_reboiler(self):
        env = Env(radfrac_spec(), name="col.bkp")
        self.addCleanup(env.close)
        a = env.adapter()
        a.open(env.model); a.run(); g = a.discover(); rep = a.run_report(); a.close()
        e = g["blocks"][0]["energy"]
        self.assertEqual([(x["role_hint"], x["unit"]) for x in e], [("condenser", "Btu/hr"), ("reboiler", "Btu/hr")])
        self.assertLess(e[0]["value"], 0)
        self.assertEqual(rep["state"], "ok")
        self.assertEqual(g["units"]["INSET"], "ENG")
        # 全部为已验证的节点；没有未验证路径提示
        self.assertEqual(g["discovery"]["unverified_paths"], [])

    def test_radfrac_without_condenser_leaves_gap(self):
        env = Env(radfrac_spec(cond=None), name="col.bkp")
        self.addCleanup(env.close)
        a = env.adapter()
        a.open(env.model); a.run(); g = a.discover()
        self.assertEqual([x["role_hint"] for x in g["blocks"][0]["energy"]], ["reboiler"])
        self.assertEqual(len(a.energy_gaps()), 1)
        a.close()

    def test_unknown_block_type_is_reported_and_uses_generic_nodes(self):
        spec = radfrac_spec(cond=None, reb=None)
        spec[r"\Data\Blocks\B1"] = dict(attr6="WeirdUnit")
        spec[r"\Data\Blocks\B1\Output\QCALC"] = dict(value=12.5, unit="kW")
        env = Env(spec)
        self.addCleanup(env.close)
        a = env.adapter()
        a.open(env.model); a.run(); g = a.discover(); a.close()
        self.assertEqual(g["discovery"]["unmatched_block_types"], ["WeirdUnit"])
        self.assertEqual(g["blocks"][0]["energy"][0]["value"], 12.5)
        self.assertFalse(g["discovery"]["complete"])
        self.assertIn("通用 QCALC", g["discovery"]["unverified_paths"])


class ProbeV11Tests(unittest.TestCase):
    """aspen-probe/1.1：blkmsg/per_error、verified、group_totals、对象形式的 energy_gaps / unverified_paths。"""

    def probe(self, spec, name="m.bkp"):
        env = Env(spec, name=name)
        self.addCleanup(env.close)
        with tempfile.TemporaryDirectory() as out:
            summary, _ = run_probe(env.model, out, make_study=False, adapter_factory=lambda **kw: env.adapter(**kw), log=lambda *_: None)
            on_disk = json.loads((Path(out) / "probe-summary.json").read_text(encoding="utf-8"))
        validate(summary, "probe")
        self.assertEqual(on_disk["schema"], "aspen-probe/1.1")
        return summary

    def test_block_messages_split_and_status_from_blkstat(self):
        summary = self.probe(heatrecovery_spec())
        for b in summary["blocks"]:
            self.assertNotIn("messages", b)
            self.assertIsInstance(b["per_error"], list)
            self.assertIn("blkmsg", b)
            self.assertEqual(b["status"], {0: "ok", 2: "warning"}.get(b["blkstat"], b["status"]))
            self.assertGreaterEqual(b["per_error_total"], len(b["per_error"]))

    def test_every_energy_entry_has_verified_flag(self):
        summary = self.probe(heatrecovery_spec())
        flags = {e["path"]: e["verified"] for b in summary["blocks"] for e in b["energy"]}
        self.assertTrue(flags and all(isinstance(v, bool) for v in flags.values()))
        self.assertTrue(all(flags.values()))  # heater/flash/heatx/pump/rplug 都是真机验证过的配方

    def test_unregistered_block_is_unverified_and_listed_as_object(self):
        spec = radfrac_spec(cond=None, reb=None)
        spec[r"\Data\Blocks\B1"] = dict(attr6="WeirdUnit")
        spec[r"\Data\Blocks\B1\Output\QCALC"] = dict(value=12.5, unit="kW")
        summary = self.probe(spec)
        self.assertFalse(summary["blocks"][0]["energy"][0]["verified"])
        item = summary["unverified_paths"][0]
        self.assertNotIn("unverified_paths", summary["discovery"])
        self.assertEqual((item["block"], item["path"]), ("B1", r"\Data\Blocks\B1\Output\QCALC"))
        self.assertTrue(item["reason"])
        self.assertFalse(summary["totals_complete"])
        self.assertFalse(summary["group_totals"]["overall"]["complete"])

    def test_energy_gaps_are_objects(self):
        spec = heatrecovery_spec()
        del spec[r"\Data\Blocks\HEATER\Output\QCALC"]
        summary = self.probe(spec)
        gap = summary["energy_gaps"][0]
        self.assertEqual(set(gap), {"block", "path", "reason"})
        self.assertEqual(gap["block"], "HEATER")
        self.assertFalse(summary["totals_complete"])

    def test_group_totals_exclude_internal_exchange_and_match_legacy_totals(self):
        summary = self.probe(heatrecovery_spec())
        g, t = summary["group_totals"], summary["totals_kW"]
        self.assertEqual((g["heating"]["kW"], g["cooling"]["kW"], g["shaft_work"]["kW"], g["internal_exchange"]["kW"]), (t["heating"], t["cooling"], t["work"], t["internal_exchange"]))
        self.assertTrue(all(v["complete"] for v in g.values()))
        self.assertGreater(g["internal_exchange"]["kW"], 0)
        self.assertAlmostEqual(g["overall"]["kW"], t["heating"] + t["cooling"] + t["work"], places=5)  # 净值，不含内部换热
        self.assertTrue(summary["totals_complete"])

    def test_group_totals_null_when_a_member_cannot_convert(self):
        rows = [{"energy": [{"kind": "heat", "value": 5.0, "unit": "weird", "kW": None},
                            {"kind": "work", "value": 1.0, "unit": "kW", "kW": 1.0}]}]
        g = group_totals(rows, True)
        self.assertEqual(g["heating"], {"kW": None, "complete": False})
        self.assertEqual(g["shaft_work"], {"kW": 1.0, "complete": True})
        self.assertEqual(g["overall"], {"kW": None, "complete": False})
        self.assertFalse(group_totals(rows[:0] or [{"energy": []}], False)["shaft_work"]["complete"])  # totals_complete=false 时全部不完整

    def test_report_still_renders_with_objects(self):
        spec = radfrac_spec(cond=None, reb=None)
        spec[r"\Data\Blocks\B1"] = dict(attr6="WeirdUnit")
        spec[r"\Data\Blocks\B1\Output\QCALC"] = dict(value=12.5, unit="kW")
        text = format_report(self.probe(spec))
        self.assertIn("尚未在真机验证", text)
        self.assertIn("internal_exchange", text)


class RunAndCleanupTests(unittest.TestCase):
    def test_engine_runs_reinit_then_async_and_private_doc(self):
        env = Env()
        self.addCleanup(env.close)
        a = env.adapter()
        a.open(env.model)
        a.run()
        a.close()
        self.assertEqual(env.doc.Engine.calls, ["Reinit", ("Run2", 1)])
        self.assertEqual(env.doc.SuppressDialogs, 1)
        self.assertEqual(env.doc.Visible, 0)
        self.assertIs(env.doc.closed, False)  # Close(False)：不保存
        self.assertTrue(env.doc.opened.endswith("input.bkp"))
        self.assertNotEqual(Path(env.doc.opened), env.model)  # 打开的是副本
        self.assertTrue(a.source_unchanged)

    def test_timeout_stops_then_kills_only_our_processes(self):
        env = Env(engine=FakeEngine(hang=True))
        self.addCleanup(env.close)
        a = env.adapter(timeout_s=0.01)
        a.open(env.model)
        # 此时出现本次会话的子进程；基线里的 900/901 是用户自己的 Aspen，不能碰
        env.ops.table[7000] = (4242, "aspenplus.exe")
        env.ops.table[7001] = (7000, "apmain.exe")
        env.ops.table[7002] = (1, "chrome.exe")
        with self.assertRaises(AspenTimeout) as ctx:
            a.run()
        self.assertIn("超过", str(ctx.exception))
        a.close()
        self.assertIn("Stop", env.doc.Engine.calls)
        self.assertEqual(sorted(env.ops.killed), [7000, 7001])
        self.assertIn(900, env.ops.table)
        self.assertIn(901, env.ops.table)
        self.assertIn(7002, env.ops.table)
        self.assertIs(env.doc.closed, False)

    def test_close_kills_leftover_child_and_orphan_but_not_baseline(self):
        env = Env()
        self.addCleanup(env.close)
        a = env.adapter()
        a.open(env.model)
        env.ops.table[8000] = (4242, "apmain.exe")       # 本次会话的子进程，Close 后没退出
        env.ops.table[8001] = (123456, "apmain.exe")     # 父进程已不存在的孤儿
        a.close()
        self.assertEqual(sorted(env.ops.killed), [8000, 8001])
        self.assertEqual({900, 901} & set(env.ops.killed), set())
        a.close()  # 幂等

    def test_connection_loss_is_reported_in_chinese(self):
        env = Env()
        self.addCleanup(env.close)
        a = env.adapter()
        a.open(env.model)
        env.doc.Tree.lost = True
        with self.assertRaises(AspenConnectionLost) as ctx:
            a.blocks()
        self.assertIn("中途消失", str(ctx.exception))
        env.doc.Tree.lost = False
        a.close()

    def test_engine_exception_becomes_error_status(self):
        env = Env(engine=FakeEngine(fail_run=RuntimeError("boom")))
        self.addCleanup(env.close)
        a = env.adapter()
        a.open(env.model)
        with self.assertRaises(AspenError):
            a.run()
        rep = a.run_report()
        a.close()
        self.assertEqual(rep["state"], "error")
        self.assertFalse(rep["run_completed"])

    def test_bad_inputs(self):
        env = Env()
        self.addCleanup(env.close)
        a = env.adapter()
        with self.assertRaisesRegex(ModelOpenError, "找不到模型文件"):
            a.open(env.model.with_name("nope.bkp"))
        apwz = env.model.with_name("m.apwz")
        apwz.write_bytes(b"x")
        with self.assertRaisesRegex(ModelOpenError, "暂不支持 .apwz"):
            a.open(apwz)
        self.assertIsNone(env.doc.opened)

    def test_apw_opens_with_initfromfile2(self):
        env = Env(name="m.apw")
        self.addCleanup(env.close)
        a = env.adapter()
        a.open(env.model)
        a.close()
        self.assertEqual(env.doc.opened_with, "InitFromFile2")
        self.assertTrue(env.doc.opened.endswith("input.apw"))

    def test_open_failure_closes_doc(self):
        env = Env()
        self.addCleanup(env.close)

        def boom(path):
            raise RuntimeError("license")
        env.doc.InitFromArchive2 = boom
        a = env.adapter()
        with self.assertRaisesRegex(ModelOpenError, "打不开"):
            a.open(env.model)
        self.assertIs(env.doc.closed, False)


class RulesTests(unittest.TestCase):
    def test_to_kW(self):
        self.assertEqual(R.to_kW(2.17, "kW"), (2.17, ""))
        self.assertAlmostEqual(R.to_kW(1000.0, "cal/sec", 4.1868)[0], 4.1868)
        self.assertAlmostEqual(R.to_kW(1000.0, "cal/sec", 4.184)[0], 4.184)
        self.assertAlmostEqual(R.to_kW(1.0, "Gcal/hr", 4.1868)[0], 1163.0, places=0)
        self.assertAlmostEqual(R.to_kW(3412.141633, "Btu/hr")[0], 1.0, places=5)
        self.assertAlmostEqual(R.to_kW(1.0, "Watt")[0], 0.001)
        self.assertIsNone(R.to_kW(1.0, "cal/sec")[0])        # 没声明卡路里约定：不猜
        self.assertIsNone(R.to_kW(1.0, "furlong/fortnight")[0])
        self.assertIsNone(R.to_kW(None, "kW")[0])

    def test_parse_run_status_lines(self):
        p = R.parse_run_status_lines(["The following Unit Operation blocks were", "completed with warnings:", " COOLER  REACTOR  VALVE ", ""])
        self.assertEqual(p["unit_warnings"], ["COOLER", "REACTOR", "VALVE"])
        p = R.parse_run_status_lines(["The following Unit Operation blocks were completed with errors: B6",
                                      "The following Convergence blocks were completed with warnings: C-1 C-2"])
        self.assertEqual((p["unit_errors"], p["conv_warnings"]), (["B6"], ["C-1", "C-2"]))

    def test_classify_block(self):
        self.assertEqual(R.classify_block(0)[0], "ok")
        self.assertEqual(R.classify_block(2)[0], "warning")
        self.assertEqual(R.classify_block(1)[0], "error")
        self.assertEqual(R.classify_block(None)[0], "unknown")
        self.assertEqual(R.classify_block(0, ["*  ERROR", "bad"])[0], "error")
        self.assertEqual(R.classify_block(0, ["*  WARNING", "x"])[0], "ok")  # 真机：HEATCHAG 有 WARNING 文本但 BLKSTAT=0、不在运行报告里

    def test_classify_run(self):
        blocks = {"B1": {"state": "ok", "blkstat": 0}}
        self.assertEqual(R.classify_run(True, 8, [], blocks)["state"], "ok")
        self.assertEqual(R.classify_run(True, 10, [], blocks)["state"], "warning")
        self.assertEqual(R.classify_run(True, 9, [], blocks)["state"], "error")
        self.assertEqual(R.classify_run(True, 99, [], blocks)["state"], "error")
        self.assertEqual(R.classify_run(False, 8, [], blocks)["state"], "error")
        self.assertFalse(R.classify_run(False, 8, [], blocks)["run_completed"])


class ProbeTests(unittest.TestCase):
    def factory(self, env):
        def make(**kw):
            return env.adapter(**{k: v for k, v in kw.items()})
        return make

    def test_run_probe_writes_summary_and_graph(self):
        env = Env()
        self.addCleanup(env.close)
        with tempfile.TemporaryDirectory() as out:
            before = hashlib.sha256(env.model.read_bytes()).hexdigest()
            summary, out_dir = run_probe(env.model, out, make_study=False, adapter_factory=self.factory(env), log=lambda *_: None)
            self.assertEqual(hashlib.sha256(env.model.read_bytes()).hexdigest(), before)
            validate(json.loads((Path(out) / "probe-summary.json").read_text(encoding="utf-8")), "probe")
            validate(json.loads((Path(out) / "graph.json").read_text(encoding="utf-8")), "graph")
        self.assertEqual(summary["status"]["state"], "warning")
        self.assertTrue(summary["totals_complete"])
        self.assertTrue(summary["model"]["source_unchanged"])
        rows = {r["id"]: r for r in summary["blocks"]}
        heater = rows["HEATER"]["energy"][0]
        self.assertAlmostEqual(heater["kW"], 1000.52531 * 4.1868 / 1000)
        self.assertEqual(rows["PUMP"]["energy"][0]["kW"], 2.1717208)
        self.assertEqual(rows["COOLER"]["status"], "warning")
        t = summary["totals_kW"]
        self.assertAlmostEqual(t["heating"], (192.82363 + 1000.52531 + 2891.5462) * 4.1868 / 1000, places=5)
        self.assertAlmostEqual(t["cooling"], -2087.51163 * 4.1868 / 1000, places=5)
        self.assertAlmostEqual(t["internal_exchange"], 9673.5897 * 4.1868 / 1000, places=5)
        self.assertAlmostEqual(t["work"], 2.1717208, places=5)

    def test_totals_are_null_when_a_unit_cannot_convert(self):
        rows = [{"energy": [{"kind": "heat", "value": 5.0, "unit": "weird", "kW": None},
                            {"kind": "work", "value": 1.0, "unit": "kW", "kW": 1.0}]}]
        t = totals_kW(rows)
        self.assertIsNone(t["heating"])
        self.assertEqual(t["work"], 1.0)

    def test_gaps_mark_totals_incomplete(self):
        spec = heatrecovery_spec()
        del spec[r"\Data\Blocks\HEATER\Output\QCALC"]
        env = Env(spec)
        self.addCleanup(env.close)
        with tempfile.TemporaryDirectory() as out:
            summary, _ = run_probe(env.model, out, make_study=False, adapter_factory=self.factory(env), log=lambda *_: None)
        self.assertFalse(summary["totals_complete"])
        self.assertEqual(len(summary["energy_gaps"]), 1)
        self.assertIn("不完整", format_report(summary))

    def test_chinese_report(self):
        env = Env()
        self.addCleanup(env.close)
        with tempfile.TemporaryDirectory() as out:
            summary, _ = run_probe(env.model, out, make_study=False, adapter_factory=self.factory(env), log=lambda *_: None)
        text = format_report(summary)
        for needle in ("运行状态：有警告", "单位集：输入 MET", "热负荷", "合计 kW", "警告：块 COOLER", "源文件未改动：是"):
            self.assertIn(needle, text)

    def test_cli_error_message_is_chinese_and_exit_code_3(self):
        err, out = io.StringIO(), io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(out):
            code = cli_main(["probe", "/definitely/not/here.bkp"])
        self.assertEqual(code, 3)
        self.assertIn("错误：找不到模型文件", err.getvalue())

    @unittest.skipUnless(HAS_NODE, "Node.js is required for universal-core")
    def test_probe_can_emit_a_study_bundle(self):
        env = Env()
        self.addCleanup(env.close)
        with tempfile.TemporaryDirectory() as out:
            summary, _ = run_probe(env.model, out, adapter_factory=self.factory(env), log=lambda *_: None)
            self.assertIn("study", summary)
            if summary["study"]["ok"]:
                validate(json.loads((Path(out) / "study" / "manifest.json").read_text(encoding="utf-8")), "manifest")


if __name__ == "__main__":
    unittest.main()
