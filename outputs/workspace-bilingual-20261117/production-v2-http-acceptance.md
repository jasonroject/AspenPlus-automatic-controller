# Production v2 HTTP acceptance

Checked: 2026-11-18T01:55:18+08:00

Production: https://vercel-pi-ten-59.vercel.app/  
Release: `43a36bd`  
Deployment: `dpl_4nMebL7ZWrVFC84KVeASAuu8yF8Z`

**Passed.** All requests used ordinary HTTP without login, Authorization, Cookie, browser state, or Vercel protection-bypass headers. No source/configuration was changed and no unit tests or browser checks were rerun.

| Check | Result |
|---|---:|
| Home, models, docs, universal, pipeline: HTTP 200, no authentication wall, exact local bytes | 5/5 |
| Key modules, CSS, package READMEs: HTTP 200 and exact local bytes | 22/22 |
| JavaScript/MJS MIME accepted as application/javascript or text/javascript | 18/18 |
| Public v1/v2 index files: exact local bytes and matching parsed manifests | 2/2 |
| Manifest-listed evidence JSON: HTTP 200, exact SHA256/size, exact local bytes | 35/35 |
| Private/excluded paths: HTTP 404 | 8/8 |

The 35 evidence files consist of **14 v1 files and 21 v2 files**, excluding their two index files. The production v1 index still declares ordinary prediction disabled and exploratory true. V2 declares prediction enabled and exploratory false; this remains qualification against the stated Aspen-simulator error checks, not physical validation.

Key files include the versioned-model workspace, both documentation-extension modules and reviewed data, provenance/session modules, model/response/result export modules, and shared chart helpers. Request-level paths, MIME, status, byte hashes and redirect metadata are in `production-v2-http-acceptance.json`.

The following paths returned 404; their response bodies were **not read or logged**:

- `.env.local`
- `.vercel/project.json`
- `.git/config`
- `native.bkp`
- `data/generic-htl-extension/protected-source-hashes.json`
- `data/generic-htl-extension/merged-ledger.json`
- `data/generic-htl-extension/v2-extension-fit-attempt.json`
- `data/generic-htl-extension/runs/local-05/raw.json`

No fetched response bodies were saved. This report checks public delivery and artifact identity; root owns the separate interactive Ego acceptance of the 37-case import, calculation, exports and language switching.
