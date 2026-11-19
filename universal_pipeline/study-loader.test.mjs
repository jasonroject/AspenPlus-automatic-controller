import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import {extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStudyLoader, fsJsonFetcher, safeRelPath, schemaMajor} from '../analysis_web/study-loader.mjs';

const studyDir = new URL('../analysis_web/data/study/', import.meta.url);
const webRoot = fileURLToPath(new URL('../analysis_web/', import.meta.url));
const counting = (dir = studyDir) => {
  const inner = fsJsonFetcher(dir), calls = [];
  return {calls, fetchJson: async path => { calls.push(path); return inner(path); }};
};

test('manifest is fetched first, is small, and carries per-case params/kpi/completeness', async () => {
  const {calls, fetchJson} = counting(), loader = createStudyLoader({fetchJson});
  const manifest = await loader.manifest();
  assert.deepEqual(calls, ['manifest.json']);
  assert.equal(manifest.schema, 'aspen-study/2');
  assert.ok((await stat(new URL('manifest.json', studyDir))).size < 64 * 1024);
  assert.ok(manifest.cases.length >= 40);
  for (const c of manifest.cases) {
    assert.ok(c.case_params && c.kpi && c.completeness, c.id);
    assert.equal(Object.hasOwn(c.kpi, 'max_balance_ratio'), true);
    assert.equal(c.kpi.max_balance_ratio, null, 'balance is not in pipeline.json: null, never 0');
  }
  assert.deepEqual(manifest.variables.map(v => v.id), ['temperature_C', 'length_m']);
});

test('case shards are lazy and cached; surrogate shards are not touched by case loads', async () => {
  const {calls, fetchJson} = counting(), loader = createStudyLoader({fetchJson});
  const manifest = await loader.manifest();
  const id = manifest.cases[0].id;
  const [a, b] = await Promise.all([loader.caseResult(id), loader.caseResult(id)]);
  assert.equal(a.case, id);
  assert.deepEqual(a, b);
  await loader.caseResult(id);
  assert.deepEqual(calls, ['manifest.json', manifest.cases[0].result], 'one request per shard, nothing else');
  const project = await loader.caseProject(id);
  assert.equal(project.schema_version, 1);
  assert.equal(calls.length, 3);
  await assert.rejects(loader.caseResult('no-such-case'), /Unknown case/);
});

test('missing values stay null/empty, never 0', async () => {
  const loader = createStudyLoader({fetchJson: fsJsonFetcher(studyDir)});
  const manifest = await loader.manifest();
  for (const entry of manifest.cases) {
    const result = await loader.caseResult(entry.id);
    assert.deepEqual([result.energy_edges, result.internal_loops, result.balance, result.contributions], [[], [], [], []]);
    assert.equal(result.energy.hot_utility_kW, null);
    assert.equal(result.energy.cold_utility_kW, null);
    const balance = result.gates.find(g => g.id === 'G3_balance');
    assert.ok(['not_run', 'pass', 'warn', 'fail'].includes(balance.status));
    for (const g of result.gates) assert.ok(g.messages.length > 0);
  }
});

test('htlAnalysis() rebuilds the legacy analysis object from shards', async () => {
  const {calls, fetchJson} = counting(), loader = createStudyLoader({fetchJson});
  const analysis = await loader.htlAnalysis();
  assert.equal(analysis.grid.rows.length, 81 * 61);
  assert.deepEqual(Object.keys(analysis.grid.rows[0]).slice(0, 3), ['temperature_C', 'length_m', 'target_kg_h']);
  assert.deepEqual(Object.keys(analysis.robustness.scenarios).sort(), ['HR', 'STD']);
  assert.equal(analysis.prediction_enabled, true);
  assert.ok(!calls.some(p => p.startsWith('results/') || p.startsWith('cases/')), 'no per-case shard needed for the prediction page');
  const again = await loader.htlAnalysis();
  assert.equal(calls.length, new Set(calls).size, 'no shard fetched twice');
  assert.deepEqual(again.grid.rows[100], analysis.grid.rows[100]);
  const source = new URL('../outputs/htl_pipeline/pipeline.json', import.meta.url);
  if (fs.existsSync(fileURLToPath(source))) assert.deepEqual(analysis, JSON.parse(fs.readFileSync(source, 'utf8')), 'lossless vs pipeline.json');
});

test('unsafe paths, unknown major versions and failed fetches are rejected without poisoning the cache', async () => {
  for (const bad of ['../x.json', '/etc/passwd', 'C:/x.json', 'a/../../b.json', '', null]) assert.throws(() => safeRelPath(bad), /Unsafe/);
  assert.equal(safeRelPath('results/summary.json'), 'results/summary.json');
  assert.equal(schemaMajor('aspen-study/2'), 2);
  assert.equal(schemaMajor('aspen-study/3'), 3);
  assert.equal(schemaMajor('nonsense'), null);
  const v3 = createStudyLoader({fetchJson: async () => ({schema: 'aspen-study/3', cases: []})});
  await assert.rejects(v3.manifest(), /Unsupported study schema/);
  let fail = true, hits = 0;
  const flaky = createStudyLoader({fetchJson: async () => { hits++; if (fail) throw new Error('offline'); return {schema: 'aspen-study/2', cases: [], shards: {}}; }});
  await assert.rejects(flaky.manifest(), /offline/);
  fail = false;
  assert.equal((await flaky.manifest()).schema, 'aspen-study/2');
  assert.equal(hits, 2);
  await assert.rejects(createStudyLoader({fetchJson: async () => ({schema: 'aspen-study/2', cases: [], shards: {}})}).observations(), /no "observations" shard/);
});

test('real HTTP: static server + browser-style fetch loads manifest then shards; pipeline page references the loader', async () => {
  const types = {'.json': 'application/json', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript'};
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    requests.push(path);
    try { const body = await readFile(join(webRoot, path)); res.writeHead(200, {'content-type': types[extname(path)] || 'application/octet-stream'}); res.end(body); }
    catch { res.writeHead(404); res.end('missing'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const loader = createStudyLoader({base: `${base}/data/study/`});
    const analysis = await loader.htlAnalysis();
    assert.equal(requests[0], 'data/study/manifest.json');
    assert.ok(analysis.grid.rows.length > 0 && analysis.robustness.scenarios.HR.length > 0);
    assert.ok((await loader.observations()).rows.length === 47);
    assert.equal((await fetch(`${base}/pipeline.html`)).status, 200);
    assert.equal((await fetch(`${base}/data/pipeline.json`)).status, 404, 'monolithic pipeline.json is gone');
    const page = await (await fetch(`${base}/pipeline.js?v=3`)).text();
    assert.match(page, /createStudyLoader/);
    assert.doesNotMatch(page, /fetch\('data\/pipeline/);
    const missing = createStudyLoader({base: `${base}/data/nope/`});
    await assert.rejects(missing.manifest(), /HTTP 404/);
  } finally { server.close(); }
});

test('a disabled package (failed gate: empty grid, no robustness) loads as a disabled analysis', async () => {
  const files = {
    'manifest.json': {schema: 'aspen-study/2', cases: [], shards: {surrogate: ['surrogate/grid.json'], extra: {meta: 'meta.json', observations: 'observations.json'}}},
    'surrogate/grid.json': {temperature_step_C: 0.5, length_step_m: 0.25, columns: [], data: []},
    'meta.json': {prediction_enabled: false, status: 'validation_failed', grid: {temperature_step_C: 0.5, length_step_m: 0.25}, robustness: null},
    'observations.json': {rows: [], sources: []},
  };
  const loader = createStudyLoader({fetchJson: async path => structuredClone(files[path])});
  const analysis = await loader.htlAnalysis();
  assert.equal(analysis.prediction_enabled, false);
  assert.deepEqual(analysis.grid.rows, []);
  assert.equal(analysis.robustness, null);
});
