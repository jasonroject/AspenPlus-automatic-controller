"""Result package (probe-summary.json + graph.json + roles.json): the single input format of local and online paths."""
import copy
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from aspen_study import result_package as RP

LIVE = Path(__file__).resolve().parent / "fixtures/live"


def live(name):
    return json.loads((LIVE / name).read_text(encoding="utf-8"))


def hr_parts():
    return RP.build_package(live("live_hr_summary.json"), live("live_hr_graph.json"))


class PackageTests(unittest.TestCase):
    def test_real_heatrecovery_probe_builds_and_validates(self):
        parts = hr_parts()
        self.assertEqual(tuple(parts), RP.PACKAGE_FILES)
        report = RP.validate_package(parts)
        self.assertEqual(report["errors"], [])
        text = " | ".join(report["warnings"])
        self.assertIn("completed with warnings", text)
        self.assertIn("COOLER", text)
        self.assertIn("auto_draft", text)
        self.assertIn("no totals_complete", text)          # the real file predates that required field: derived, not rejected
        self.assertEqual(parts["roles.json"]["model_sha256"], parts["probe-summary.json"]["model"]["sha256"])
        info = RP.describe(parts)
        self.assertEqual((info["model"], info["state"], info["blocks"], info["streams"]), ("heatrecovery.bkp", "warning", 7, 10))

    def test_summary_file_itself_is_not_rewritten(self):
        summary = live("live_hr_summary.json")
        before = copy.deepcopy(summary)
        RP.build_package(summary, live("live_hr_graph.json"))
        self.assertEqual(summary, before)
        self.assertNotIn("totals_complete", summary)

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

    def test_zip_with_a_single_folder_and_extra_files_is_accepted(self):
        parts = hr_parts()
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as z:
            for name in RP.PACKAGE_FILES:
                z.writestr("run-1/" + name, json.dumps(parts[name]))
            z.writestr("run-1/notes.txt", "ignored")
        self.assertEqual(RP.read_package(buffer.getvalue()), parts)

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
            RP.read_package(make([("graph.json", "{not json")]))
        self.assertIn("not valid UTF-8 JSON", ctx.exception.problems[0])
        self.assertEqual(RP.read_package(make([("readme.txt", "x")])), {})

    def test_missing_files_and_schema_violations_are_listed(self):
        parts = hr_parts()
        self.assertEqual(RP.validate_package({"graph.json": parts["graph.json"]})["errors"],
                         ["missing probe-summary.json", "missing roles.json"])
        bad = copy.deepcopy(parts)
        bad["graph.json"]["schema"] = "aspen-model-graph/9"
        self.assertTrue(any(e.startswith("graph.json:") for e in RP.validate_package(bad)["errors"]))
        with self.assertRaises(RP.PackageError):
            RP.write_package(tempfile.gettempdir() + "/never", bad)
        with self.assertRaises(RP.PackageError):
            RP.zip_bytes(bad)

    def test_cross_file_consistency(self):
        parts = hr_parts()
        other = copy.deepcopy(parts)
        other["roles.json"]["model_sha256"] = "0" * 64
        self.assertIn("different models", " ".join(RP.validate_package(other)["errors"]))
        other = copy.deepcopy(parts)
        other["probe-summary.json"]["blocks"].pop()
        self.assertIn("blocks differ from graph.json", " ".join(RP.validate_package(other)["errors"]))
        other = copy.deepcopy(parts)
        other["roles.json"]["streams"].pop("S7")
        self.assertIn("roles.json streams differ", " ".join(RP.validate_package(other)["errors"]))
        other = copy.deepcopy(parts)
        other["probe-summary.json"]["model"]["source_unchanged"] = False
        self.assertIn("source model file changed", " ".join(RP.validate_package(other)["errors"]))

    def test_error_state_is_valid_but_flagged(self):
        parts = copy.deepcopy(hr_parts())
        parts["probe-summary.json"]["status"].update(state="error", errors=["块 X：BLKSTAT=3"], run_completed=False)
        report = RP.validate_package(parts)
        self.assertEqual(report["errors"], [])
        self.assertTrue(any("reported errors" in w and "BLKSTAT=3" in w for w in report["warnings"]))

    def test_normal_mch_summary_has_no_run_warning(self):
        summary = live("live_mch_summary.json")
        self.assertEqual(summary["status"]["state"], "ok")
        report = RP.validate_package({"probe-summary.json": summary, **{k: v for k, v in hr_parts().items() if k != "probe-summary.json"}})
        self.assertTrue(any("different models" in e for e in report["errors"]))   # mch summary + heatrecovery graph: refused

    def test_probe_dir_without_roles_gets_a_drafted_roles_file(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, "probe-summary.json").write_text(json.dumps(live("live_hr_summary.json")), encoding="utf-8")
            Path(d, "graph.json").write_text(json.dumps(live("live_hr_graph.json")), encoding="utf-8")
            parts = RP.package_from_probe_dir(d)
            self.assertEqual(parts["roles.json"]["review"]["state"], "auto_draft")
            Path(d, "graph.json").unlink()
            with self.assertRaises(RP.PackageError) as ctx:
                RP.package_from_probe_dir(d)
            self.assertEqual(ctx.exception.problems, ["probe wrote no graph.json"])

    def test_cli_check_and_zip(self):
        parts = hr_parts()
        with tempfile.TemporaryDirectory() as d:
            RP.write_package(d, parts)
            self.assertEqual(RP.main(["check", d]), 0)
            self.assertEqual(RP.main(["zip", d, "-o", str(Path(d) / "out.zip")]), 0)
            self.assertEqual(RP.main(["check", str(Path(d) / "out.zip")]), 0)
            Path(d, "graph.json").unlink()
            self.assertEqual(RP.main(["check", d]), 1)


if __name__ == "__main__":
    unittest.main()
