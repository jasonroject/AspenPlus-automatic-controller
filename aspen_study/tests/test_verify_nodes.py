"""verify_nodes (the script BRO runs on a real Aspen) against a fake COM tree; no Aspen needed."""
import contextlib
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path

from aspen_study import verify_nodes as V
from aspen_study.adapters.aspen_com import AspenPlusCOMAdapter

from .fake_aspen import FakeDoc, FakeEngine, FakeProcessOps, build_table


def target_spec(turbine_work=-1500.0, rgibbs_qcalc=True):
    S = r"\Data\Results Summary\Run-Status\Output"
    blocks = {"C1": ("Compr", ["S1"], ["S2"]), "T1": ("Compr", ["S2"], ["S3"]), "MC": ("MCompr", ["S3"], ["S4"]),
              "R1": ("RStoic", ["S4"], ["S5"]), "R2": ("RYield", ["S5"], ["S6"]), "R3": ("RGibbs", ["S6"], ["S7"]),
              "R4": ("RCSTR", ["S7"], ["S8"]), "F3": ("Flash3", ["S8"], ["S9"])}
    spec = {S + r"\UOSSTAT2": dict(value=8), S + r"\PER_ERROR": dict(value=1, dim=1, kids=[]),
            r"\Data\Setup\Global\Input\INSET": dict(value="MET"), r"\Data\Setup\Global\Input\OUTSET": dict(value="MET"),
            r"\Data\Blocks": dict(kids=list(blocks)), r"\Data\Streams": dict(kids=[f"S{i}" for i in range(1, 10)]),
            r"\Data\Components\Specifications\Input\TYPE": dict(kids=[])}
    pressure = {"S1": 1.0, "S2": 5.0, "S3": 1.5, "S4": 1.5, "S5": 1.5, "S6": 1.5, "S7": 1.5, "S8": 1.5, "S9": 1.5}
    for sid, p in pressure.items():
        o = rf"\Data\Streams\{sid}\Output"
        spec[rf"\Data\Streams\{sid}"] = dict(attr6="MATERIAL")
        spec[o + r"\PRES_OUT\MIXED"] = dict(value=p, unit="atm")
        spec[o + r"\TEMP_OUT\MIXED"] = dict(value=300.0, unit="K")
        spec[o + r"\MASSFLMX\MIXED"] = dict(value=10.0, unit="kg/hr")
        spec[o + r"\MASSFLMX"] = dict(dim=1, kids=["MIXED"])
    for bid, (model, ins, outs) in blocks.items():
        base = rf"\Data\Blocks\{bid}"
        spec[base] = dict(attr6=model)
        spec[base + r"\Ports"] = dict(kids=["F(IN)", "P(OUT)"])
        spec[base + r"\Ports\F(IN)"] = dict(kids=ins)
        spec[base + r"\Ports\P(OUT)"] = dict(kids=outs)
        spec[base + r"\Output\BLKSTAT"] = dict(value=0)
        spec[base + r"\Output"] = dict(kids=["BLKSTAT"])
    out = lambda b, n: rf"\Data\Blocks\{b}\Output\{n}"
    spec[out("C1", "WNET")] = dict(value=2100.0, unit="kW")
    spec[out("C1", "BRAKE_POWER")] = dict(value=2000.0, unit="kW")
    spec[out("T1", "WNET")] = dict(value=turbine_work, unit="kW")
    spec[out("MC", "WNET")] = dict(value=300.0, unit="kW")
    for b in ("R1", "R2", "R4", "F3"):
        spec[out(b, "QCALC")] = dict(value=-250.0, unit="cal/sec")
        spec[out(b, "B_TEMP")] = dict(value=350.0, unit="K")
    if rgibbs_qcalc:
        spec[out("R3", "QCALC")] = dict(value=40.0, unit="cal/sec")
    else:
        spec[out("R3", "NET_DUTY")] = dict(value=40.0, unit="cal/sec")      # a node RECIPES does not know
    spec[r"\Data\Blocks\C1\Input\TYPE"] = dict(value="ISENTROPIC")
    return spec


def run_verify(spec, calorie_J=4.1868):
    tmp = tempfile.TemporaryDirectory()
    model = Path(tmp.name) / "HTL RYIELD.bkp"
    model.write_bytes(b"x")
    doc = FakeDoc(build_table(spec), FakeEngine())
    ops = FakeProcessOps({1: (0, "explorer.exe"), 900: (1, "aspenplus.exe")})
    factory = lambda **kw: AspenPlusCOMAdapter(doc_factory=lambda: (doc, "Apwn.Document.41.0"), process_ops=ops,
                                               poll_s=0.001, grace_s=0.01, **kw)
    result = V.verify_model(model, calorie_J=calorie_J, adapter_factory=factory, log=lambda *_: None)
    tmp.cleanup()
    return result


class VerifyTests(unittest.TestCase):
    def test_all_target_types_are_covered_with_units_and_a_turbine(self):
        doc, summary, graph = run_verify(target_spec())
        self.assertEqual(V.check_verification(doc), [])
        cov = doc["coverage"]
        self.assertEqual(cov["missing"], [])
        self.assertTrue(all(cov["types"].values()) and cov["turbine"])
        by_id = {b["id"]: b for b in doc["blocks"]}
        self.assertTrue(all(b["target"] for b in doc["blocks"]))
        # every candidate records existence, value and UnitString; missing nodes are marked, never 0
        c1 = {c["path"].rsplit("\\", 1)[-1]: c for c in by_id["C1"]["candidates"]}
        self.assertEqual((c1["WNET"]["value"], c1["WNET"]["unit"], c1["WNET"]["scalar"]), (2100.0, "kW", True))
        self.assertFalse(c1["IND_POWER"]["readable"])
        self.assertNotIn("value", c1["IND_POWER"])
        self.assertEqual(by_id["C1"]["output_children"], ["BLKSTAT"])
        self.assertEqual(by_id["C1"]["input_context"][0]["value"], "ISENTROPIC")
        # sign: compressor positive, turbine negative
        self.assertEqual(by_id["C1"]["work_sign"]["kind"], "compressor")
        self.assertEqual(by_id["C1"]["work_sign"]["verdict"], "consistent")
        self.assertEqual((by_id["T1"]["work_sign"]["kind"], by_id["T1"]["work_sign"]["expected_sign"],
                          by_id["T1"]["work_sign"]["observed_sign"], by_id["T1"]["work_sign"]["verdict"]),
                         ("turbine", "negative", "negative", "consistent"))
        self.assertEqual(by_id["MC"]["work_sign"]["verdict"], "consistent")
        self.assertEqual(by_id["R1"]["energy_read"][0]["unit"], "cal/sec")
        self.assertEqual(by_id["R1"]["recipe"], "unverified")
        # the same run also yields a valid probe summary + graph (a ready-made result package)
        from aspen_study.schema_check import validate
        validate(summary, "probe")
        validate(graph, "graph")
        json.dumps(doc, allow_nan=False)

    def test_turbine_with_positive_work_is_flagged_inverted(self):
        doc, _, _ = run_verify(target_spec(turbine_work=+1500.0))
        problems = V.check_verification(doc)
        self.assertEqual(len(problems), 1)
        self.assertIn("T1 (Compr): work sign inverted: turbine", problems[0])

    def test_unknown_node_name_is_reported_with_alternatives(self):
        doc, _, _ = run_verify(target_spec(rgibbs_qcalc=False))
        problems = V.check_verification(doc)
        self.assertEqual(len(problems), 1)
        self.assertIn("R3 (RGibbs): no energy node read by RECIPES", problems[0])
        self.assertIn("NET_DUTY", problems[0])
        self.assertIn("RGibbs", doc["coverage"]["missing"])

    def test_unsupported_unit_and_failed_run_are_problems(self):
        doc, _, _ = run_verify(target_spec())
        bad = copy.deepcopy(doc)
        next(b for b in bad["blocks"] if b["id"] == "R1")["energy_read"][0]["unit"] = "furlong/fortnight"
        self.assertTrue(any("not understood by to_kW" in p for p in V.check_verification(bad)))
        bad = copy.deepcopy(doc)
        bad["run"].update(state="error", run_completed=False)
        self.assertTrue(any("run itself failed" in p for p in V.check_verification(bad)))
        bad = copy.deepcopy(doc)
        bad["schema"] = "x"
        self.assertEqual(len(V.check_verification(bad)), 1)

    def test_candidates_include_the_recipe_nodes_first_without_duplicates(self):
        names = V.candidates_for("Compr")
        self.assertEqual(names[:3], ["ELEC_POWER", "BRAKE_POWER", "WNET"])
        self.assertEqual(len(names), len(set(names)))
        self.assertNotIn("BLKSTAT", names)
        self.assertIn("QCALC", V.candidates_for("SomethingNew"))

    def test_find_scans_text_models_for_target_types(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, "a.bkp").write_bytes(b"; x\nBLOCK B1 COMPR\nPARAM\nBLOCK B2 Flash3\n")
            Path(d, "sub").mkdir()
            Path(d, "sub", "b.bkp").write_bytes(b"BLOCK TURB Compr\n  BLOCK X RStoic \n\xff\xfe binary")
            Path(d, "c.txt").write_text("BLOCK Q RGibbs")
            found, scanned = V.find_models([d])
        self.assertEqual(scanned, 2)
        self.assertEqual({Path(p).name for _, p in found["Compr"]}, {"a.bkp", "b.bkp"})
        self.assertEqual({Path(p).name for _, p in found["RStoic"]}, {"b.bkp"})
        self.assertEqual(found["RGibbs"], [])

    def test_cli_check_with_and_without_fixtures(self):
        doc, _, _ = run_verify(target_spec())
        with tempfile.TemporaryDirectory() as d:
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                self.assertEqual(V.main(["check", d]), 0)
            self.assertIn("nothing verified yet", buf.getvalue())
            Path(d, "HTL_RYIELD.nodes.json").write_text(json.dumps(doc), encoding="utf-8")
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                self.assertEqual(V.main(["check", d]), 0)
            self.assertIn("HTL_RYIELD.nodes.json: ok", buf.getvalue())
            self.assertNotIn("NOT covered", buf.getvalue())
            doc["blocks"] = [b for b in doc["blocks"] if b["type"] != "RGibbs"]
            Path(d, "HTL_RYIELD.nodes.json").write_text(json.dumps(doc), encoding="utf-8")
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                V.main(["check", d])
            self.assertIn("NOT covered yet: RGibbs", buf.getvalue())

    def test_stem_is_filename_safe(self):
        self.assertEqual(V._stem("HTL RYIELD.bkp"), "HTL_RYIELD")


if __name__ == "__main__":
    unittest.main()
