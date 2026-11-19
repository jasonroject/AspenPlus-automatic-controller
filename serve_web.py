"""Serve the public frontend on loopback, without exposing local configuration.

    python serve_web.py                 public static files only (what the online site serves)
    python serve_web.py --local         + local mode: POST /api/local/probe runs `python -m aspen_study probe <model>`
                                        on this machine and returns the SAME result package the online
                                        site accepts by upload (probe-summary.json + graph.json + roles.json
                                        + advice.json, optionally zipped; see aspen_study/result_package.py)

Local mode never uploads or serves the model: the request carries a path on this PC, Aspen runs here, only the
JSON package comes back. It needs Aspen Plus + pywin32 (Windows); the static mode needs neither.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import threading
from collections import OrderedDict
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


REPO_ROOT = Path(__file__).resolve().parent
PUBLIC_ROOT = REPO_ROOT / "analysis_web"
PRIVATE_SUFFIXES = {".bkp", ".apw", ".apwz", ".lic", ".pem", ".key", ".pfx", ".p12"}
LOCAL_MODEL_SUFFIXES = {".bkp", ".apw"}     # the formats the Aspen adapter has verified on a real machine
DEFAULT_PROBE_TIMEOUT_S = 1200
MAX_REQUEST_BYTES = 64 * 1024
KEEP_PACKAGES = 5


def run_probe_subprocess(model, out_dir, timeout_s):
    """Run `python -m aspen_study probe <model> --out-dir <dir> --timeout <s> --no-study`; return (returncode, stdout, stderr).

    --no-study: the package needs only the summary + graph (roles are drafted by result_package), not the
    Node-based study evaluation.
    """
    command = [sys.executable, "-X", "utf8", "-m", "aspen_study", "probe", str(model), "--out-dir", str(out_dir),
               "--timeout", str(timeout_s), "--no-study"]
    done = subprocess.run(command, cwd=REPO_ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
                          timeout=timeout_s + 120)
    return done.returncode, done.stdout, done.stderr


class ProbeBusy(RuntimeError):
    pass


class LocalProbeService:
    """Runs one probe at a time and keeps the last few packages (as zip bytes) for download."""

    def __init__(self, runner=run_probe_subprocess):
        self.runner = runner
        self._busy = threading.Lock()
        self._lock = threading.Lock()
        self._packages = OrderedDict()
        self._counter = 0

    @staticmethod
    def check_model(path):
        if not isinstance(path, str) or not path.strip() or "\0" in path:
            raise ValueError("model_path must be the path of a model file on this computer")
        model = Path(path.strip().strip('"'))
        if model.suffix.lower() not in LOCAL_MODEL_SUFFIXES:
            raise ValueError(f"unsupported model file type {model.suffix or '(none)'}; use a .bkp (or .apw) file")
        if not model.is_file():
            raise ValueError(f"model file not found on this computer: {model}")
        return model

    def probe(self, payload):
        from aspen_study.result_package import (PackageError, ProbeOutputMissing, describe, package_from_probe_dir,
                                                validate_package, zip_bytes)
        if not isinstance(payload, dict):
            raise ValueError("expected a JSON object")
        model = self.check_model(payload.get("model_path"))
        timeout_s = payload.get("timeout", DEFAULT_PROBE_TIMEOUT_S)
        if isinstance(timeout_s, bool) or not isinstance(timeout_s, (int, float)) or not 0 < timeout_s <= 24 * 3600:
            raise ValueError("timeout must be a number of seconds between 0 and 86400")
        if not self._busy.acquire(blocking=False):
            raise ProbeBusy("a probe is already running; wait for it to finish")
        try:
            with tempfile.TemporaryDirectory(prefix="aspen-package-") as work:
                code, out, err = self.runner(model, work, timeout_s)
                try:
                    # summary + graph (+ drafted roles) -> consistency checks -> advice.json (advice.advise, schema-validated)
                    parts = package_from_probe_dir(work, with_advice=True)
                except ProbeOutputMissing as exc:
                    detail = " ".join((err or out or "").split())[-400:]
                    raise ProbeFailed(f"probe exit code {code}: {'; '.join(exc.problems)}" + (f" ({detail})" if detail else ""),
                                      code) from exc
                except PackageError as exc:        # package_problems / schema errors: nothing is emitted
                    raise PackageProblems(exc.problems, code) from exc
            report = validate_package(parts)
            blob = zip_bytes(parts)
        finally:
            self._busy.release()
        with self._lock:
            self._counter += 1
            package_id = f"p{self._counter}"
            self._packages[package_id] = blob
            while len(self._packages) > KEEP_PACKAGES:
                self._packages.popitem(last=False)
        return {"id": package_id, "state": parts["probe-summary.json"]["status"]["state"], "exit_code": code,
                "summary": describe(parts), "warnings": report["warnings"], "files": parts,
                "zip_url": f"/api/local/package/{package_id}.zip"}

    def zip_for(self, package_id):
        with self._lock:
            return self._packages.get(package_id)


class PackageProblems(RuntimeError):
    """The probe produced files that do not form a valid package (inconsistent, wrong schema ...); no package is emitted."""

    def __init__(self, problems, code):
        super().__init__("; ".join(problems))
        self.problems, self.code = list(problems), code


class ProbeFailed(RuntimeError):
    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


class PublicHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".mjs": "text/javascript; charset=utf-8",
                      ".js": "text/javascript; charset=utf-8"}

    def __init__(self, *args, directory=PUBLIC_ROOT, **kwargs):
        self.public_root = Path(directory).resolve()
        super().__init__(*args, directory=str(self.public_root), **kwargs)

    def public_path(self):
        """Validate both URL spelling and resolved files (including symlinks)."""
        try:
            decoded = unquote(urlsplit(self.path).path)
            parts = [part for part in decoded.split("/") if part]
            if "\\" in decoded or ":" in decoded or any(ord(char) < 32 for char in decoded):
                return None
            if any(part.startswith(".") for part in parts):
                return None
            return self.checked_target(super().translate_path(self.path))
        except (OSError, ValueError):
            return None

    def checked_target(self, path):
        """Apply the same boundary to direct requests and implicit index files."""
        try:
            candidate = Path(path).resolve()
            relative = candidate.relative_to(self.public_root)
            if any(part.startswith(".") for part in relative.parts):
                return None
            if candidate.suffix.lower() in PRIVATE_SUFFIXES:
                return None
            return candidate
        except (OSError, ValueError):
            return None

    def send_head(self):
        candidate = self.public_path()
        if candidate is None:
            self.send_error(404, "Not found")
            return None
        if candidate.is_dir():
            for filename in ("index.html", "index.htm"):
                index = candidate / filename
                if index.is_file():
                    if self.checked_target(index) is None:
                        self.send_error(404, "Not found")
                        return None
                    break
        # A previous preview may have been cached at second-resolution mtime.
        # Always return the current bytes, including for conditional requests.
        for header in ("If-Modified-Since", "If-None-Match"):
            if header in self.headers:
                del self.headers[header]
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404, "Not found")
        return None

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


class LocalHandler(PublicHandler):
    """PublicHandler + the local-only probe API. Only instantiated with `--local`."""
    service = None   # set by create_server

    def trusted_host(self):
        port = self.server.server_address[1]
        return self.headers.get("Host") in (f"127.0.0.1:{port}", f"localhost:{port}")

    def same_origin(self):
        origin = self.headers.get("Origin")
        port = self.server.server_address[1]
        return origin is None or origin in (f"http://127.0.0.1:{port}", f"http://localhost:{port}")

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/local/status":
            if not self.trusted_host():
                return self.send_error(403, "Forbidden host")
            return self.send_json({"local": True, "probe": "python -m aspen_study probe",
                                   "package_files": ["probe-summary.json", "graph.json", "roles.json", "advice.json"]})
        if path.startswith("/api/local/package/") and path.endswith(".zip"):
            if not self.trusted_host():
                return self.send_error(403, "Forbidden host")
            blob = self.service.zip_for(path[len("/api/local/package/"):-len(".zip")])
            if blob is None:
                return self.send_error(404, "Package not found (only the last %d are kept)" % KEEP_PACKAGES)
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(len(blob)))
            self.send_header("Content-Disposition", 'attachment; filename="aspen-result-package.zip"')
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(blob)
            return None
        return super().do_GET()

    def do_POST(self):
        if urlsplit(self.path).path != "/api/local/probe":
            return self.send_error(404, "Not found")
        if not self.trusted_host() or not self.same_origin():
            return self.send_error(403, "Forbidden origin")
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            return self.send_json({"error": "Content-Type must be application/json"}, 415)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if not 0 < length <= MAX_REQUEST_BYTES:
            return self.send_json({"error": "request body missing or too large"}, 400)
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            return self.send_json(self.service.probe(payload))
        except (ValueError, UnicodeDecodeError) as exc:       # includes bad JSON, bad path, bad timeout
            return self.send_json({"error": str(exc)}, 400)
        except ProbeBusy as exc:
            return self.send_json({"error": str(exc)}, 409)
        except ProbeFailed as exc:
            return self.send_json({"error": str(exc), "exit_code": exc.code}, 502)
        except PackageProblems as exc:
            return self.send_json({"error": "结果包不一致或无效，未生成：" + str(exc), "problems": exc.problems,
                                   "exit_code": exc.code}, 422)
        except Exception as exc:                              # AspenError etc. never leak a traceback
            return self.send_json({"error": f"{type(exc).__name__}: {exc}"}, 500)


def create_server(port=8766, directory=PUBLIC_ROOT, local=False, probe_runner=run_probe_subprocess):
    if not 0 <= port <= 65535:
        raise ValueError("Port must be between 0 and 65535")
    directory = Path(directory).resolve()
    if not directory.is_dir():
        raise ValueError("Public frontend directory does not exist")
    if not local:
        return ThreadingHTTPServer(("127.0.0.1", port), partial(PublicHandler, directory=directory))
    handler = type("BoundLocalHandler", (LocalHandler,), {"service": LocalProbeService(probe_runner)})
    return ThreadingHTTPServer(("127.0.0.1", port), partial(handler, directory=directory))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--local", action="store_true",
                        help="enable POST /api/local/probe (runs Aspen on this computer; needs Aspen Plus + pywin32)")
    args = parser.parse_args()
    with create_server(args.port, local=args.local) as server:
        mode = "local probe mode ON (Aspen runs on this computer)" if args.local else "public files only"
        print(f"Process Studio: http://127.0.0.1:{server.server_address[1]} ({mode}; no cache)", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
