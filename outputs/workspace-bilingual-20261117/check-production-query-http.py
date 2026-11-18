"""Incremental public HTTP acceptance; no authentication, browser, or source edits."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'analysis_web'
OUTPUT = Path(__file__).resolve().parent
ALIAS = 'https://vercel-pi-ten-59.vercel.app/'
FILES = [
    'browser-surrogate.mjs', 'model-query-view.mjs', 'model-query.css',
    'model-artifacts.mjs', 'model-artifact-data.mjs', 'models.html',
    'i18n-dictionary.mjs', 'docs-extension.mjs', 'README.md',
    'data/generic-htl-pilot/index.json',
    'data/generic-htl-extension/index.json',
    'data/generic-htl-extension/model.bundle.json',
]

def digest(content):
    return hashlib.sha256(content).hexdigest()

def check(path):
    local = (PUBLIC / path).read_bytes()
    result = {'path': path, 'local_bytes': len(local), 'local_sha256': digest(local)}
    try:
        request = Request(ALIAS + path, headers={
            'User-Agent': 'HTL-Public-Release-Acceptance/1.0',
            'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache',
        })
        with urlopen(request, timeout=35) as response:
            body = response.read()
            result.update(status=response.status, final_url=response.url,
                          content_type=response.headers.get('Content-Type', ''),
                          bytes=len(body), sha256=digest(body),
                          redirected=response.url != ALIAS + path)
        mime = result['content_type'].split(';', 1)[0].strip().lower()
        expected = ({'text/javascript', 'application/javascript'} if path.endswith('.mjs')
                    else {'text/css'} if path.endswith('.css')
                    else {'text/html'} if path.endswith('.html')
                    else {'application/json'} if path.endswith('.json') else None)
        result['mime_valid'] = expected is None or mime in expected
        result['local_bytes_match'] = body == local
        result['ok'] = (result['status'] == 200 and not result['redirected']
                        and result['mime_valid'] and result['local_bytes_match'])
        # Retain only parsed public evidence for additional assertions; never HTTP bodies in report.
        payload = json.loads(body) if path.endswith('.json') else None
        return result, payload
    except Exception as error:
        result.update(ok=False, error_type=type(error).__name__, error=str(error))
        return result, None

with ThreadPoolExecutor(max_workers=5) as pool:
    checked = list(pool.map(check, FILES))
rows = [row for row, _ in checked]
payloads = {row['path']: payload for row, payload in checked}
v1 = payloads.get('data/generic-htl-pilot/index.json') or {}
v2 = payloads.get('data/generic-htl-extension/index.json') or {}
bundle = next(row for row in rows if row['path'].endswith('/model.bundle.json'))
declared_bundle = (v2.get('files') or {}).get('model.bundle.json') or {}
binding = {
    'v2_manifest_bundle_bytes_match': bundle.get('bytes') == declared_bundle.get('bytes'),
    'v2_manifest_bundle_sha256_match': bundle.get('sha256') == declared_bundle.get('sha256'),
    'v1_remains_exploratory': v1.get('prediction_enabled') is False and v1.get('exploratory') is True,
    'v2_prediction_enabled': v2.get('prediction_enabled') is True and v2.get('exploratory') is False,
    'v2_physical_validation_false': v2.get('physical_validation') is False,
    'v2_counts_37_20_3_14_4_38': [v2.get(key) for key in [
        'native_case_count', 'training_count', 'holdout_count', 'verification_count',
        'fresh_verification_count', 'retained_native_run_count']] == [37, 20, 3, 14, 4, 38],
}
root_readme = (ROOT / 'README.md').read_bytes()
root_readme_git = subprocess.check_output(['git', 'show', 'cb8ce67:README.md'], cwd=ROOT)
not_public = {
    'path': 'README.md', 'reason': 'Repository-root documentation is outside the analysis_web static publication root.',
    'production_url': None, 'local_sha256': digest(root_readme),
    'matches_release_git_blob_bytes': root_readme == root_readme_git,
}
report = {
    'checked_at': datetime.now(timezone.utc).isoformat(),
    'production_alias': ALIAS, 'release_commit': 'cb8ce67',
    'deployment_id': 'dpl_BHZQYjbm3TVuWtLuiK65M8QajjTE',
    'request_authentication': 'Ordinary HTTPS without Authorization, Cookie, Vercel bypass headers, or browser session.',
    'scope': 'Incremental query assets, both package indexes, and v2 bundle only; no repeated full evidence sweep or unit tests.',
    'passed': all(row['ok'] for row in rows) and all(binding.values()),
    'summary': {'files_pass': sum(row['ok'] for row in rows), 'files_total': len(rows),
                'javascript_mime_pass': sum(row['ok'] for row in rows if row['path'].endswith('.mjs')),
                'javascript_total': sum(row['path'].endswith('.mjs') for row in rows),
                'css_mime_pass': sum(row['ok'] for row in rows if row['path'].endswith('.css')),
                'css_total': sum(row['path'].endswith('.css') for row in rows)},
    'files': rows, 'evidence_binding': binding, 'repository_only_document': not_public,
    'limitations': ['HTTP byte/MIME acceptance does not execute the browser workflow or establish physical validation.',
                    'Root README is checked against the release Git blob, not a nonexistent production route.'],
}
(OUTPUT / 'production-query-http-acceptance.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
markdown = ['# Production query HTTP acceptance', '',
            f"- Result: **{'PASS' if report['passed'] else 'FAIL'}** at {report['checked_at']}.",
            '- Release: `cb8ce67`; ordinary unauthenticated production alias HTTP.',
            f"- Exact published bytes and successful MIME: {report['summary']['files_pass']}/{len(rows)} assets.",
            '- Six JavaScript modules, one CSS file, models page, public README, two package indexes, and v2 model bundle checked.',
            '- Public v2 bundle SHA256 and byte length match its public index and local frozen file.',
            '- v1 remains exploratory; v2 permits predictions, with physical validation false and 37/20/3/14/fresh4/38 counts retained.',
            '- Root README is outside the static directory and has no production route; its local release content was checked separately.',
            '- No full 35-file sweep, browser operations, native Aspen run, source edits, or repeated unit tests.', '',
            '| Path | HTTP | Byte match | MIME |', '|---|---:|---|---|']
for row in rows:
    markdown.append(f"| `{row['path']}` | {row.get('status', 'error')} | {row.get('local_bytes_match', False)} | `{row.get('content_type', '')}` |")
(OUTPUT / 'production-query-http-acceptance.md').write_text('\n'.join(markdown) + '\n', encoding='utf-8')
print(json.dumps({'passed': report['passed'], 'summary': report['summary'],
                  'evidence_binding': binding, 'repository_root_readme_matches_git_blob': not_public['matches_release_git_blob_bytes']}, indent=2))
raise SystemExit(0 if report['passed'] else 1)
