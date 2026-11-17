"""HTTP checks use synthetic files and an isolated subprocess, never real secrets."""
import http.client
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class PublicServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="public-preview-test-")
        cls.base = Path(cls.temporary.name)
        cls.public = cls.base / "public"
        cls.public.mkdir()
        fixtures = {"index.html": "<h1>Public fixture</h1>", "app.mjs": "export const answer=42;",
                    "data/project.json": '{"fixture":true}', "folder/index.html": "Nested index",
                    "listing/file.txt": "Do not list this directory", ".env.local": "SYNTHETIC_VALUE=not-a-real-secret",
                    "nested/.config/value.txt": "Synthetic hidden fixture", ".vercel/project.json": "{}",
                    "model.bkp": "Synthetic archive, not Aspen data", "MODEL.APW": "Synthetic archive",
                    "model.apwz": "Synthetic archive", "license.lic": "Synthetic license fixture",
                    "private.pem": "Synthetic private-file fixture"}
        for name, content in fixtures.items():
            target = cls.public / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        (cls.base / "outside.txt").write_text("Synthetic outside-root fixture", encoding="utf-8")
        try:
            (cls.public / "escaped.txt").symlink_to(cls.base / "outside.txt")
            (cls.public / "alias.txt").symlink_to(cls.public / ".env.local")
            for folder, target, filename in [("indexed-outside", cls.base / "outside.txt", "index.html"),
                                             ("indexed-hidden", cls.public / ".env.local", "index.htm"),
                                             ("indexed-native", cls.public / "model.bkp", "index.html")]:
                (cls.public / folder).mkdir()
                (cls.public / folder / filename).symlink_to(target)
            cls.links_available = True
        except OSError:
            cls.links_available = False
        script = "from serve_web import create_server; import sys; s=create_server(0,sys.argv[1]); print(s.server_address[1],flush=True); s.serve_forever()"
        cls.process = subprocess.Popen([sys.executable, "-u", "-c", script, str(cls.public)], cwd=ROOT,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        cls.port = int(cls.process.stdout.readline().strip())

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=10)
        cls.process.stdout.close()
        cls.temporary.cleanup()

    def request(self, path, method="GET", headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_public_pages_modules_and_data_are_served(self):
        for path, expected in [("/", b"Public fixture"), ("/folder/", b"Nested index"),
                               ("/data/project.json", b'"fixture":true')]:
            status, headers, body = self.request(path)
            self.assertEqual(status, 200, path)
            self.assertIn(expected, body)
            self.assertIn("no-store", headers["Cache-Control"])
        status, headers, _ = self.request("/app.mjs")
        self.assertEqual(status, 200)
        self.assertIn("javascript", headers["Content-type"])

    def test_private_and_encoded_paths_return_404_without_contents(self):
        for path in ["/.env.local", "/%2eenv.local", "/nested/.config/value.txt", "/.vercel/project.json",
                     "/model.bkp", "/MODEL.APW", "/model.apwz", "/license.lic", "/private.pem",
                     "/../outside.txt", "/%2e%2e/outside.txt", "/nested%5c..%5c.env.local", "/index.html:stream"]:
            with self.subTest(path=path):
                status, headers, body = self.request(path)
                self.assertEqual(status, 404)
                self.assertNotIn(b"SYNTHETIC_VALUE", body)
                self.assertIn("no-store", headers["Cache-Control"])
                self.assertEqual(self.request(path, "HEAD")[0], 404)

    def test_directory_listing_is_disabled_but_nested_index_is_available(self):
        status, _, body = self.request("/listing/")
        self.assertEqual(status, 404)
        self.assertNotIn(b"file.txt", body)
        self.assertEqual(self.request("/folder/")[0], 200)

    def test_conditional_requests_return_current_uncached_bytes(self):
        status, headers, _ = self.request("/app.mjs")
        self.assertEqual(status, 200)
        status, response_headers, body = self.request("/app.mjs", headers={"If-Modified-Since": headers["Last-Modified"], "If-None-Match": '"old"'})
        self.assertEqual(status, 200)
        self.assertIn(b"answer=42", body)
        self.assertIn("no-store", response_headers["Cache-Control"])

    def test_symlinks_cannot_reveal_hidden_or_outside_files(self):
        if not self.links_available:
            self.skipTest("Windows symlink privilege is unavailable")
        for path in ("/escaped.txt", "/alias.txt"):
            self.assertEqual(self.request(path)[0], 404)

    def test_implicit_directory_indexes_cannot_bypass_target_checks(self):
        if not self.links_available:
            self.skipTest("Windows symlink privilege is unavailable")
        for folder in ("indexed-outside", "indexed-hidden", "indexed-native"):
            for path in ("/" + folder, "/" + folder + "/"):
                with self.subTest(path=path):
                    status, _, body = self.request(path)
                    self.assertEqual(status, 404)
                    self.assertNotIn(b"SYNTHETIC_VALUE", body)
                    self.assertEqual(self.request(path, "HEAD")[0], 404)


if __name__ == "__main__":
    unittest.main()
