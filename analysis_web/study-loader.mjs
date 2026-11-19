// Loader for aspen-study/2 packages (manifest first, shards on demand, cached).
// Browser: createStudyLoader({base:'data/study/'}); Node/tests: createStudyLoader({fetchJson:fsJsonFetcher(dir)}).
export const SUPPORTED_SCHEMA_MAJOR = 2;
const RELPATH = /^(?!\/)(?!.*\.\.)(?![A-Za-z]:)[A-Za-z0-9_./-]+$/;

export function safeRelPath(path) {
  if (typeof path !== 'string' || !RELPATH.test(path)) throw new Error(`Unsafe study path: ${String(path)}`);
  return path;
}

export function schemaMajor(schema) {
  const match = /^aspen-study\/(\d+)$/.exec(String(schema));
  return match ? Number(match[1]) : null;
}

function browserFetcher(base) {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return async path => {
    const response = await fetch(prefix + path);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${prefix + path}`);
    return response.json();
  };
}

// Node-only helper; the dynamic import keeps this module loadable in browsers.
export function fsJsonFetcher(dir) {
  return async path => {
    const {readFile} = await import('node:fs/promises');
    const {join} = await import('node:path');
    const {fileURLToPath} = await import('node:url');
    const root = dir instanceof URL ? fileURLToPath(dir) : String(dir);
    return JSON.parse(await readFile(join(root, safeRelPath(path)), 'utf8'));
  };
}

export function createStudyLoader({base = 'data/study/', fetchJson} = {}) {
  const getJson = fetchJson || browserFetcher(base);
  const cache = new Map();
  const requested = [];

  function shard(path) {
    safeRelPath(path);
    if (!cache.has(path)) {
      requested.push(path);
      const pending = getJson(path).catch(error => { cache.delete(path); throw error; });
      cache.set(path, pending);
    }
    return cache.get(path);
  }

  async function manifest() {
    const value = await shard('manifest.json');
    if (schemaMajor(value.schema) !== SUPPORTED_SCHEMA_MAJOR) throw new Error(`Unsupported study schema: ${value.schema}`);
    return value;
  }

  async function caseEntry(id) {
    const entry = (await manifest()).cases.find(c => c.id === id);
    if (!entry) throw new Error(`Unknown case: ${id}`);
    return entry;
  }

  async function extra(name) {
    const path = (await manifest()).shards?.extra?.[name];
    if (!path) throw new Error(`Study has no "${name}" shard`);
    return shard(path);
  }

  // One case's aspen-results/1 record (lazy: fetches results/<id>.json once).
  async function caseResult(id) {
    const entry = await caseEntry(id);
    const file = await shard(entry.result);
    const record = file.cases.find(c => c.case === id);
    if (!record) throw new Error(`Result shard ${entry.result} has no case ${id}`);
    return {...record, contributions: file.contributions.filter(c => c.case === id), method: file.method};
  }

  async function caseProject(id) { return shard((await caseEntry(id)).file); }

  async function summary() {
    const path = (await manifest()).shards?.summary;
    if (!path) throw new Error('Study has no summary shard');
    return shard(path);
  }

  async function surrogateGrid() {
    const m = await manifest();
    const path = (m.shards.surrogate || []).find(p => p.endsWith('/grid.json'));
    if (!path) throw new Error('Study has no surrogate grid');
    const {columns, data, ...rest} = await shard(path);
    return {...rest, rows: data.map(values => Object.fromEntries(columns.map((column, i) => [column, values[i]])))};
  }

  async function robustness(scenario) {
    const m = await manifest();
    const path = (m.shards.surrogate || []).find(p => p.endsWith(`/robustness-${scenario}.json`));
    if (!path) throw new Error(`Study has no robustness shard for ${scenario}`);
    return (await shard(path)).rows;
  }

  async function robustnessScenarios() {
    const m = await manifest();
    return (m.shards.surrogate || []).map(p => /\/robustness-([^/]+)\.json$/.exec(p)?.[1]).filter(Boolean);
  }

  const observations = () => extra('observations');

  // Rebuilds the legacy HTL `analysis` object (the former data/pipeline.json) from shards.
  async function htlAnalysis() {
    await manifest();
    const [meta, grid, scenarios] = await Promise.all([extra('meta'), surrogateGrid(), robustnessScenarios()]);
    const rows = await Promise.all(scenarios.map(robustness));
    const {robustness: robustnessMeta, grid: gridMeta, ...rest} = meta;
    const analysis = {...rest, grid: {...gridMeta, rows: grid.rows}};
    analysis.robustness = robustnessMeta === null ? null
      : {...robustnessMeta, scenarios: Object.fromEntries(scenarios.map((name, i) => [name, rows[i]]))};
    return analysis;
  }

  return {manifest, shard, caseEntry, caseResult, caseProject, summary, surrogateGrid, robustness, robustnessScenarios,
    observations, htlAnalysis, requested: () => [...requested]};
}
