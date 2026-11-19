"""serve_web.py --local: POST /api/local/probe runs the probe (mocked here: the box has no Aspen) and returns the
same package the online site accepts by upload."""
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import serve_web
from aspen_study import result_package as RP
from aspen_study.advice import advise
from aspen_study.schema_check import validate

FIX = Path(__file__).resolve().parent / "fixtures"
PROBE, LIVE = FIX / "probe", FIX / "live"


class FakeProbe:
    """Stands in for `python -m aspen_study probe --no-study`: writes what the real one writes (summary + graph) from the
    real heatrecovery run: aspen-probe/1.1 by default, or the real aspen-probe/1 file with legacy=True."""

    def __init__(self, code=0, files=("probe-summary.json", "graph.json"), hold=None, legacy=False):
        self.code, self.files, self.hold, self.legacy, self.calls = code, files, hold, legacy, []

    def __call__(self, model, out_dir, timeout_s):
        self.calls.append((Path(model), Path(out_dir), timeout_s))
        if self.hold:
            self.hold.wait(5)
        names = {"probe-summary.json": (LIVE / "live_hr_summary.json") if self.legacy else (PROBE / "heatrecovery.probe-summary.json"),
                 "graph.json": PROBE / "heatrecovery.graph.json"}
        for name in self.files:
            Path(out_dir, name).write_text(names[name].read_text(encoding="utf-8"), encoding="utf-8")
        return self.code, "probe output", "probe stderr" if self.code else ""


class LocalModeTests(unittest.TestCase):
    def serve(self, probe, local=True):
        server = serve_web.create_server(0, local=local, probe_runner=probe)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close(), thread.join(5)))
        return server.server_address[1]

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.model = Path(self.dir.name) / "heatrecovery.bkp"
        self.model.write_bytes(b"fake")

    def request(self, port, method, path, body=None, headers=None, raw=False):
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        h = {"Content-Type": "application/json"} if data is not None else {}
        h.update(headers or {})
        conn.request(method, path, data, h)
        r = conn.getresponse()
        payload = r.read()
        conn.close()
        return r.status, (payload if raw else (json.loads(payload) if r.getheader("Content-Type", "").startswith("application/json") else payload))

    def test_probe_returns_the_same_package_the_upload_path_validates(self):
        probe = FakeProbe(code=0)
        port = self.serve(probe)
        status, reply = self.request(port, "POST", "/api/local/probe", {"model_path": str(self.model), "timeout": 90})
        self.assertEqual(status, 200)
        self.assertEqual(list(reply["files"]), list(RP.PACKAGE_FILES))
        self.assertEqual((reply["state"], reply["exit_code"]), ("warning", 0))
        self.assertEqual(reply["summary"]["model"], "heatrecovery.bkp")
        self.assertTrue(any("completed with warnings" in w for w in reply["warnings"]))
        # advice.json is part of the package: advice.advise(summary, graph, roles), schema-valid, BRO's golden output
        advice = reply["files"]["advice.json"]
        validate(advice, "advice")
        self.assertEqual(advice, json.loads((PROBE / "heatrecovery.advice.json").read_text(encoding="utf-8")))
        self.assertEqual(advice, advise(reply["files"]["probe-summary.json"], reply["files"]["graph.json"], reply["files"]["roles.json"]))
        self.assertEqual(reply["summary"]["advice"]["total"], advice["counts"]["total"])
        self.assertEqual(reply["files"]["probe-summary.json"]["schema"], "aspen-probe/1.1")
        # the model path and timeout reach the probe; model is a path on this PC, never uploaded
        [(model, out_dir, timeout_s)] = probe.calls
        self.assertEqual((model, timeout_s), (self.model, 90))
        # identical input format for both paths: what local mode returns == what the upload path would read and accept
        self.assertEqual(RP.validate_package(reply["files"])["errors"], [])
        status, blob = self.request(port, "GET", reply["zip_url"])
        self.assertEqual(status, 200)
        self.assertEqual(RP.read_package(blob), reply["files"])
        self.assertEqual(RP.validate_package(RP.read_package(blob)), RP.validate_package(reply["files"]))

    def test_legacy_1_0_probe_output_is_upgraded_in_the_package(self):
        port = self.serve(FakeProbe(legacy=True))
        status, reply = self.request(port, "POST", "/api/local/probe", {"model_path": str(self.model)})
        self.assertEqual(status, 200)
        self.assertEqual(reply["files"]["probe-summary.json"]["schema"], "aspen-probe/1.1")
        self.assertEqual(reply["files"]["probe-summary.json"]["migrated_from"], "aspen-probe/1")
        self.assertTrue(any("upgraded to aspen-probe/1.1" in w for w in reply["warnings"]))
        self.assertEqual(RP.validate_package(reply["files"])["errors"], [])
        self.assertEqual(reply["files"]["advice.json"]["inputs"]["migrated_from"], "aspen-probe/1")

    def test_default_probe_command_line(self):
        calls = []

        class Done:
            returncode, stdout, stderr = 3, "", "错误：找不到 Aspen"

        with patch.object(serve_web.subprocess, "run", lambda *a, **kw: calls.append((a, kw)) or Done()):
            code, out, err = serve_web.run_probe_subprocess(self.model, "OUT", 300)
        [(args, kwargs)] = calls
        command = args[0]
        self.assertEqual(command[1:4], ["-X", "utf8", "-m"])
        self.assertEqual(command[4:6], ["aspen_study", "probe"])
        self.assertEqual(command[6:], [str(self.model), "--out-dir", "OUT", "--timeout", "300", "--no-study"])
        self.assertEqual(Path(kwargs["cwd"]), serve_web.REPO_ROOT)
        self.assertEqual(kwargs["timeout"], 420)
        self.assertEqual(code, 3)

    def test_probe_exit_code_1_means_aspen_errors_but_a_package_still_comes_back(self):
        port = self.serve(FakeProbe(code=1))
        status, reply = self.request(port, "POST", "/api/local/probe", {"model_path": str(self.model)})
        self.assertEqual((status, reply["exit_code"]), (200, 1))
        self.assertEqual(RP.validate_package(reply["files"])["errors"], [])

    def test_probe_failure_without_files_is_a_502_with_the_reason(self):
        port = self.serve(FakeProbe(code=3, files=()))
        status, reply = self.request(port, "POST", "/api/local/probe", {"model_path": str(self.model)})
        self.assertEqual(status, 502)
        self.assertEqual(reply["exit_code"], 3)
        self.assertIn("probe wrote no probe-summary.json", reply["error"])
        self.assertIn("probe stderr", reply["error"])

    def test_inconsistent_probe_output_blocks_the_package(self):
        """advice.package_problems: nothing is emitted (no files, no zip, no advice) and the reasons come back (422)."""
        def tamper(change):
            class Tampered(FakeProbe):
                def __call__(self, model, out_dir, timeout_s):
                    super().__call__(model, out_dir, timeout_s)
                    path = Path(out_dir, change[0])
                    data = json.loads(path.read_text(encoding="utf-8"))
                    change[1](data)
                    path.write_text(json.dumps(data), encoding="utf-8")
                    return 0, "", ""
            return Tampered()

        cases = [(("graph.json", lambda g: g["model"].__setitem__("sha256", "f" * 64)), "来自不同的模型"),
                 (("probe-summary.json", lambda s: s["model"].__setitem__("source_unchanged", False)), "source_unchanged=false"),
                 (("graph.json", lambda g: g["blocks"].pop()), "块不一致")]
        for change, text in cases:
            with self.subTest(text=text):
                port = self.serve(tamper(change))
                status, reply = self.request(port, "POST", "/api/local/probe", {"model_path": str(self.model)})
                self.assertEqual(status, 422)
                self.assertTrue(any(text in p for p in reply["problems"]), reply)
                self.assertNotIn("files", reply)
                self.assertNotIn("zip_url", reply)
                self.assertEqual(self.request(port, "GET", "/api/local/package/p1.zip")[0], 404)

    def test_probe_summary_that_fails_its_schema_is_422_not_a_traceback(self):
        class Broken(FakeProbe):
            def __call__(self, model, out_dir, timeout_s):
                super().__call__(model, out_dir, timeout_s)
                Path(out_dir, "probe-summary.json").write_text(json.dumps({"schema": "aspen-probe/1.1"}), encoding="utf-8")
                return 0, "", ""

        port = self.serve(Broken())
        status, reply = self.request(port, "POST", "/api/local/probe", {"model_path": str(self.model)})
        self.assertEqual(status, 422)
        self.assertTrue(reply["problems"])

    def test_bad_requests(self):
        probe = FakeProbe()
        port = self.serve(probe)
        bad = [({"model_path": str(self.model) + "x.bkp"}, "not found"),
               ({"model_path": str(Path(self.dir.name) / "m.txt")}, "unsupported model file type"),
               ({}, "model_path"), ({"model_path": 5}, "model_path"),
               ({"model_path": str(self.model), "timeout": 0}, "timeout"),
               ({"model_path": str(self.model), "timeout": "soon"}, "timeout"),
               ([1], "JSON object")]
        for body, text in bad:
            status, reply = self.request(port, "POST", "/api/local/probe", body)
            self.assertEqual(status, 400, body)
            self.assertIn(text, reply["error"], body)
        self.assertEqual(probe.calls, [], "no probe was started for a bad request")
        self.assertEqual(self.request(port, "POST", "/api/local/probe", b"{bad")[0], 400)
        self.assertEqual(self.request(port, "POST", "/api/local/probe", {"model_path": "x"}, {"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request(port, "POST", "/api/local/probe", b"x" * (serve_web.MAX_REQUEST_BYTES + 1))[0], 400)

    def test_cross_site_and_rebinding_requests_are_refused(self):
        probe = FakeProbe()
        port = self.serve(probe)
        body = {"model_path": str(self.model)}
        self.assertEqual(self.request(port, "POST", "/api/local/probe", body, {"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.request(port, "POST", "/api/local/probe", body, {"Host": "evil.example"})[0], 403)
        self.assertEqual(self.request(port, "GET", "/api/local/status", None, {"Host": "evil.example"})[0], 403)
        self.assertEqual(probe.calls, [])
        self.assertEqual(self.request(port, "POST", "/api/local/probe", body, {"Origin": f"http://localhost:{port}"})[0], 200)

    def test_only_one_probe_at_a_time(self):
        hold = threading.Event()
        probe = FakeProbe(hold=hold)
        port = self.serve(probe)
        first = {}
        thread = threading.Thread(target=lambda: first.update(zip(("status", "reply"),
                                  self.request(port, "POST", "/api/local/probe", {"model_path": str(self.model)}))))
        thread.start()
        for _ in range(200):
            if probe.calls:
                break
            threading.Event().wait(0.01)
        status, reply = self.request(port, "POST", "/api/local/probe", {"model_path": str(self.model)})
        self.assertEqual(status, 409)
        hold.set()
        thread.join(10)
        self.assertEqual(first["status"], 200)

    def test_local_mode_is_off_by_default_and_static_files_stay_public_only(self):
        port = self.serve(FakeProbe(), local=False)
        self.assertEqual(self.request(port, "POST", "/api/local/probe", {"model_path": str(self.model)})[0], 501)
        self.assertEqual(self.request(port, "GET", "/api/local/status")[0], 404)
        local = self.serve(FakeProbe())
        status, info = self.request(local, "GET", "/api/local/status")
        self.assertEqual((status, info["package_files"]), (200, list(RP.PACKAGE_FILES)))   # incl. advice.json
        self.assertEqual(self.request(local, "GET", "/api/local/package/p99.zip")[0], 404)
        self.assertEqual(self.request(local, "GET", "/index.html")[0], 200)                  # static site still served
        self.assertEqual(self.request(local, "GET", "/data/../serve_web.py")[0], 404)

    def test_only_the_last_packages_are_kept(self):
        port = self.serve(FakeProbe())
        ids = [self.request(port, "POST", "/api/local/probe", {"model_path": str(self.model)})[1]["id"]
               for _ in range(serve_web.KEEP_PACKAGES + 1)]
        self.assertEqual(self.request(port, "GET", f"/api/local/package/{ids[0]}.zip")[0], 404)
        self.assertEqual(self.request(port, "GET", f"/api/local/package/{ids[-1]}.zip")[0], 200)


if __name__ == "__main__":
    unittest.main()
