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

test('manifest is fetched first, is small, and carries one record per case and scenario', async () => {
  const {calls, fetchJson} = counting(), loader = createStudyLoader({fetchJson});
  const manifest = await loader.manifest();
  assert.deepEqual(calls, ['manifest.json']);
  assert.equal(manifest.schema, 'aspen-study/2');
  assert.ok((await stat(new URL('manifest.json', studyDir))).size < 128 * 1024);
  assert.deepEqual(manifest.scenarios.map(s => s.id), ['HR', 'STD']);
  assert.equal(manifest.default_scenario, 'HR');
  assert.equal(await loader.defaultScenario(), 'HR');
  assert.equal(manifest.cases.length, 47 * 2);
  assert.equal(new Set(manifest.cases.map(c => `${c.id}/${c.scenario}`)).size, manifest.cases.length, '(id, scenario) is unique');
  for (const c of manifest.cases) {
    assert.ok(c.case_params && c.kpi && c.completeness, c.id);
    assert.equal(c.kpi.max_balance_ratio, null, 'balance is not in pipeline.json: null, never 0');
    for (const key of [...Object.keys(c.kpi), ...Object.keys(c.case_params), ...Object.keys(c.completeness)]) assert.doesNotMatch(key, /_(STD|HR)$/i, `scenario suffix in ${key}`);
    assert.equal(Object.hasOwn(c, 'file'), false, 'no five-table file for these cases');
    assert.equal(c.has_results, Object.hasOwn(c, 'result'));
    for (const comp of Object.values(c.completeness)) assert.deepEqual([comp.status, comp.complete], ['unknown', false], 'total-only GWP is unknown, not complete');
  }
  assert.deepEqual(manifest.variables.map(v => v.id), ['temperature_C', 'length_m']);
  assert.equal(manifest.model.simulator, 'Aspen Plus');
  assert.match(manifest.model.source_sha256, /^[0-9a-f]{64}$/);
});

test('case shards are lazy and cached; has_results=false cases need no request', async () => {
  const {calls, fetchJson} = counting(), loader = createStudyLoader({fetchJson});
  const manifest = await loader.manifest();
  const withResults = manifest.cases.filter(c => c.has_results);
  assert.equal(withResults.length, 6);
  assert.ok(withResults.some(c => c.scenario === 'STD' && c.result === `results/${c.id}__STD.json`), 'non-default scenario file name');
  assert.ok(withResults.some(c => c.scenario === 'HR' && c.result === `results/${c.id}.json`));
  const hr = withResults.find(c => c.scenario === 'HR'), std = withResults.find(c => c.scenario === 'STD' && c.id === hr.id);
  const [a, b] = await Promise.all([loader.caseResult(hr.id), loader.caseResult(hr.id, 'HR')]);
  assert.deepEqual(a, b);
  assert.equal(a.scenario, 'HR');
  await loader.caseResult(hr.id);
  assert.deepEqual(calls, ['manifest.json', hr.result], 'one request per shard, nothing else');
  assert.equal((await loader.caseResult(std.id, 'STD')).scenario, 'STD');
  const archived = manifest.cases.find(c => !c.has_results);
  assert.equal(await loader.caseResult(archived.id, archived.scenario), null);
  assert.equal(await loader.caseProject(archived.id), null);
  assert.equal(calls.length, 3, 'summary-only cases cost nothing');
  await assert.rejects(loader.caseResult('no-such-case'), /Unknown case/);
  await assert.rejects(loader.caseResult(hr.id, 'LOW'), /Unknown case/);
});

test('missing values stay null/empty, never 0; results reference factor_id only', async () => {
  const loader = createStudyLoader({fetchJson: fsJsonFetcher(studyDir)});
  const manifest = await loader.manifest();
  const factors = await loader.factors();
  assert.equal(factors.schema, 'aspen-factors-snapshot/1');
  assert.ok(factors.factors.length >= 5 && factors.factors.every(f => f.value >= 0 && f.source && f.unit && f.impact_unit));
  for (const entry of manifest.cases.filter(c => c.has_results)) {
    const result = await loader.caseResult(entry.id, entry.scenario);
    assert.deepEqual([result.energy_edges, result.internal_loops, result.balance, result.contributions], [[], [], [], []]);
    assert.equal(result.energy.hot_utility_kW, null);
    assert.equal(result.energy.cold_utility_kW, null);
    assert.equal(result.completeness.GWP.status, 'unknown');
    assert.equal(result.completeness.GWP.lower_bound, null);
    assert.equal(result.completeness.GWP.total, entry.kpi.gwp_per_fu);
    assert.equal(result.method.factors_snapshot, 'factors.json');
    for (const source of result.method.factor_sources) assert.ok(factors.factors.some(f => f.id === source.factor_id));
    const balance = result.gates.find(g => g.id === 'G3_balance');
    assert.equal(balance.status, 'not_run');
    for (const g of result.gates) assert.ok(g.messages.length > 0);
    if (entry.scenario === 'STD') assert.ok(result.warnings.some(w => /reconstructed/.test(w)));
  }
});

test('surrogate part is separate from Aspen results and described by surrogate.json', async () => {
  const {calls, fetchJson} = counting(), loader = createStudyLoader({fetchJson});
  const descriptor = await loader.surrogate();
  assert.equal(descriptor.schema, 'aspen-surrogate/1');
  assert.equal(descriptor.prediction_enabled, true);
  assert.deepEqual(descriptor.inputs.map(i => i.id), ['temperature_C', 'length_m']);
  assert.ok(descriptor.metrics.holdout.target_kg_h.median_APE_pct >= 0 && descriptor.metrics.fresh);
  assert.equal(descriptor.data_source.reference_count, 121);
  assert.deepEqual((await loader.robustnessScenarios()).sort(), ['HR', 'STD']);
  assert.ok(!calls.some(p => p.startsWith('results/')), 'describing the surrogate needs no Aspen result shard');
});

test('htlAnalysis() rebuilds the legacy analysis object from shards', async () => {
  const {calls, fetchJson} = counting(), loader = createStudyLoader({fetchJson});
  const analysis = await loader.htlAnalysis();
  assert.equal(analysis.grid.rows.length, 81 * 61);
  assert.deepEqual(Object.keys(analysis.grid.rows[0]).slice(0, 3), ['temperature_C', 'length_m', 'target_kg_h']);
  assert.deepEqual(Object.keys(analysis.robustness.scenarios).sort(), ['HR', 'STD']);
  assert.equal(analysis.prediction_enabled, true);
  assert.ok(!calls.some(p => p.startsWith('results/')), 'no per-case result shard needed for the prediction page');
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
  await assert.rejects(createStudyLoader({fetchJson: async () => ({schema: 'aspen-study/2', cases: [], shards: {}})}).surrogate(), /no surrogate descriptor/);
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
    'manifest.json': {schema: 'aspen-study/2', cases: [], shards: {surrogate: 'surrogate/surrogate.json', extra: {observations: 'observations.json'}}},
    'surrogate/surrogate.json': {schema: 'aspen-surrogate/1', grid_files: ['surrogate/grid.json'], extra_files: {details: 'surrogate/details.json'}},
    'surrogate/grid.json': {temperature_step_C: 0.5, length_step_m: 0.25, columns: [], data: []},
    'surrogate/details.json': {prediction_enabled: false, status: 'validation_failed', grid: {temperature_step_C: 0.5, length_step_m: 0.25}, robustness: null},
    'observations.json': {rows: [], sources: []},
  };
  const loader = createStudyLoader({fetchJson: async path => structuredClone(files[path])});
  const analysis = await loader.htlAnalysis();
  assert.equal(analysis.prediction_enabled, false);
  assert.deepEqual(analysis.grid.rows, []);
  assert.equal(analysis.robustness, null);
});
