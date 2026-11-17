import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Execute both actual legacy entry scripts. The data request remains pending;
// rendering and WebGL are outside this URL/persistence regression check.
function workspace(filename, {url, storage = new Map()} = {}) {
  const nodes = new Map(), events = new Map();
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '', dataset: {}, options: [], hidden: false,
      classList: {toggle() {}}, setAttribute() {}, removeAttribute() {},
      addEventListener(name, handler) { events.set(`${selector}:${name}`, handler); },
    });
    return nodes.get(selector);
  }
  for (const [key, value] of [['yield', 60], ['char', 20], ['cf', 20]]) node(`#weight-${key}`).value = value;
  node('#temperature-filter').options = ['', '310', '330'].map(value => ({value}));
  node('#scenario-filter').options = ['', 'STD', 'HR'].map(value => ({value}));
  const tabs = ['device', 'compare'].map(value => {const tab = node(`tab:${value}`); tab.dataset.resultTab = value; return tab;});
  const location = new URL(url || `http://127.0.0.1:8766/${filename === 'app.js' ? 'workspace.zh.html' : 'index.en.html'}?test=language#view=process&case=T310-L5-HR&weights=60%2C20%2C20`);
  const historyCalls = [];
  const history = Object.fromEntries(['pushState', 'replaceState'].map(method => [method, (_, __, value) => {historyCalls.push(method); location.href = new URL(value, location).href;}]));
  const context = vm.createContext({URLSearchParams, location, history, console,
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
    document: {body: {dataset: {}}, fonts: {ready: new Promise(() => {})}, querySelector: node, querySelectorAll: selector => selector === '[data-result-tab]' ? tabs : [], addEventListener() {}},
    window: {addEventListener: (name, handler) => events.set(name, handler), scrollTo() {}, htlPlant: {mount() {}}},
    fetch: () => new Promise(() => {}),
  });
  vm.runInContext(readFileSync(new URL(`../analysis_web/${filename}`, import.meta.url), 'utf8') + `
    renderPlant = renderSelection = renderOverview = renderScreening = renderCases = () => {};
    globalThis.controls = {state, requestedWorkspace, restoreWorkspaceControls, saveWorkspace, selectEquipment, setResultTab};
  `, context);
  const controls = context.controls;
  controls.state.data = {cases: [{id: 'T310-L5-HR', condition_id: 'T310-L5', scenario: 'HR'}]};
  controls.state.condition = 'T310-L5';
  controls.state.scenario = 'HR';
  controls.state.view = 'process';
  return {...controls, location, node, events, storage, historyCalls};
}

for (const [source, target] of [['app.js', 'app.en.js'], ['app.en.js', 'app.js']]) {
  test(`${source}: language transition preserves equipment, result tab and filters without changing case or weights`, () => {
    const from = workspace(source);
    from.selectEquipment('separator');
    from.setResultTab('compare');
    from.node('#temperature-filter').value = '310';
    from.node('#scenario-filter').value = 'HR';
    from.node('#case-search').value = 'T310 & 木质素';
    from.events.get('#case-search:input')();
    const address = new URL(from.location);
    address.pathname = target === 'app.js' ? '/workspace.zh.html' : '/index.en.html';
    const to = workspace(target, {url: address.href, storage: from.storage});
    const restored = to.requestedWorkspace();
    to.restoreWorkspaceControls(restored);
    assert.equal(to.state.equipment, 'separator');
    assert.equal(to.state.resultTab, 'compare');
    assert.equal(to.node('#result-compare').hidden, false);
    assert.equal(to.node('#result-device').hidden, true);
    assert.equal(restored.case, 'T310-L5-HR');
    assert.equal(restored.view, 'process');
    assert.deepEqual(Array.from(restored.weights), [60, 20, 20]);
    assert.equal(to.node('#temperature-filter').value, '310');
    assert.equal(to.node('#scenario-filter').value, 'HR');
    assert.equal(to.node('#case-search').value, 'T310 & 木质素');
    assert.equal(to.location.search, '?test=language');
    assert.ok(from.historyCalls.every(method => method === 'replaceState'));
    to.location.hash = '';
    assert.equal(to.requestedWorkspace().equipment, 'separator', 'both languages share saved state');
  });

  test(`${source}: browser back restores controls and rejects unknown device identifiers`, () => {
    const app = workspace(source);
    app.selectEquipment('separator');
    app.setResultTab('compare');
    const savedHash = app.location.hash;
    app.selectEquipment('heater');
    app.location.hash = savedHash;
    const count = app.historyCalls.length;
    app.events.get('popstate')();
    assert.equal(app.state.equipment, 'separator');
    assert.equal(app.state.resultTab, 'compare');
    assert.equal(app.historyCalls.length, count, 'history restoration adds no navigation entry');
    app.selectEquipment('unknown-device');
    assert.equal(app.state.equipment, 'separator');
    app.location.hash = '#view=process&case=T310-L5-HR&equipment=unknown&tab=unknown&temperature=999&scenario=invalid';
    app.events.get('popstate')();
    assert.equal(app.state.equipment, 'reactor');
    assert.equal(app.state.resultTab, 'device');
    assert.equal(app.node('#temperature-filter').value, '');
    assert.equal(app.node('#scenario-filter').value, '');
  });
}
