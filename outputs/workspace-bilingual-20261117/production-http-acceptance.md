# Production HTTP acceptance

Checked: 2026-11-18T01:10:50+08:00

Production alias: https://vercel-pi-ten-59.vercel.app/
Local release: `512b166`

Ordinary HTTP requests were made without Authorization, Cookie, Vercel bypass headers, or a browser session. No configuration was changed. Sensitive response bodies were neither read nor logged.

- **5/5 pages passed**: home, models.html, docs.html, universal.html, pipeline.html. Each returned 200, showed no authentication wall, and matched the local release bytes.
- **6/6 JavaScript modules passed**: models.mjs, docs.mjs, i18n.mjs, chart-export.mjs, pipeline-export.mjs, result-exports.mjs. Each returned 200 with `application/javascript; charset=utf-8` and matched local bytes.
- **Public numerical evidence passed**: index.json matches local bytes; every one of its 14 declared files returned 200 and matches both the listed SHA256/byte size and the local file.
- **4/4 sensitive paths were unavailable (404)**: .env.local, .vercel/project.json, .git/config, native.bkp.

The production alias is publicly reachable and is not covered by an authentication wall in this check. This directly establishes production access; it does not by itself establish the protection state of a distinct temporary deployment URL, whose exact URL was not supplied for this check. Root owns the separate interactive Ego browser acceptance.

Request-level status, MIME, byte hashes, and redirect metadata are recorded in `production-http-acceptance.json`; no fetched response bodies were saved.
