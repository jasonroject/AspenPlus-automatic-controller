"""Result package (probe-summary.json [+ graph.json, roles.json, advice.json]): the single input format of local and online paths.

Fixtures: BRO's aspen-probe/1.1 files (fixtures/probe/) and the real aspen-probe/1 live files (fixtures/live/) read through
probe_compat.upgrade_summary."""
import copy
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from aspen_study import result_package as RP
from aspen_study.advice import advise
from aspen_study.probe_compat import upgrade_summary

FIX = Path(__file__).resolve().parent / "fixtures"


def load(sub, name):
    return json.loads((FIX / sub / name).read_text(encoding="utf-8"))


def hr_parts(with_advice=True):
    """heatrecovery with BRO's 1.1 summary + graph + roles draft (+ advice)."""
    return RP.build_package(load("probe", "heatrecovery.probe-summary.json"), load("probe", "heatrecovery.graph.json"),
                            load("probe", "heatrecovery.roles.json"), with_advice=with_advice)


def text(items):
    return " | ".join(items)


class PackageTests(unittest.TestCase):
    def test_1_1_fixtures_build_validate_and_advice_matches_bros_golden_output(self):
        parts = hr_parts()
        self.assertEqual(tuple(parts), RP.PACKAGE_FILES)
        self.assertEqual(parts["advice.json"], load("probe", "heatrecovery.advice.json"))
        report = RP.validate_package(parts)
        self.assertEqual(report["errors"], [])
        warnings = text(report["warnings"])
        self.assertIn("completed with warnings", warnings)
        self.assertIn("COOLER", warnings)
        self.assertIn("auto_draft", warnings)
        info = RP.describe(parts)
        self.assertEqual((info["model"], info["state"], info["blocks"], info["streams"]), ("heatrecovery.bkp", "warning", 7, 10))
        self.assertEqual(info["advice"]["total"], 17)
        self.assertEqual(info["files"], list(RP.PACKAGE_FILES))

    def test_mch_1_1_summary_alone_is_a_valid_package_with_skipped_checks(self):
        parts = {"probe-summary.json": load("probe", "mch.probe-summary.json")}
        report = RP.validate_package(parts)
        self.assertEqual(report["errors"], [])
        self.assertIn("no graph.json", text(report["warnings"]))
        self.assertIn("no roles.json", text(report["warnings"]))
        self.assertNotIn("Aspen completed with warnings", text(report["warnings"]))
        built = RP.build_package(parts["probe-summary.json"], with_advice=True)      # advice without graph/roles: checks skipped
        self.assertEqual(list(built), ["probe-summary.json", "advice.json"])
        self.assertEqual(built["advice.json"], load("probe", "mch.advice.json"))
        self.assertEqual(RP.validate_package({"graph.json": load("probe", "heatrecovery.graph.json")})["errors"],
                         ["missing probe-summary.json"])

    def test_real_1_0_live_files_are_read_through_upgrade_and_warn(self):
        raw = load("live", "live_hr_summary.json")
        self.assertEqual(raw["schema"], "aspen-probe/1")
        self.assertNotIn("totals_complete", raw)
        before = copy.deepcopy(raw)
        parts = RP.build_package(raw, load("live", "live_hr_graph.json"))
        self.assertEqual(raw, before, "input is never rewritten")
        self.assertEqual(parts["probe-summary.json"], upgrade_summary(raw))
        self.assertEqual(parts["probe-summary.json"], load("probe", "heatrecovery.probe-summary.json"))
        self.assertEqual(parts["probe-summary.json"]["schema"], "aspen-probe/1.1")
        # validator accepts the raw 1.0 too and says it was upgraded; no own totals_complete shim any more
        report = RP.validate_package({"probe-summary.json": raw, "graph.json": parts["graph.json"], "roles.json": parts["roles.json"]})
        self.assertEqual(report["errors"], [])
        self.assertIn("aspen-probe/1 (older probe), upgraded to aspen-probe/1.1", text(report["warnings"]))
        self.assertEqual(RP.describe({"probe-summary.json": raw})["migrated_from"], "aspen-probe/1")
        mch = RP.validate_package({"probe-summary.json": load("live", "live_mch_summary.json")})
        self.assertEqual(mch["errors"], [])
        self.assertIn("upgraded", text(mch["warnings"]))
        self.assertFalse(hasattr(RP, "_legacy_totals_complete"))
        with self.assertRaises(RP.PackageError):
            RP.build_package(dict(raw, schema="aspen-probe/0.9"))

    def test_group_totals_are_read_and_checked_against_the_block_rows(self):
        summary = load("probe", "heatrecovery.probe-summary.json")
        g = summary["group_totals"]
        self.assertEqual(set(g), {"heating", "cooling", "shaft_work", "internal_exchange", "overall"})
        self.assertTrue(all(set(v) == {"kW", "complete"} for v in g.values()))
        # overall = signed heating + cooling + shaft_work; internal exchange excluded
        self.assertAlmostEqual(g["overall"]["kW"], g["heating"]["kW"] + g["cooling"]["kW"] + g["shaft_work"]["kW"], places=5)
        self.assertGreater(g["internal_exchange"]["kW"], 40)
        self.assertEqual(RP.describe({"probe-summary.json": summary})["group_totals"], g)
        for key, kw, expect in (("overall", g["overall"]["kW"] + g["internal_exchange"]["kW"], "group_totals.overall.kW is"),
                                ("heating", g["heating"]["kW"] + 1, "group_totals.heating.kW is")):
            bad = copy.deepcopy(summary)
            bad["group_totals"][key]["kW"] = kw
            self.assertIn(expect, text(RP.validate_package({"probe-summary.json": bad})["errors"]))
        bad = copy.deepcopy(summary)
        bad["group_totals"]["cooling"]["complete"] = False
        self.assertIn("group_totals.cooling.complete", text(RP.validate_package({"probe-summary.json": bad})["errors"]))
        bad = copy.deepcopy(summary)
        bad["totals_kW"]["work"] += 3
        self.assertIn("totals_kW.work differs", text(RP.validate_package({"probe-summary.json": bad})["errors"]))

    def test_null_member_makes_the_group_and_overall_null_and_incomplete(self):
        summary = copy.deepcopy(load("probe", "heatrecovery.probe-summary.json"))
        pump = next(b for b in summary["blocks"] if b["id"] == "PUMP")
        pump["energy"][0]["kW"] = None
        pump["energy"][0]["note"] = "unit not understood"
        summary["totals_kW"]["work"] = None
        summary["totals_complete"] = False
        summary["group_totals"] = {k: dict(v, complete=False) for k, v in summary["group_totals"].items()}
        summary["group_totals"]["shaft_work"]["kW"] = None
        summary["group_totals"]["overall"]["kW"] = None
        report = RP.validate_package({"probe-summary.json": summary})
        self.assertEqual(report["errors"], [])
        self.assertIn("energy totals are incomplete", text(report["warnings"]))
        summary["group_totals"]["overall"]["kW"] = 1.0            # a number although a member is null
        self.assertIn("group_totals.overall.kW", text(RP.validate_package({"probe-summary.json": summary})["errors"]))

    def test_top_level_unverified_paths_and_energy_gaps_are_handled(self):
        summary = copy.deepcopy(load("probe", "mch.probe-summary.json"))
        summary["unverified_paths"] = [{"block": None, "path": "非 MIXED 子流股 CISOLID", "reason": "没有真机样本"},
                                       {"block": "B1", "path": r"\Data\Blocks\B1\Output\QCALC", "reason": "未验证"}]
        report = RP.validate_package({"probe-summary.json": summary})
        self.assertEqual(report["errors"], [])
        self.assertIn("2 node read(s) are not yet verified", text(report["warnings"]))
        self.assertEqual(RP.describe({"probe-summary.json": summary})["unverified_paths"], 2)
        summary["energy_gaps"] = [{"block": "NOPE", "path": "x", "reason": "r"}]
        self.assertIn("energy_gaps names unknown block 'NOPE'", text(RP.validate_package({"probe-summary.json": summary})["errors"]))
        summary["energy_gaps"] = ["old string entry"]                        # 1.0 shape inside a 1.1 file is a schema error
        self.assertTrue(RP.validate_package({"probe-summary.json": summary})["errors"])
        legacy = load("live", "live_hr_summary.json")
        legacy["discovery"]["unverified_paths"] = ["Compr: WNET"]
        up = RP.normalize_summary(legacy)
        self.assertEqual(up["unverified_paths"][0]["block"], None)
        self.assertNotIn("unverified_paths", up["discovery"])

    def test_roles_review_state_reviewed_clears_the_confirm_warning(self):
        """Schema states are auto_draft / partially_reviewed / reviewed ('confirmed' does not exist)."""
        parts = hr_parts(with_advice=False)
        self.assertEqual(parts["roles.json"]["review"]["state"], "auto_draft")
        self.assertIn("auto_draft", text(RP.validate_package(parts)["warnings"]))
        partial = copy.deepcopy(parts)
        partial["roles.json"]["review"] = {"state": "partially_reviewed", "pending": ["streams.S7"]}
        warnings = text(RP.validate_package(partial)["warnings"])
        self.assertIn("partially reviewed (1 item(s) pending)", warnings)
        self.assertNotIn("auto_draft", warnings)
        reviewed = copy.deepcopy(parts)
        reviewed["roles.json"]["review"] = {"state": "reviewed", "reviewer": "roice", "pending": []}
        report = RP.validate_package(reviewed)
        self.assertEqual(report["errors"], [])
        self.assertNotIn("review", text(report["warnings"]).replace("reviewer", ""))
        self.assertNotIn("roles are", text(report["warnings"]))
        confirmed = copy.deepcopy(parts)
        confirmed["roles.json"]["review"]["state"] = "confirmed"       # not a schema state: rejected, not silently accepted
        self.assertTrue(any(e.startswith("roles.json:") for e in RP.validate_package(confirmed)["errors"]))

    def test_write_read_zip_round_trip_is_identical_for_dir_zip_and_loose_file(self):
        parts = hr_parts()
        with tempfile.TemporaryDirectory() as d:
            paths = RP.write_package(d, parts)
            self.assertEqual([p.name for p in paths], list(RP.PACKAGE_FILES))
            self.assertEqual(RP.read_package(d), parts)
            self.assertEqual(RP.read_package(Path(d) / "graph.json"), parts)       # siblings are picked up
            blob = RP.zip_bytes(parts)
            Path(d, "p.zip").write_bytes(blob)
            self.assertEqual(RP.read_package(Path(d, "p.zip")), parts)
            self.assertEqual(RP.read_package(blob), parts)
            self.assertEqual(RP.zip_bytes(parts), blob, "deterministic")
            self.assertEqual(RP.read_package(parts), parts)
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            self.assertEqual(z.namelist(), list(RP.PACKAGE_FILES))

    def test_writing_a_1_0_package_stores_1_1_and_skips_absent_optional_files(self):
        raw = load("live", "live_hr_summary.json")
        with tempfile.TemporaryDirectory() as d:
            RP.write_package(d, {"probe-summary.json": raw})
            self.assertEqual([p.name for p in Path(d).iterdir()], ["probe-summary.json"])
            stored = json.loads(Path(d, "probe-summary.json").read_text(encoding="utf-8"))
            self.assertEqual(stored["schema"], "aspen-probe/1.1")
            self.assertEqual(RP.main(["check", d]), 0)
        with zipfile.ZipFile(io.BytesIO(RP.zip_bytes({"probe-summary.json": raw}))) as z:
            self.assertEqual(z.namelist(), ["probe-summary.json"])

    def test_zip_with_a_single_folder_and_extra_files_is_accepted_including_bros_bundle(self):
        parts = hr_parts()
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as z:
            for name in RP.PACKAGE_FILES:
                z.writestr("run-1/" + name, json.dumps(parts[name]))
            z.writestr("run-1/notes.txt", "ignored")
        self.assertEqual(RP.read_package(buffer.getvalue()), parts)
        bundle = RP.read_package((FIX / "probe" / "heatrecovery.bundle.zip").read_bytes())      # BRO's upload bundle (probe/ folder)
        self.assertEqual(sorted(bundle), ["graph.json", "probe-summary.json", "roles.json"])
        self.assertEqual(RP.validate_package(bundle)["errors"], [])

    def test_hostile_or_broken_archives_are_rejected(self):
        def make(entries):
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w") as z:
                for name, data in entries:
                    z.writestr(name, data)
            return buffer.getvalue()
        with self.assertRaises(RP.PackageError):
            RP.read_package(b"not a zip")
        with self.assertRaises(RP.PackageError) as ctx:
            RP.read_package(make([("../graph.json", "{}")]))
        self.assertIn("unsafe path", ctx.exception.problems[0])
        with self.assertRaises(RP.PackageError):
            RP.read_package(make([("a/graph.json", "{}"), ("b/graph.json", "{}")]))
        with self.assertRaises(RP.PackageError) as ctx:
            RP.read_package(make([("advice.json", "{not json")]))
        self.assertIn("not valid UTF-8 JSON", ctx.exception.problems[0])
        self.assertEqual(RP.read_package(make([("readme.txt", "x")])), {})

    def test_schema_violations_and_each_optional_file_are_checked(self):
        parts = hr_parts()
        bad = copy.deepcopy(parts)
        bad["graph.json"]["schema"] = "aspen-model-graph/9"
        self.assertTrue(any(e.startswith("graph.json:") for e in RP.validate_package(bad)["errors"]))
        bad = copy.deepcopy(parts)
        bad["advice.json"]["counts"]["total"] = "many"
        self.assertTrue(any(e.startswith("advice.json:") for e in RP.validate_package(bad)["errors"]))
        with self.assertRaises(RP.PackageError):
            RP.write_package(tempfile.gettempdir() + "/never", bad)
        with self.assertRaises(RP.PackageError):
            RP.zip_bytes(bad)

    def test_cross_file_consistency_uses_advice_package_problems(self):
        parts = hr_parts()
        other = copy.deepcopy(parts)
        other["roles.json"]["model_sha256"] = "0" * 64
        self.assertIn("来自不同的模型", text(RP.validate_package(other)["errors"]))
        other = copy.deepcopy(parts)
        other["probe-summary.json"]["blocks"].pop()
        other["probe-summary.json"]["group_totals"] = RP.group_totals(other["probe-summary.json"]["blocks"], True)
        self.assertIn("块不一致", text(RP.validate_package(other)["errors"]))
        other = copy.deepcopy(parts)
        other["roles.json"]["streams"].pop("S7")
        self.assertIn("roles.json 的流股与 graph.json 的流股不一致", text(RP.validate_package(other)["errors"]))
        other = copy.deepcopy(parts)
        other["probe-summary.json"]["model"]["source_unchanged"] = False
        self.assertIn("source_unchanged=false", text(RP.validate_package(other)["errors"]))
        other = copy.deepcopy(parts)
        other["advice.json"]["model"]["sha256"] = "1" * 64
        self.assertIn("advice.json is for a different model", text(RP.validate_package(other)["errors"]))
        with self.assertRaises(RP.PackageError):
            RP.build_package(load("probe", "mch.probe-summary.json"), load("probe", "heatrecovery.graph.json"), with_advice=True)

    def test_error_state_is_valid_but_flagged(self):
        parts = copy.deepcopy(hr_parts(with_advice=False))
        parts["probe-summary.json"]["status"].update(state="error", errors=["块 X：BLKSTAT=3"], run_completed=False)
        report = RP.validate_package(parts)
        self.assertEqual(report["errors"], [])
        self.assertTrue(any("reported errors" in w and "BLKSTAT=3" in w for w in report["warnings"]))

    def test_probe_dir_without_roles_gets_a_drafted_roles_file_and_advice(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, "probe-summary.json").write_text(json.dumps(load("probe", "heatrecovery.probe-summary.json")), encoding="utf-8")
            Path(d, "graph.json").write_text(json.dumps(load("probe", "heatrecovery.graph.json")), encoding="utf-8")
            parts = RP.package_from_probe_dir(d, with_advice=True)
            self.assertEqual(parts["roles.json"]["review"]["state"], "auto_draft")
            self.assertEqual(parts["advice.json"]["inputs"], {"probe": "aspen-probe/1.1", "migrated_from": "aspen-probe/1",
                                                              "graph": True, "roles": True})
            self.assertEqual(parts["advice.json"], advise(parts["probe-summary.json"], parts["graph.json"], parts["roles.json"]))
            Path(d, "graph.json").unlink()
            with self.assertRaises(RP.ProbeOutputMissing) as ctx:
                RP.package_from_probe_dir(d)
            self.assertEqual(ctx.exception.problems, ["probe wrote no graph.json"])

    def test_cli_check_and_zip(self):
        parts = hr_parts(with_advice=False)
        with tempfile.TemporaryDirectory() as d:
            RP.write_package(d, parts)
            self.assertEqual(RP.main(["check", d]), 0)
            self.assertEqual(RP.main(["zip", d, "-o", str(Path(d) / "out.zip")]), 0)
            self.assertIn("advice.json", zipfile.ZipFile(Path(d) / "out.zip").namelist())
            self.assertEqual(RP.main(["zip", d, "-o", str(Path(d) / "plain.zip"), "--no-advice"]), 0)
            self.assertNotIn("advice.json", zipfile.ZipFile(Path(d) / "plain.zip").namelist())
            self.assertEqual(RP.main(["check", str(Path(d) / "out.zip")]), 0)
            Path(d, "probe-summary.json").unlink()
            self.assertEqual(RP.main(["check", d]), 1)


if __name__ == "__main__":
    unittest.main()
