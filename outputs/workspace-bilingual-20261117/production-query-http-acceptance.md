# Production query HTTP acceptance

- Runtime and frozen evidence: **PASS (11/11)**. Requested HTTP set: **11/12**, with `/README.md` unavailable (404).
- Checked at 2026-11-17T18:19:15.899347+00:00; release `cb8ce67`; ordinary unauthenticated production alias HTTP.
- Six JavaScript modules and one CSS file have correct MIME and exactly match local bytes; the models page also matches.
- Both version indexes and the v2 model bundle match local frozen bytes. The v2 bundle also matches its index SHA256 and byte length.
- v1 remains exploratory; v2 permits predictions, with physical validation false and 37/20/3/14/fresh4/38 counts retained.
- Root README is outside the static directory; `analysis_web/README.md` returns 404. Both README source texts match the release Git blob after CRLF/LF normalization. The bilingual website instructions in `docs-extension.mjs` are published and match.
- No full 35-file sweep, browser operations, native Aspen run, source/config edits, or repeated unit tests. Root owns actual browser acceptance.

| Path | HTTP | Byte match | MIME |
|---|---:|---|---|
| `browser-surrogate.mjs` | 200 | True | `application/javascript; charset=utf-8` |
| `model-query-view.mjs` | 200 | True | `application/javascript; charset=utf-8` |
| `model-query.css` | 200 | True | `text/css; charset=utf-8` |
| `model-artifacts.mjs` | 200 | True | `application/javascript; charset=utf-8` |
| `model-artifact-data.mjs` | 200 | True | `application/javascript; charset=utf-8` |
| `models.html` | 200 | True | `text/html; charset=utf-8` |
| `i18n-dictionary.mjs` | 200 | True | `application/javascript; charset=utf-8` |
| `docs-extension.mjs` | 200 | True | `application/javascript; charset=utf-8` |
| `README.md` | 404 | False | `` |
| `data/generic-htl-pilot/index.json` | 200 | True | `application/json; charset=utf-8` |
| `data/generic-htl-extension/index.json` | 200 | True | `application/json; charset=utf-8` |
| `data/generic-htl-extension/model.bundle.json` | 200 | True | `application/json; charset=utf-8` |
