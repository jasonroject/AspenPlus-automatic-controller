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

  const manifestShards = async () => (await manifest()).shards || {};

  // A case is identified by (id, scenario); scenario defaults to the manifest's default_scenario.
  async function caseEntry(id, scenario) {
    const m = await manifest();
    const wanted = scenario ?? m.default_scenario;
    const entry = m.cases.find(c => c.id === id && c.scenario === wanted);
    if (!entry) throw new Error(`Unknown case: ${id}/${wanted}`);
    return entry;
  }

  async function scenarios() { return (await manifest()).scenarios || []; }
  async function defaultScenario() { return (await manifest()).default_scenario; }

  async function extra(name) {
    const path = (await manifestShards()).extra?.[name];
    if (!path) throw new Error(`Study has no "${name}" shard`);
    return shard(path);
  }

  // One case/scenario's aspen-results/1 record from its optional `result` shard (decoupled from has_results:
  // for the HTL package these are gate verdicts, not five-table results), or null when the entry has none
  // (use the manifest entry's case_params/kpi/completeness). Lazy: one request per shard.
  async function caseResult(id, scenario) {
    const entry = await caseEntry(id, scenario);
    if (!entry.result) return null;
    const file = await shard(entry.result);
    const record = file.cases.find(c => c.case === id && c.scenario === entry.scenario);
    if (!record) throw new Error(`Result shard ${entry.result} has no case ${id}/${entry.scenario}`);
    return {...record, contributions: file.contributions.filter(c => c.case === id && c.scenario === entry.scenario), method: file.method};
  }

  // Evidence descriptors [{kind, file, sha256?, note?}] straight from the manifest (no request); the files are
  // fetched with evidenceFile(). Empty array when the case has none.
  async function caseEvidence(id, scenario) {
    return (await caseEntry(id, scenario)).evidence || [];
  }
  async function evidenceFile(id, scenario, kind) {
    const item = (await caseEvidence(id, scenario)).find(e => !kind || e.kind === kind);
    return item ? shard(item.file) : null;
  }

  // Five-table project: only when has_results=true (which requires `file`); otherwise null.
  async function caseProject(id, scenario) {
    const entry = await caseEntry(id, scenario);
    return entry.has_results && entry.file ? shard(entry.file) : null;
  }

  async function summary() {
    const path = (await manifestShards()).summary;
    if (!path) throw new Error('Study has no summary shard');
    return shard(path);
  }

  async function factors() {
    const path = (await manifestShards()).factors;
    if (!path) throw new Error('Study has no factors snapshot');
    return shard(path);
  }

  // aspen-surrogate/1 descriptor (shards.surrogate is a path to it).
  async function surrogate() {
    const path = (await manifestShards()).surrogate;
    if (typeof path !== 'string') throw new Error('Study has no surrogate descriptor');
    return shard(path);
  }

  async function surrogateGrid() {
    const descriptor = await surrogate();
    if (!descriptor.grid_files?.length) throw new Error('Surrogate descriptor lists no grid file');
    const {columns, data, ...rest} = await shard(descriptor.grid_files[0]);
    return {...rest, rows: data.map(values => Object.fromEntries(columns.map((column, i) => [column, values[i]])))};
  }

  async function robustnessScenarios() {
    const files = (await surrogate()).extra_files || {};
    return Object.keys(files).filter(key => key.startsWith('robustness_')).map(key => key.slice('robustness_'.length));
  }

  async function robustness(scenario) {
    const path = (await surrogate()).extra_files?.[`robustness_${scenario}`];
    if (!path) throw new Error(`Study has no robustness shard for ${scenario}`);
    return (await shard(path)).rows;
  }

  const observations = () => extra('observations');

  // Rebuilds the legacy HTL `analysis` object (the former data/pipeline.json) from the surrogate part.
  async function htlAnalysis() {
    await manifest();
    const descriptor = await surrogate();
    const detailsPath = descriptor.extra_files?.details;
    if (!detailsPath) throw new Error('Surrogate descriptor has no details file');
    const [details, grid, scenarioIds] = await Promise.all([shard(detailsPath), surrogateGrid(), robustnessScenarios()]);
    const rows = await Promise.all(scenarioIds.map(robustness));
    const {robustness: robustnessMeta, grid: gridMeta, ...rest} = details;
    const analysis = {...rest, grid: {...gridMeta, rows: grid.rows}};
    analysis.robustness = robustnessMeta === null ? null
      : {...robustnessMeta, scenarios: Object.fromEntries(scenarioIds.map((name, i) => [name, rows[i]]))};
    return analysis;
  }

  return {manifest, shard, scenarios, defaultScenario, caseEntry, caseResult, caseEvidence, evidenceFile, caseProject, summary, factors, surrogate,
    surrogateGrid, robustness, robustnessScenarios, observations, htlAnalysis, requested: () => [...requested]};
}
