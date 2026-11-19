import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {advise, blockFromPath, classifyBundle, energyRows, loadRules, upgradeSummary, AdviceInputError, num} from '../analysis_web/aspen-advice.mjs';
import {adviceHTML, energyHTML, headerHTML} from '../analysis_web/aspen-advice-view.mjs';
import {readZipJson} from '../analysis_web/aspen-zip.mjs';
const FIX = new URL('../aspen_study/tests/fixtures/probe/', import.meta.url);
const load = async n => JSON.parse(await readFile(new URL(n, FIX), 'utf8'));
const rules = await loadRules();
const docs = async (...names) => Promise.all(names.map(async n => ({name: n, data: await load(n)})));

test('heatrecovery (warnings) equals the Python golden output', async () => {
  const [s, g, r] = [await load('heatrecovery.probe-summary.json'), await load('heatrecovery.graph.json'), await load('heatrecovery.roles.json')];
  const adv = advise(s, g, r, rules);
  assert.deepEqual(adv, await load('heatrecovery.advice.json'));
  const ids = new Set(adv.items.map(i => i.id));
  for (const id of ['thermo.phase-stability:COOLER', 'thermo.phase-stability:VALVE', 'reaction.rate-zero:REACTOR', 'energy.warning-share', 'heat-integration.overlap:COOLER:B6', 'lca-readiness.product-low-confidence:S8']) assert.ok(ids.has(id), id);
  assert.equal(adv.items.find(i => i.id === 'thermo.phase-stability:HEATCHAG').severity, 'suggest');
  assert.ok(adv.items.every(i => typeof i.target === 'string' && i.evidence.every(e => typeof e.path === 'string')));
});

test('mch (clean) equals the Python golden output and has no warnings', async () => {
  const adv = advise(await load('mch.probe-summary.json'), null, null, rules);
  assert.deepEqual(adv, await load('mch.advice.json'));
  assert.equal(adv.counts.warn + adv.counts.critical, 0);
});

test('aspen-probe/1.0 files are upgraded and give the same advice as the 1.1 fixture', async () => {
  const old = await load('heatrecovery.probe-summary.v1.0.json');
  const up = upgradeSummary(old, rules);
  assert.equal(up.schema, 'aspen-probe/1.1');
  assert.deepEqual(up, await load('heatrecovery.probe-summary.json'));
  assert.equal(up.group_totals.overall.complete, true);
  assert.equal(old.schema, 'aspen-probe/1', 'input must not be mutated');
});

test('num rounds half away from zero and trims zeros', () => {
  assert.equal(num(2.5, 0), '3'); assert.equal(num(8.739993, 2), '8.74'); assert.equal(num(100, 2), '100'); assert.equal(num(-0.001), '0');
});

test('classifyBundle accepts any file order and detects by schema, not by name', async () => {
  const d = (await docs('heatrecovery.roles.json', 'heatrecovery.probe-summary.json', 'heatrecovery.graph.json')).map((x, i) => ({...x, name: `weird-${i}.json`}));
  const b = classifyBundle(d, rules);
  assert.ok(b.graph && b.roles && b.summary.schema === 'aspen-probe/1.1');
  assert.deepEqual(b.warnings, []);
});

test('wrong inputs fail with clear Chinese errors', async () => {
  const bad = (d, re) => assert.throws(() => classifyBundle(d, rules), e => e instanceof AdviceInputError && re.test(e.message), re.source);
  bad([], /没有收到文件/);
  bad([{name: 'a.json', data: [1, 2]}], /不是 JSON 对象/);
  bad([{name: 'a.json', data: {foo: 1}}], /没有认出 schema/);
  bad([{name: 'a.json', data: {schema: 'aspen-probe/9'}}], /版本是 aspen-probe\/9/);
  bad(await docs('heatrecovery.graph.json'), /缺少 probe-summary\.json/);
  const s = await load('heatrecovery.probe-summary.json');
  delete s.blocks;
  bad([{name: 's.json', data: s}], /不符合 aspen-probe\/1\.1/);
  const broken = await load('heatrecovery.probe-summary.v1.0.json');
  broken.model.sha256 = 'zz';
  bad([{name: 's.json', data: broken}], /model\.file \/ model\.sha256/);
  const g = await load('heatrecovery.graph.json');
  delete g.streams;
  bad([{name: 's.json', data: await load('heatrecovery.probe-summary.json')}, {name: 'g.json', data: g}], /不是完整的 graph\.json/);
  const roles = await load('heatrecovery.roles.json');
  delete roles.streams;
  bad([{name: 's.json', data: await load('heatrecovery.probe-summary.json')}, {name: 'r.json', data: roles}], /不是完整的 roles\.json/);
});

test('files from different runs are rejected before analysis (same semantics as result_package)', async () => {
  const sum = await docs('heatrecovery.probe-summary.json'), graph = await docs('heatrecovery.graph.json'), roles = await docs('heatrecovery.roles.json');
  const rejected = (d, re) => assert.throws(() => classifyBundle(d, rules), e => e instanceof AdviceInputError && re.test(e.message), String(re));
  graph[0].data.model.sha256 = 'c'.repeat(64);
  rejected([...sum, ...graph], /graph\.json 与 probe-summary\.json 来自不同的模型/);
  const g2 = await docs('heatrecovery.graph.json'); g2[0].data.blocks.pop();
  rejected([...sum, ...g2], /块与 graph\.json 的块不一致/);
  const r2 = await docs('heatrecovery.roles.json'); delete r2[0].data.streams.S2;
  rejected([...sum, ...(await docs('heatrecovery.graph.json')), ...r2], /roles\.json 的流股与 graph\.json 的流股不一致/);
  const s2 = await docs('heatrecovery.probe-summary.json'); s2[0].data.model.source_unchanged = false;
  rejected(s2, /源模型文件被改动/);
  // summary 单独、或 summary + graph 都可以分析：缺的检查会在建议里说明
  assert.doesNotThrow(() => classifyBundle(sum, rules));
});

test('advise() itself reports a roles file from another model instead of throwing', async () => {
  const s = await load('heatrecovery.probe-summary.json');
  const other = {...await load('heatrecovery.roles.json'), model_sha256: 'b'.repeat(64)};
  const adv = advise(s, null, other, rules);
  assert.ok(adv.items.some(i => i.rule === 'lca-readiness.sha-mismatch'));
  const b = classifyBundle([{name: 'a.json', data: structuredClone(s)}, {name: 'b.json', data: structuredClone(s)}], rules);
  assert.match(b.warnings[0], /收到多个 probe-summary/);
});

test('zip bundle (deflate, files under a folder) is read in the browser path', async () => {
  const buf = await readFile(new URL('heatrecovery.bundle.zip', FIX));
  const files = await readZipJson(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'x.zip');
  assert.deepEqual(files.map(f => f.name).sort(), ['graph.json', 'probe-summary.json', 'roles.json']);
  const b = classifyBundle(files.map(f => ({name: f.name, data: JSON.parse(f.text)})), rules);
  assert.equal(b.names.graph, 'graph.json');
  await assert.rejects(readZipJson(new TextEncoder().encode('not a zip at all, definitely not').buffer, 'bad.zip'), /不是有效的 zip/);
});

test('rendering escapes content and shows evidence, energy table and totals', async () => {
  const s = await load('heatrecovery.probe-summary.json');
  s.blocks[0].id = '<img src=x onerror=alert(1)>';
  const adv = advise(s, null, null, rules);
  const html = adviceHTML(adv) + energyHTML(energyRows(s)) + headerHTML({summary: s, names: {summary: 'a', graph: null, roles: null}, warnings: ['<b>x</b>']}, adv);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x'));
  assert.match(html, /内部换热/);
  assert.match(html, /净值/);
  assert.match(html, /data-severity="warn"/);
  const rows = energyRows(s);
  assert.equal(rows.totals.internal_exchange.kW, 40.501385);
});

test('rule table carries thresholds only, no emission-factor style numbers', async () => {
  assert.ok(!JSON.stringify(rules).toLowerCase().includes('kgco2'));
  assert.equal(rules.schema, 'aspen-advice-rules/1');
});

test('requires: missing graph / roles skips whole rules (recorded in skipped), no separate no-roles item', async () => {
  const s = await load('heatrecovery.probe-summary.json');
  assert.ok(!('lca-readiness.no-roles' in rules.rules));
  assert.ok(Object.values(rules.rules).every(r => Array.isArray(r.requires) && r.requires.every(x => ['graph', 'roles'].includes(x))));
  const adv = advise(s, null, null, rules);
  const by = Object.fromEntries(adv.skipped.map(x => [x.rule, x]));
  for (const id of ['heat-integration.overlap', 'heat-integration.none', 'heat-integration.data-missing', 'convergence.mass-balance']) assert.deepEqual(by[id].missing_inputs, ['graph'], id);
  for (const id of ['lca-readiness.roles-draft', 'lca-readiness.no-product', 'lca-readiness.no-factor-key']) { assert.deepEqual(by[id].missing_inputs, ['roles'], id); assert.match(by[id].reason_zh, /roles\.json/); }
  assert.ok(!adv.items.some(i => i.rule.startsWith('lca-readiness.') && i.rule !== 'lca-readiness.sha-mismatch'));
  assert.ok(!adv.items.some(i => i.rule.startsWith('heat-integration.')));
  const withAll = advise(s, await load('heatrecovery.graph.json'), await load('heatrecovery.roles.json'), rules);
  assert.ok(!withAll.skipped.some(x => 'missing_inputs' in x));
  const graphOnly = advise(s, await load('heatrecovery.graph.json'), null, rules);
  assert.ok(graphOnly.skipped.every(x => !x.missing_inputs || x.missing_inputs.join() === 'roles'));
});

test('probe 1.0 upgrade fills energy_gaps / unverified_paths block from the node path (null only if unparseable)', async () => {
  const old = await load('heatrecovery.probe-summary.v1.0.json');
  old.energy_gaps = ['B3（Sep）heat：QCALC/QNET 都读不到', '流股类别 X'];
  old.discovery.unverified_paths = ['\\Data\\Blocks\\COOLER\\Output\\QCALC', '\\Data\\Streams\\S1'];
  const up = upgradeSummary(old, rules);
  assert.deepEqual(up.energy_gaps.map(g => g.block), ['B3', null]);
  assert.deepEqual(up.unverified_paths.map(u => u.block), ['COOLER', null]);
  assert.equal(blockFromPath('\\Data\\Blocks\\E-100\\Output\\QCALC'), 'E-100');
  assert.equal(blockFromPath(''), null);
});

test('live 1.1 outputs (heatrecovery, mch, Methane Pyrolysis, no-result membrane) equal the Python golden advice', async () => {
  const L = n => load('live11/' + n);
  const cases = [['hr', true, true], ['mch', true, false], ['methane', true, false], ['membrane', false, false]];
  for (const [k, g, r] of cases) {
    const adv = advise(await L(`${k}.probe-summary.json`), g ? await L(`${k}.graph.json`) : null, r ? await L(`${k}.roles.json`) : null, rules);
    assert.deepEqual(adv, await L(`${k}.advice.json`), k);
  }
  const mem = await L('membrane.advice.json');
  assert.ok(mem.items.some(i => i.id === 'status.error' && i.severity === 'critical'));
});
