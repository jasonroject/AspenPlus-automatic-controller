"""Local browser UI for the Aspen controller; no external web dependencies.

Run: python -X utf8 web_server.py [--port 8765] [--no-browser]
The server binds only to loopback. Each case uses a private Aspen COM document.
"""
from __future__ import annotations

import argparse
import copy
import json
import math
import mimetypes
import secrets
import threading
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen

from parameter_catalog import coerce_value, discover_parameters
from parameter_labels import is_common, parameter_detail, parameter_title

ROOT = Path(__file__).resolve().parent
WEB_ROOT = ROOT / "web"
EXAMPLE = ROOT / "generated" / "heatrecovery_multi_device_example.json"
PLAN_ROOT = ROOT / "generated" / "web-plans"


class BusyError(ValueError):
    pass


def json_safe(value):
    """Keep Aspen nonfinite outputs from breaking progress polling."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [json_safe(item) for item in value]
    return value


def model_file(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("请选择模型，或填写本机 .bkp 文件的完整路径。")
    path = Path(value.strip().strip('"')).expanduser()
    if not path.is_absolute() or path.suffix.lower() != ".bkp":
        raise ValueError("模型路径必须是本机 .bkp 文件的完整路径。")
    if not path.is_file():
        raise ValueError(f"找不到模型文件：{path}")
    return path.resolve()


def enrich_catalog(catalog):
    if not isinstance(catalog, dict) or len(catalog) > 20000:
        raise ValueError("参数目录格式不正确，或参数数量超过限制。")
    result = {}
    for key, raw in catalog.items():
        if not isinstance(key, str) or not isinstance(raw, dict):
            raise ValueError("参数目录必须使用文字标识和参数对象。")
        path = raw.get("path", "")
        parts = path.split("\\") if isinstance(path, str) else []
        if (len(parts) < 6 or parts[:2] != ["", "Data"] or
                parts[2] not in ("Blocks", "Streams") or parts[4] != "Input" or
                any(not part or part in (".", "..") for part in parts[2:])):
            raise ValueError(f"参数 {key} 不是有效的设备或物流输入节点。")
        value = raw.get("value")
        if value is not None and not isinstance(value, (str, int, float)):
            raise ValueError(f"参数 {key} 的模型原值不是标量。")
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError(f"参数 {key} 包含非有限数值。")
        spec = dict(path=path, value=value, unit=str(raw.get("unit") or ""),
                    section=parts[2], owner=parts[3], label=str(raw.get("label") or "/".join(parts[5:])))
        result[key] = spec
    for key, spec in result.items():
        spec.update(title=parameter_title(key, result), common=is_common(spec),
                    detail=parameter_detail(key, result))
    return result


def validate_plan(payload):
    model = model_file(payload.get("model_path"))
    catalog = enrich_catalog(payload.get("parameter_catalog", {}))
    raw_rows = payload.get("parameter_sets")
    if not isinstance(raw_rows, list) or not 1 <= len(raw_rows) <= 10000:
        raise ValueError("请添加 1 至 10,000 行运行计划。")
    if any(not isinstance(row, dict) or not isinstance(row.get("parameters", {}), dict) for row in raw_rows):
        raise ValueError("每一运行行都需要参数对象；空白行使用空对象。")
    columns = payload.get("parameter_columns")
    if columns is None:
        columns = list(dict.fromkeys(key for row in raw_rows if isinstance(row, dict)
                                    for key in row.get("parameters", {})))
    if not isinstance(columns, list) or any(not isinstance(key, str) for key in columns):
        raise ValueError("参数列格式不正确。")
    if len(columns) != len(set(columns)) or len(columns) > 256:
        raise ValueError("参数列不能重复，且最多支持 256 列。")
    if any(key not in catalog for key in columns):
        raise ValueError("参数列不在当前模型目录中，请重新读取模型参数。")
    paths = [catalog[key]["path"] for key in columns]
    if len(paths) != len(set(paths)):
        raise ValueError("两列指向同一项 Aspen 设置，请删除重复列。")
    rows = []
    for index, row in enumerate(raw_rows, 1):
        if not isinstance(row, dict) or not isinstance(row.get("parameters", {}), dict):
            raise ValueError(f"第 {index} 行格式不正确。")
        parameters = {}
        for key, value in row.get("parameters", {}).items():
            if key not in columns or key not in catalog:
                raise ValueError(f"第 {index} 行包含未选择的参数列：{key}")
            if value is None or isinstance(value, str) and not value.strip():
                continue
            if not isinstance(value, (str, int, float)) or isinstance(value, bool):
                raise ValueError(f"第 {index} 行参数值必须是文字或数值。")
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError(f"第 {index} 行包含非有限数值。")
            try:
                parameters[key] = coerce_value(value, catalog[key].get("value"))
            except ValueError as exc:
                raise ValueError(f"第 {index} 行，{catalog[key]['title']}：{exc}") from exc
        rows.append({"_name": str(row.get("_name") or f"运行 {index}"), "parameters": parameters})
    return model, catalog, columns, rows


def scan_aspen(model):
    import pythoncom
    import win32com.client
    pythoncom.CoInitialize()
    aspen = None
    try:
        aspen = win32com.client.DispatchEx("Apwn.Document")
        aspen.InitFromArchive2(str(model))
        aspen.Visible = 0
        aspen.SuppressDialogs = 1
        return discover_parameters(aspen)
    finally:
        try:
            if aspen is not None:
                aspen.Close(False)
        finally:
            pythoncom.CoUninitialize()


def make_runner(model, catalog):
    from batch_runner import BatchRunner
    runner = BatchRunner(model, {}, [], catalog)
    # Distinct web batch names even for consecutive quickly failing jobs.
    runner.batch_id = "web-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    return runner


class AutomationService:
    def __init__(self, scanner=scan_aspen, runner_factory=make_runner):
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.RLock()
        self.scanner = scanner
        self.runner_factory = runner_factory
        self.model_path = ""
        self.catalog = {}
        self.downloads = {}
        self.worker = None
        self.job = dict(id="", kind="idle", status="idle", total=0, completed=0,
                        current=0, results=[], logs=[], error=None, summary_url=None,
                        stop_requested=False)

    def known_models(self):
        paths = list((ROOT.parent / "aspenmodel").glob("*.bkp"))
        for filename in (ROOT / "generated").glob("*_scan.json"):
            try:
                path = Path(json.loads(filename.read_text(encoding="utf-8"))["model_path"])
                if path.is_file():
                    paths.append(path)
            except (OSError, ValueError, KeyError):
                pass
        return [dict(name=path.name, path=str(path))
                for path in sorted(set(p.resolve() for p in paths))]

    def state(self):
        with self.lock:
            snapshot = copy.deepcopy(dict(token=self.token, model_path=self.model_path,
                catalog=self.catalog, job=self.job, busy=self.job["status"] == "running"))
        snapshot["models"] = self.known_models()
        return json_safe(snapshot)

    def log(self, message):
        with self.lock:
            self.job["logs"].append(f"{datetime.now():%H:%M:%S}  {message}")
            self.job["logs"] = self.job["logs"][-300:]

    def _reserve(self, kind, total=0):
        # Caller holds lock: reserve before starting a thread or accepting another job.
        if self.job["status"] == "running":
            raise BusyError("当前操作尚未结束，请等待完成，或停止后续运行。")
        self.job = dict(id=secrets.token_hex(12), kind=kind, status="running", total=total,
                        completed=0, current=0, results=[], logs=[], error=None,
                        summary_url=None, stop_requested=False)
        return self.job["id"]

    def start_scan(self, payload):
        model = model_file(payload.get("model_path"))
        with self.lock:
            job_id = self._reserve("scan")
            self.worker = threading.Thread(target=self._scan, args=(model,), daemon=True)
            self.worker.start()
        return {"job_id": job_id}

    def _scan(self, model):
        try:
            self.log(f"正在读取 {model.name} 的设备和物流参数…")
            catalog = enrich_catalog(self.scanner(model))
            if not catalog:
                raise ValueError("模型中没有读取到输入参数。")
            with self.lock:
                self.model_path = str(model)
                self.catalog = catalog
                self.log(f"读取完成，共 {len(catalog)} 个输入候选。请选择需要控制的参数列。")
                self.job["status"] = "completed"
        except BaseException as exc:
            self._fail(exc)

    def catalog_import(self, payload):
        with self.lock:
            if self.job["status"] == "running":
                raise BusyError("请等待当前操作完成后再打开运行表。")
        model = model_file(payload.get("model_path"))
        catalog = enrich_catalog(payload.get("parameter_catalog", {}))
        return {"model_path": str(model), "catalog": catalog}

    def start_run(self, payload):
        model, catalog, columns, rows = validate_plan(payload)
        with self.lock:
            job_id = self._reserve("run", len(rows))
            self.model_path, self.catalog = str(model), catalog
            self.worker = threading.Thread(target=self._run, args=(model, catalog, columns, rows), daemon=True)
            self.worker.start()
        return {"job_id": job_id}

    def save_plan(self, payload):
        model, catalog, columns, rows = validate_plan(payload)
        with self.lock:
            if self.job["status"] == "running":
                raise BusyError("请等待当前操作完成后再保存方案。")
            plan_id = "plan-" + secrets.token_hex(12)
            PLAN_ROOT.mkdir(parents=True, exist_ok=True)
            file = PLAN_ROOT / f"aspen_plan_{plan_id}.json"
            file.write_text(json.dumps(dict(model_path=str(model), parameter_catalog=catalog,
                parameter_columns=columns, parameter_sets=rows), ensure_ascii=False, indent=2), encoding="utf-8")
            self.downloads[plan_id] = {"plan.json": file}
        return {"download_url": f"/api/download/{plan_id}/plan.json"}

    def _run(self, model, catalog, columns, rows):
        runner = None
        error = None
        try:
            runner = self.runner_factory(model, catalog)
            self.log(f"计划包含 {len(rows)} 行、{len(columns)} 个参数列；计算逐行执行。")
            for index, row in enumerate(rows, 1):
                with self.lock:
                    if self.job["stop_requested"]:
                        break
                    self.job["current"] = index
                self.log(f"第 {index}/{len(rows)} 行：{row['_name']}，正在运行…")
                result = runner.run_single(row["parameters"], index, row["_name"])
                runner.batch_results.append(result)
                try:
                    json.dumps(result, allow_nan=False)
                except ValueError:
                    self.log(f"第 {index} 行存在非有限输出，网页显示为缺失值；请检查 Aspen 模型状态。")
                with self.lock:
                    self.job["results"].append(copy.deepcopy(result))
                    self.job["completed"] = index
                self.log(f"第 {index} 行已导出。" if result["status"] == "success"
                         else f"第 {index} 行失败：{result.get('error') or '请检查 Aspen 状态'}")
        except BaseException as exc:
            error = exc
        finally:
            if runner is not None:
                try:
                    summary_json, summary_csv, directory = runner.save_batch_summary()
                    if not Path(summary_csv).is_file():
                        Path(summary_csv).write_text("运行序号,运行名称,状态,用时(秒),错误\n", encoding="utf-8-sig")
                    # Preserve every intended row and empty column, including unrun rows after stop.
                    (directory / "web_run_plan.json").write_text(json.dumps(dict(
                        model_path=str(model), parameter_catalog=catalog, parameter_columns=columns,
                        parameter_sets=rows), ensure_ascii=False, indent=2), encoding="utf-8")
                    with self.lock:
                        job_id = self.job["id"]
                        self.downloads[job_id] = {"summary.csv": Path(summary_csv),
                                                 "summary.json": Path(summary_json),
                                                 "plan.json": directory / "web_run_plan.json"}
                        self.job["summary_url"] = f"/api/download/{job_id}/summary.csv"
                        self.job["output_dir"] = str(directory)
                except BaseException as exc:
                    error = error or exc
            if error:
                self._fail(error)
            else:
                with self.lock:
                    stopped = self.job["completed"] < self.job["total"] and self.job["stop_requested"]
                    self.log("已停止后续运行，已完成的结果已保存。" if stopped else "运行结束，结果已保存。")
                    self.job["status"] = "stopped" if stopped else "completed"

    def _fail(self, error):
        with self.lock:
            self.log(f"操作失败：{error}")
            self.job.update(status="failed", error=str(error))

    def stop(self):
        with self.lock:
            if self.job["status"] == "running" and self.job["kind"] == "run":
                self.job["stop_requested"] = True
                self.log("收到停止请求，当前行结束后停止。")
        return {"ok": True}


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, service=None):
        super().__init__(address, RequestHandler)
        self.service = service or AutomationService()


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "AspenLocal/1.0"

    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def log_message(self, *args):
        pass

    def _trusted_host(self):
        port = self.server.server_address[1]
        return self.headers.get("Host") in (f"127.0.0.1:{port}", f"localhost:{port}")

    def _send(self, data, status=200, content_type="application/json; charset=utf-8", attachment=None):
        if not isinstance(data, bytes):
            data = json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        if attachment:
            self.send_header("Content-Disposition", f'attachment; filename="{attachment}"')
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if not self._trusted_host():
            return self._send({"error": "仅允许本机访问。"}, 403)
        path = urlsplit(self.path).path
        try:
            if path == "/api/state":
                return self._send(self.server.service.state())
            if path == "/api/example":
                if not EXAMPLE.is_file():
                    return self._send({"error": "本机没有示例配置。模型参数目录不随源码分发，请先选择自己的 .bkp 文件并读取模型参数。"}, 404)
                config = json.loads(EXAMPLE.read_text(encoding="utf-8"))
                config["parameter_catalog"] = enrich_catalog(config["parameter_catalog"])
                return self._send(config)
            if path.startswith("/api/download/"):
                parts = path.split("/")
                if len(parts) != 5:
                    return self._send({"error": "下载地址无效。"}, 404)
                with self.server.service.lock:
                    file = self.server.service.downloads.get(parts[3], {}).get(parts[4])
                if file is None or not file.is_file():
                    return self._send({"error": "结果不存在，或当前服务已重启。"}, 404)
                return self._send(file.read_bytes(), content_type="application/octet-stream", attachment=file.name)
            files = {"/": "index.html", "/index.html": "index.html", "/app.css": "app.css", "/app.js": "app.js"}
            if path not in files:
                return self._send({"error": "页面不存在。"}, 404)
            file = WEB_ROOT / files[path]
            content_type = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
            return self._send(file.read_bytes(), content_type=content_type + "; charset=utf-8")
        except (OSError, ValueError, KeyError) as exc:
            return self._send({"error": str(exc)}, 400)

    def do_POST(self):
        # Consume a bounded body before rejecting a request. On Windows, closing
        # with unread body bytes can reset the connection and discard our 403.
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self._send({"error": "请求长度无效。"}, 400)
        if not 0 < length <= 8 * 1024 * 1024:
            return self._send({"error": "请求为空或超过 8 MB。"}, 413)
        raw_body = self.rfile.read(length)
        if not self._trusted_host():
            return self._send({"error": "仅允许本机访问。"}, 403)
        origin = self.headers.get("Origin")
        if origin and origin != "http://" + self.headers.get("Host", ""):
            return self._send({"error": "拒绝跨站操作。"}, 403)
        if not secrets.compare_digest(self.headers.get("X-Session-Token", ""), self.server.service.token):
            return self._send({"error": "页面会话已失效，请刷新页面。"}, 403)
        if self.headers.get_content_type() != "application/json":
            return self._send({"error": "请求需要 JSON 数据。"}, 415)
        try:
            payload = json.loads(raw_body, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("非法数值")))
            if not isinstance(payload, dict):
                raise ValueError("请求必须是 JSON 对象。")
            routes = {"/api/scan": self.server.service.start_scan,
                      "/api/catalog": self.server.service.catalog_import,
                      "/api/plan": self.server.service.save_plan,
                      "/api/run": self.server.service.start_run,
                      "/api/stop": lambda _: self.server.service.stop()}
            route = routes.get(urlsplit(self.path).path)
            if route is None:
                return self._send({"error": "接口不存在。"}, 404)
            return self._send(route(payload))
        except BusyError as exc:
            return self._send({"error": str(exc)}, 409)
        except (ValueError, TypeError, KeyError, OSError) as exc:
            return self._send({"error": str(exc)}, 400)


def main():
    parser = argparse.ArgumentParser(description="Aspen 本机网页版控制台")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    try:
        server = LocalServer(("127.0.0.1", args.port))
    except OSError as exc:
        if not args.no_browser:
            try:
                url = f"http://127.0.0.1:{args.port}"
                with urlopen(url + "/api/state", timeout=2) as response:
                    if response.headers.get("Server", "").startswith("AspenLocal/"):
                        webbrowser.open(url)
                        print("已打开正在运行的 Aspen 工作台。", flush=True)
                        return
            except (OSError, ValueError):
                pass
        raise SystemExit(f"无法启动本机服务：{exc}\n可尝试 --port 8766 更换端口。")
    url = f"http://127.0.0.1:{server.server_address[1]}"
    print(f"Aspen 本机控制台：{url}\n保留此窗口即可使用；关闭浏览器不会中断计算。", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        if server.service.state()["busy"]:
            print("正在等待当前模型操作结束；后续运行已停止。", flush=True)
            server.service.stop()
            server.service.worker.join()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
