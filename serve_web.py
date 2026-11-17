"""Serve the public frontend on loopback, without exposing local configuration."""
from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


PUBLIC_ROOT = Path(__file__).resolve().parent / "analysis_web"
PRIVATE_SUFFIXES = {".bkp", ".apw", ".apwz", ".lic", ".pem", ".key", ".pfx", ".p12"}


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


def create_server(port=8766, directory=PUBLIC_ROOT):
    if not 0 <= port <= 65535:
        raise ValueError("Port must be between 0 and 65535")
    directory = Path(directory).resolve()
    if not directory.is_dir():
        raise ValueError("Public frontend directory does not exist")
    return ThreadingHTTPServer(("127.0.0.1", port), partial(PublicHandler, directory=directory))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    with create_server(args.port) as server:
        print(f"Process Studio: http://127.0.0.1:{server.server_address[1]} (public files only; no cache)", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
