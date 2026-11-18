# Release readiness — reviewed local snapshot

Updated: 2026-11-18T01:00:03+08:00. No COM, staging, commit, or deployment was performed in this review. This replaces the earlier pre-pilot snapshot.

## Scope and outcome

The current task has **123 explicit candidate files**, listed one relative path per line in `git-add-allowlist.txt`: 64 under `analysis_web`, 26 under `process_pipeline`, 6 under `htl_pipeline`, 24 under `universal_pipeline`, and root `.gitattributes` / `README.md` / `serve_web.py`. The list contains no duplicates or missing files. Do not use `git add .`.

No release-blocking source/dependency issue remains from this incremental audit. The required static deployment root is **`analysis_web/`**. The prior HTML/link review covered 9 HTML files and 233 local references; this incremental pass checked 156 local JavaScript/Python dependency references against tracked files plus this allowlist. No missing or excluded local dependency remains. The documentation's `./analysis_web/universal-core.mjs` import is a repository-root Node example, not a browser import.

## Fixed clean-checkout failure

Two frontend test files previously required untracked files in `outputs/`. They now reference three byte-identical fixtures under `universal_pipeline/fixtures/`: `surrogate-demo.bundle.json`, `surrogate-demo.predictions.json`, and `surrogate-demo.robustness.json`. All are explicitly `offline_fixture` evidence; they do not represent native Aspen output. No numerical content or embedded digest was changed. Original output copies remain untouched.

The 17 affected artifact/robustness tests pass without skips; `git diff --check` passes for the two changed tests. The fixture JSONs contain no personal absolute paths, source URLs, credential values, or output-directory dependency. Their byte hashes match the original offline artifacts. The existing synthetic XLSX regression input's XML members also contain no personal paths or credential patterns.

## Public-data and scientific claims

The public `analysis_web/data/generic-htl-pilot/` directory is included. Its index matches all **14 declared file hashes and byte sizes**. The source/profile/dataset/bundle lineage and 17 retained native IDs were checked in the preceding curated-data audit and remain unchanged.

- All 17 native cases passed the stated native/normalization/closure/LCIA gates; this is not physical validation.
- The model uses 12 training, 3 holdout, and 2 independent verification points. At 335 °C / 8.5 m, all three responses exceed the 5% maximum-relative-error criterion; 345 °C / 17.5 m passes all three. Verification-group maxima are 5.7618%, 9.7716%, and 9.5367% for energy, yield, and climate impact respectively.
- The model remains `prediction_enabled: false`; released queries and robustness scenarios are explicitly exploratory. Complete scenario coverage does not qualify the model. The older HTL GP reference remains separate.
- The curated README reproduction commands now use repository-relative paths and match the local CLI. They were inspected, not re-fit in this incremental review.

## Privacy and excluded material

The 123 candidate files were scanned for personal Windows/POSIX paths, provider-token patterns, and literal credential assignments without printing values. No candidates were flagged. There are no native `.bkp`, `.apw`, `.apwz` files, commercial license files, private keys, environment files, or account configuration in the allowlist. Shared SVG/CSV exports and their tests are included.

Keep all of the following local and unstaged: `outputs/` (native copies, full run ledgers, screenshots, private configuration, local virtualenv and review reports), `analysis_data/`, `.library-cad-helpers/`, `extrudecad-web/`, `extrudecad-site.tar.gz`, `AGENTS.md`, `analysis_web/.vercel/`, and any `.env*` or `__pycache__/` files. `analysis_web/.vercel/project.json` is local/ignored; both the safe local server and `.vercelignore` exclude it. The previously moved `.env.local` is outside the public static directory. `analysis_web/.vercelignore` itself is intentionally included.

## Remaining unverified

This is a local release-readiness review, not a deployment. Actual Vercel Root Directory/project settings, live MIME/cache behavior, and remote published content were not checked. No fresh full-suite run was performed here; only the changed 17-test artifact subset was repeated after fixing the test dependency. Native-run validation and the browser acceptance record remain root-owned.

Machine-readable checks: `release-incremental-audit.json` and `release-allowlist-verification.json`. The index was empty at the end of this check. The allowlist is a snapshot: regenerate or inspect any subsequent new files before staging them.

## Checkout byte preservation — resolved

An isolated Git index and empty destination checkout, forced `core.autocrlf=true`, initially exposed that `text eol=lf` would change the frozen CRLF evidence bytes and invalidate the manifest. The final minimal `.gitattributes` uses `-text` for `analysis_web/data/generic-htl-*/*.json` and `universal_pipeline/fixtures/surrogate-demo.*.json`. It disables line-ending conversion while leaving normal JSON diff behavior available. No public JSON, fixture content, or manifest was regenerated. Unrelated JSON retains its existing attribute behavior.

The repeat checkout passed **14/14 public file byte hashes and sizes**, with all original public evidence bytes preserved; all **3/3 synthetic fixture copies** are also byte-identical. The real Git index was unchanged. `release-checkout-byte-audit.json` records the exact check. `.gitattributes` is included in the 123-file allowlist.

`universal_pipeline/site.test.mjs` now verifies every declared public JSON file's raw byte count and SHA256, the expected 14 files, and the absence of unlisted extra JSON (excluding the manifest itself). All 5 site tests pass; `git diff --check` passes. This is additional to the earlier 17 affected artifact/robustness tests. No release blocker remains from the checkout-byte audit.

## Production HTTP follow-up

After root published commit `512b166`, ordinary unauthenticated HTTP acceptance of `https://vercel-pi-ten-59.vercel.app/` passed for all five main pages, six module MIME/content checks, the public index and all 14 declared evidence files, and four sensitive-path 404 checks. This supersedes the earlier unverified-production note for these specific checks; Vercel project configuration itself was not modified or inspected. Details: `production-http-acceptance.md` / `.json`.
