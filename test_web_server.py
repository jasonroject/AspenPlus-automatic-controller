"""Fast local-web regression checks; these tests never create an Aspen process."""
import copy
import http.client
import json
import math
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from web_server import AutomationService, BusyError, LocalServer, enrich_catalog, validate_plan


TEMPERATURE = "Blocks.REACTOR.TEMP"
PRESSURE = "Blocks.PUMP.PRES"
CATALOG = {
    TEMPERATURE: {"path": r"\Data\Blocks\REACTOR\Input\TEMP", "value": 623.0, "unit": "K"},
    PRESSURE: {"path": r"\Data\Blocks\PUMP\Input\PRES", "value": 25.0, "unit": "bar"},
}


class FakeRunner:
    def __init__(self, directory, entered=None, release=None):
        self.directory = directory
        self.entered = entered
        self.release = release
        self.calls = []
        self.batch_results = []

    def run_single(self, parameters, index, name):
        self.calls.append((copy.deepcopy(parameters), index, name))
        if self.entered is not None:
            self.entered.set()
            if not self.release.wait(3):
                raise RuntimeError("test worker was not released")
        return {"status": "success", "parameters": parameters, "name": name, "run_id": index}

    def save_batch_summary(self):
        json_file = self.directory / "summary.json"
        csv_file = self.directory / "summary.csv"
        json_file.write_text(json.dumps(self.batch_results), encoding="utf-8")
        # The real BatchRunner writes no summary CSV if no rows ran.
        if self.batch_results:
            csv_file.write_text("name,status\nfirst,success\n", encoding="utf-8")
        (self.directory / "batch_stream_components.csv").write_text("物流,组分\nOUT,WATER\n", encoding="utf-8")
        return json_file, csv_file, self.directory


class WebFixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="aspen-web-test-")
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.model = self.directory / "model.bkp"
        self.model.write_bytes(b"fake model, never opened with Aspen")

    def plan(self):
        return {
            "model_path": str(self.model),
            "parameter_catalog": copy.deepcopy(CATALOG),
            "parameter_columns": [TEMPERATURE, PRESSURE],
            "parameter_sets": [
                {"_name": "联合工况", "parameters": {TEMPERATURE: "613", PRESSURE: "30"}},
                {"_name": "模型原值", "parameters": {TEMPERATURE: " ", PRESSURE: None}},
            ],
        }

    def service(self, scanner=None, runner=None):
        runner = runner or FakeRunner(self.directory)
        service = AutomationService(
            scanner=scanner or (lambda model: copy.deepcopy(CATALOG)),
            runner_factory=lambda model, catalog: runner,
        )
        service.known_models = lambda: []
        return service

    def join_worker(self, service):
        service.worker.join(3)
        self.assertFalse(service.worker.is_alive(), "worker did not finish promptly")


class PlanValidationTests(WebFixture):
    def test_multiple_columns_and_blank_baseline_row_are_preserved(self):
        source = self.plan()
        original = copy.deepcopy(source)
        model, catalog, columns, rows = validate_plan(source)
        self.assertEqual(model, self.model.resolve())
        self.assertEqual(columns, [TEMPERATURE, PRESSURE])
        self.assertEqual(rows[0]["parameters"], {TEMPERATURE: 613.0, PRESSURE: 30.0})
        self.assertEqual(rows[1], {"_name": "模型原值", "parameters": {}})
        self.assertEqual(source, original, "validation must not mutate an imported plan")
        self.assertEqual(catalog[TEMPERATURE]["unit"], "K")
        self.assertTrue(catalog[TEMPERATURE]["title"])

    def test_legacy_column_order_can_be_inferred(self):
        source = self.plan()
        del source["parameter_columns"]
        self.assertEqual(validate_plan(source)[2], [TEMPERATURE, PRESSURE])

    def test_malformed_rows_are_rejected_before_column_inference(self):
        for parameters in (None, [], "TEMP"):
            with self.subTest(parameters=parameters):
                source = self.plan()
                del source["parameter_columns"]
                source["parameter_sets"] = [{"parameters": parameters}]
                with self.assertRaises(ValueError):
                    validate_plan(source)

    def test_nonfinite_numeric_values_are_rejected_even_for_text_parameters(self):
        source = self.plan()
        source["parameter_catalog"][TEMPERATURE]["value"] = "AUTO"
        source["parameter_sets"][0]["parameters"][TEMPERATURE] = float("nan")
        with self.assertRaises(ValueError):
            validate_plan(source)

    def test_unknown_unselected_and_duplicate_columns_are_rejected(self):
        for columns in (["unknown"], [TEMPERATURE], [TEMPERATURE, TEMPERATURE]):
            with self.subTest(columns=columns):
                source = self.plan()
                source["parameter_columns"] = columns
                with self.assertRaises(ValueError):
                    validate_plan(source)

    def test_aliases_cannot_write_the_same_node_twice(self):
        source = self.plan()
        source["parameter_catalog"]["alias"] = copy.deepcopy(CATALOG[TEMPERATURE])
        source["parameter_columns"].append("alias")
        with self.assertRaisesRegex(ValueError, "同一"):
            validate_plan(source)

    def test_nonfinite_numeric_and_non_scalar_values_are_rejected(self):
        for value in (float("nan"), float("inf"), "NaN", "Infinity", [], {}, True):
            with self.subTest(value=value):
                source = self.plan()
                source["parameter_sets"][0]["parameters"][TEMPERATURE] = value
                with self.assertRaises(ValueError):
                    validate_plan(source)

    def test_malformed_rows_and_columns_are_rejected(self):
        for field, value in (
            ("parameter_sets", []), ("parameter_sets", {}),
            ("parameter_sets", [None]), ("parameter_sets", [{"parameters": []}]),
            ("parameter_sets", [{"parameters": None}]),
            ("parameter_columns", "TEMP"), ("parameter_columns", [3]),
        ):
            with self.subTest(field=field, value=value):
                source = self.plan()
                source[field] = value
                with self.assertRaises(ValueError):
                    validate_plan(source)

    def test_only_existing_absolute_bkp_paths_are_accepted(self):
        for path in ("model.bkp", str(self.directory / "missing.bkp"), str(self.directory / "model.txt")):
            with self.subTest(path=path):
                source = self.plan()
                source["model_path"] = path
                with self.assertRaises(ValueError):
                    validate_plan(source)

    def test_catalog_has_labels_and_rejects_noninput_paths(self):
        enriched = enrich_catalog(CATALOG)
        self.assertEqual(enriched[TEMPERATURE]["owner"], "REACTOR")
        self.assertEqual(enriched[TEMPERATURE]["section"], "Blocks")
        self.assertIsInstance(enriched[TEMPERATURE]["common"], bool)
        self.assertTrue(enriched[TEMPERATURE]["detail"])
        for path in (r"\Data\Blocks\REACTOR\Output\TEMP", r"\Data\Blocks\..\Input\TEMP", "TEMP"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                enrich_catalog({"bad": {"path": path, "value": 1}})


class ServiceTests(WebFixture):
    def test_scan_enriches_catalog_without_changing_model(self):
        calls = []
        def scanner(model):
            calls.append(model)
            return copy.deepcopy(CATALOG)
        service = self.service(scanner=scanner)
        service.start_scan({"model_path": str(self.model)})
        self.join_worker(service)
        state = service.state()
        self.assertEqual(calls, [self.model.resolve()])
        self.assertEqual(state["job"]["status"], "completed")
        self.assertFalse(state["busy"])
        self.assertIn("title", state["catalog"][TEMPERATURE])
        state["catalog"].clear()
        self.assertEqual(len(service.catalog), 2, "state must be an isolated snapshot")
        self.assertEqual(self.model.read_bytes(), b"fake model, never opened with Aspen")

    def test_busy_guard_covers_scan_run_and_import(self):
        entered, release = threading.Event(), threading.Event()
        def scanner(model):
            entered.set()
            if not release.wait(3):
                raise RuntimeError("scanner was not released")
            return copy.deepcopy(CATALOG)
        service = self.service(scanner=scanner)
        service.start_scan({"model_path": str(self.model)})
        try:
            self.assertTrue(entered.wait(1))
            for method, payload in ((service.start_scan, {"model_path": str(self.model)}),
                                    (service.start_run, self.plan()),
                                    (service.catalog_import, self.plan())):
                with self.subTest(method=method.__name__), self.assertRaises(BusyError):
                    method(payload)
        finally:
            release.set()
            self.join_worker(service)

    def test_stop_finishes_current_row_and_preserves_entire_plan(self):
        entered, release = threading.Event(), threading.Event()
        runner = FakeRunner(self.directory, entered, release)
        service = self.service(runner=runner)
        job_id = service.start_run(self.plan())["job_id"]
        try:
            self.assertTrue(entered.wait(1))
            service.stop()
            self.assertEqual(service.state()["job"]["status"], "running")
        finally:
            release.set()
            self.join_worker(service)
        state = service.state()
        self.assertEqual(len(runner.calls), 1)
        self.assertEqual(runner.calls[0][0], {TEMPERATURE: 613.0, PRESSURE: 30.0})
        self.assertEqual(state["job"]["status"], "stopped")
        self.assertEqual(state["job"]["completed"], 1)
        self.assertEqual(state["job"]["total"], 2)
        self.assertEqual(set(service.downloads[job_id]), {"summary.csv", "summary.json", "plan.json", "components.csv"})
        saved = json.loads(service.downloads[job_id]["plan.json"].read_text(encoding="utf-8"))
        self.assertEqual(saved["parameter_columns"], [TEMPERATURE, PRESSURE])
        self.assertEqual(len(saved["parameter_sets"]), 2)
        self.assertEqual(saved["parameter_sets"][1]["parameters"], {})
        self.assertEqual(state["job"]["summary_url"], f"/api/download/{job_id}/summary.csv")

    def test_complete_run_keeps_baseline_row_and_isolates_old_downloads(self):
        runner = FakeRunner(self.directory)
        service = self.service(runner=runner)
        job_id = service.start_run(self.plan())["job_id"]
        self.join_worker(service)
        self.assertEqual(service.state()["job"]["status"], "completed")
        self.assertEqual([call[0] for call in runner.calls], [{TEMPERATURE: 613.0, PRESSURE: 30.0}, {}])
        service.start_scan({"model_path": str(self.model)})
        self.join_worker(service)
        self.assertIn(job_id, service.downloads)

    def test_scan_failure_is_reported_and_releases_busy_state(self):
        def scanner(model):
            raise RuntimeError("synthetic scan failure")
        service = self.service(scanner=scanner)
        service.start_scan({"model_path": str(self.model)})
        self.join_worker(service)
        state = service.state()
        self.assertEqual(state["job"]["status"], "failed")
        self.assertIn("synthetic scan failure", state["job"]["error"])
        self.assertFalse(state["busy"])


class HttpTests(WebFixture):
    def setUp(self):
        super().setUp()
        self.web = self.directory / "web"
        self.web.mkdir()
        (self.web / "index.html").write_text("<!doctype html><title>Local test</title>", encoding="utf-8")
        (self.web / "app.js").write_text("'use strict';", encoding="utf-8")
        self.web_patch = patch("web_server.WEB_ROOT", self.web)
        self.web_patch.start()
        self.addCleanup(self.web_patch.stop)
        self.service_instance = self.service()
        self.server = LocalServer(("127.0.0.1", 0), self.service_instance)
        self.server_thread = threading.Thread(target=self.server.serve_forever,
                                              kwargs={"poll_interval": 0.02}, daemon=True)
        self.server_thread.start()
        self.addCleanup(self.close_server)
        self.port = self.server.server_address[1]

    def close_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join(2)

    def request(self, method, path, payload=None, headers=None, raw=None):
        headers = dict(headers or {})
        if payload is not None:
            raw = json.dumps(payload).encode("utf-8")
            headers.setdefault("Content-Type", "application/json")
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        try:
            connection.request(method, path, body=raw, headers=headers)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def auth(self):
        return {"X-Session-Token": self.service_instance.token,
                "Origin": f"http://127.0.0.1:{self.port}"}

    def test_state_and_static_assets_are_available_on_loopback(self):
        status, headers, body = self.request("GET", "/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["token"], self.service_instance.token)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        status, headers, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"Local test", body)
        self.assertTrue(headers["Content-Type"].startswith("text/html"))
        self.assertEqual(self.request("GET", "/app.js?v=1")[0], 200)

    def test_host_origin_and_session_token_guards(self):
        self.assertEqual(self.request("GET", "/api/state", headers={"Host": "attacker.example"})[0], 403)
        for headers in ({}, {"X-Session-Token": "wrong"},
                        {**self.auth(), "Origin": "https://attacker.example"},
                        {**self.auth(), "Host": "attacker.example"}):
            with self.subTest(headers=headers):
                self.assertEqual(self.request("POST", "/api/stop", {}, headers)[0], 403)
        self.assertEqual(self.request("POST", "/api/stop", {}, self.auth())[0], 200)

    def test_browse_model_select_cancel_and_failure_keep_existing_plan(self):
        selected = self.directory / "试验 模型.bkp"
        selected.write_bytes(b"test")
        self.service_instance.model_path = str(self.model)
        self.service_instance.catalog = copy.deepcopy(CATALOG)
        initial = str(self.model)
        calls = []
        self.service_instance.file_picker = lambda path: calls.append(path) or str(selected)
        self.assertEqual(self.request("POST", "/api/browse-model", {}, {})[0], 403)
        self.assertEqual(calls, [])
        status, _, body = self.request("POST", "/api/browse-model", {"model_path": initial}, self.auth())
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["model_path"], str(selected.resolve()))
        self.assertEqual(calls, [initial])
        self.service_instance.file_picker = lambda path: None
        status, _, body = self.request("POST", "/api/browse-model", {}, self.auth())
        self.assertEqual((status, json.loads(body)), (200, {"model_path": None}))
        self.service_instance.file_picker = lambda path: str(self.directory / "missing.bkp")
        self.assertEqual(self.request("POST", "/api/browse-model", {}, self.auth())[0], 400)
        self.assertFalse(self.service_instance.state()["busy"])
        self.assertEqual(self.service_instance.model_path, initial)
        self.assertEqual(self.service_instance.catalog, CATALOG)

    def test_open_picker_blocks_duplicate_dialog_and_simulation(self):
        entered, release = threading.Event(), threading.Event()
        def picker(path):
            entered.set()
            if not release.wait(3):
                raise ValueError("test picker was not released")
            return None
        self.service_instance.file_picker = picker
        worker = threading.Thread(target=lambda: self.service_instance.browse_model({}))
        worker.start()
        try:
            self.assertTrue(entered.wait(1))
            self.assertTrue(self.service_instance.state()["busy"])
            for endpoint, payload in (("/api/browse-model", {}), ("/api/run", self.plan()),
                                      ("/api/scan", {"model_path": str(self.model)})):
                self.assertEqual(self.request("POST", endpoint, payload, self.auth())[0], 409)
        finally:
            release.set()
            worker.join(3)
        self.assertFalse(worker.is_alive())
        self.assertFalse(self.service_instance.state()["busy"])
        self.service_instance.job["status"] = "running"
        self.assertEqual(self.request("POST", "/api/browse-model", {}, self.auth())[0], 409)

    def test_native_picker_uses_existing_folder_and_releases_tk(self):
        from model_picker import select_model
        with patch("tkinter.Tk") as root, patch("tkinter.filedialog.askopenfilename", return_value=str(self.model)) as ask:
            self.assertEqual(select_model(str(self.model)), str(self.model))
            self.assertEqual(ask.call_args.kwargs["initialdir"], str(self.directory))
            self.assertEqual(ask.call_args.kwargs["initialfile"], self.model.name)
            root.return_value.destroy.assert_called_once()
        with patch("tkinter.Tk") as root, patch("tkinter.filedialog.askopenfilename", side_effect=RuntimeError("dialog error")):
            with self.assertRaises(RuntimeError):
                select_model()
            root.return_value.destroy.assert_called_once()

    def test_post_rejects_malformed_json_nonfinite_values_and_wrong_type(self):
        headers = {**self.auth(), "Content-Type": "application/json"}
        for raw in (b"{", b"[]", b'{"value":NaN}', b'{"value":Infinity}'):
            with self.subTest(raw=raw):
                self.assertEqual(self.request("POST", "/api/run", headers=headers, raw=raw)[0], 400)
        self.assertEqual(self.request("POST", "/api/stop", headers=self.auth(), raw=b"{}")[0], 415)

    def test_static_and_download_paths_cannot_escape_allowlist(self):
        secret = self.directory / "secret.txt"
        secret.write_text("private", encoding="utf-8")
        self.service_instance.downloads["job"] = {"summary.csv": secret}
        for path in ("/../secret.txt", "/%2e%2e/secret.txt", "/web_server.py",
                     "/api/download/job/../../secret.txt",
                     "/api/download/job/%2e%2e%2fsecret.txt",
                     "/api/download/job/secret.txt", "/api/download/missing/summary.csv"):
            with self.subTest(path=path):
                status, _, body = self.request("GET", path)
                self.assertEqual(status, 404)
                self.assertNotIn(b"private", body)
        status, headers, body = self.request("GET", "/api/download/job/summary.csv")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"private")
        self.assertIn("attachment", headers["Content-Disposition"])

    def test_run_endpoint_returns_job_and_downloadable_saved_plan(self):
        status, _, body = self.request("POST", "/api/run", self.plan(), self.auth())
        self.assertEqual(status, 200)
        job_id = json.loads(body)["job_id"]
        self.join_worker(self.service_instance)
        status, _, body = self.request("GET", f"/api/download/{job_id}/plan.json")
        self.assertEqual(status, 200)
        saved = json.loads(body)
        self.assertEqual(len(saved["parameter_sets"]), 2)
        self.assertEqual(saved["parameter_columns"], [TEMPERATURE, PRESSURE])
        state = self.service_instance.state()
        self.assertEqual(state["job"]["components_url"], f"/api/download/{job_id}/components.csv")
        status, headers, body = self.request("GET", state["job"]["components_url"])
        self.assertEqual(status, 200)
        self.assertIn("attachment", headers["Content-Disposition"])
        self.assertIn("OUT,WATER", body.decode("utf-8"))

    def test_component_renderer_is_available_as_a_local_asset(self):
        (self.web / "stream_components.js").write_text("/* component renderer */", encoding="utf-8")
        self.assertEqual(self.request("GET", "/stream_components.js")[0], 200)

    def test_export_plan_uses_http_download_and_preserves_empty_rows_and_columns(self):
        source = self.plan()
        source["parameter_sets"][0]["parameters"][PRESSURE] = ""
        plan_directory = self.directory / "saved-plans"
        with patch("web_server.PLAN_ROOT", plan_directory):
            status, _, body = self.request("POST", "/api/plan", source, self.auth())
        self.assertEqual(status, 200)
        download_url = json.loads(body)["download_url"]
        self.assertTrue(download_url.startswith("/api/download/"))
        self.assertTrue(download_url.endswith("/plan.json"))
        status, headers, body = self.request("GET", download_url)
        self.assertEqual(status, 200)
        self.assertIn("attachment", headers["Content-Disposition"])
        saved = json.loads(body)
        self.assertEqual(saved["model_path"], str(self.model.resolve()))
        self.assertEqual(saved["parameter_columns"], [TEMPERATURE, PRESSURE])
        self.assertEqual(saved["parameter_sets"], [
            {"_name": "联合工况", "parameters": {TEMPERATURE: 613.0}},
            {"_name": "模型原值", "parameters": {}},
        ])
        self.assertIn(PRESSURE, saved["parameter_catalog"])
        files = list(plan_directory.glob("*.json"))
        self.assertEqual(len(files), 1)
        self.assertEqual(json.loads(files[0].read_text(encoding="utf-8")), saved)
        self.assertIsNone(self.service_instance.worker, "export must not launch a simulation")

    def test_nonfinite_output_does_not_break_state_endpoint(self):
        result = {
            "status": "success", "blocks": {"HEATER": {"heat_kW": float("nan")}},
            "streams": {"OUT": {"mass_flow_kg_h": float("inf")}},
            "extra": [float("-inf"), 0.0, "NaN"],
        }
        self.service_instance.job["results"] = [result]
        expected = {
            "status": "success", "blocks": {"HEATER": {"heat_kW": None}},
            "streams": {"OUT": {"mass_flow_kg_h": None}},
            "extra": [None, 0.0, "NaN"],
        }
        self.assertEqual(self.service_instance.state()["job"]["results"], [expected])
        self.assertTrue(math.isnan(result["blocks"]["HEATER"]["heat_kW"]))
        status, _, body = self.request("GET", "/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["job"]["results"], [expected])

    def test_stop_before_first_row_keeps_complete_downloadable_plan(self):
        entered, release = threading.Event(), threading.Event()
        runner = FakeRunner(self.directory)
        def runner_factory(model, catalog):
            entered.set()
            if not release.wait(3):
                raise RuntimeError("runner factory was not released")
            return runner
        self.service_instance.runner_factory = runner_factory
        status, _, body = self.request("POST", "/api/run", self.plan(), self.auth())
        job_id = json.loads(body)["job_id"]
        try:
            self.assertEqual(status, 200)
            self.assertTrue(entered.wait(1))
            self.assertEqual(self.request("POST", "/api/stop", {}, self.auth())[0], 200)
        finally:
            release.set()
            self.join_worker(self.service_instance)
        self.assertEqual(runner.calls, [])
        state = self.service_instance.state()
        self.assertEqual(state["job"]["completed"], 0)
        self.assertEqual(state["job"]["status"], "stopped")
        status, _, body = self.request("GET", f"/api/download/{job_id}/plan.json")
        self.assertEqual(status, 200)
        saved = json.loads(body)
        self.assertEqual(saved["parameter_columns"], [TEMPERATURE, PRESSURE])
        self.assertEqual(saved["parameter_sets"], validate_plan(self.plan())[3])

    def test_busy_endpoint_returns_conflict_until_current_scan_finishes(self):
        entered, release = threading.Event(), threading.Event()
        def scanner(model):
            entered.set()
            if not release.wait(3):
                raise RuntimeError("scanner was not released")
            return copy.deepcopy(CATALOG)
        self.service_instance.scanner = scanner
        status, _, _ = self.request("POST", "/api/scan", {"model_path": str(self.model)}, self.auth())
        try:
            self.assertEqual(status, 200)
            self.assertTrue(entered.wait(1))
            status, _, body = self.request("POST", "/api/run", self.plan(), self.auth())
            self.assertEqual(status, 409)
            self.assertIn("error", json.loads(body))
            plan_directory = self.directory / "blocked-plans"
            with patch("web_server.PLAN_ROOT", plan_directory):
                status, _, body = self.request("POST", "/api/plan", self.plan(), self.auth())
            self.assertEqual(status, 409)
            self.assertFalse(plan_directory.exists(), "busy exports must not write a plan")
        finally:
            release.set()
            self.join_worker(self.service_instance)


if __name__ == "__main__":
    unittest.main()
