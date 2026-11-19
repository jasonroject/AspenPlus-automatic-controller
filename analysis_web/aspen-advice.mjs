// 规则式模型建议引擎（浏览器与 Node 通用，无 DOM 依赖）。
// 与 aspen_study/advice.py 逐函数对应；规则表（阈值、消息模式、中文文案）共用 data/aspen-advice-rules.json。
// 输入：probe-summary.json（aspen-probe/1 或 1.1）+ 可选 graph.json、roles.json；输出 aspen-advice/1。
// 只用探针里真实存在的字段，不编造数值，不带排放因子；输出确定性（无时间戳）。
export const ADVICE_SCHEMA = 'aspen-advice/1';
export const PROBE_SCHEMA = 'aspen-probe/1.1';
export const LEGACY_SCHEMA = 'aspen-probe/1';
export const GRAPH_SCHEMA = 'aspen-model-graph/1';
export const ROLES_SCHEMA = 'aspen-roles/1';
const SEV_RANK = {critical: 0, warn: 1, suggest: 2, info: 3};
const CAT_ORDER = ['convergence', 'thermo/phase', 'reaction', 'units', 'energy', 'heat-integration', 'data-completeness', 'lca-readiness'];
const SUMMARY_FILE = 'probe-summary.json', GRAPH_FILE = 'graph.json', ROLES_FILE = 'roles.json';
const SKIP_LINES = ['*  WARNING', '*  ERROR'];

export class AdviceInputError extends Error {
  constructor(message, problems = []) { super(message); this.name = 'AdviceInputError'; this.problems = problems; }
}

export async function loadRules(url = new URL('./data/aspen-advice-rules.json', import.meta.url)) {
  if (typeof process !== 'undefined' && process.versions?.node && String(url).startsWith('file:')) {
    const {readFile} = await import('node:fs/promises');
    return JSON.parse(await readFile(new URL(url), 'utf8'));
  }
  const res = await fetch(url);
  if (!res.ok) throw new AdviceInputError('规则表加载失败（' + res.status + '），请刷新页面重试。');
  return res.json();
}

// ---------------------------------------------------------------- 小工具
export function num(x, d = 2) {
  let s = Number(x).toFixed(d);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return (s === '-0' || s === '') ? '0' : s;
}
const sv = v => (typeof v === 'string' ? v : String(v));
const render = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? sv(vars[k]) : '未读到'));
const uniq = a => [...new Set(a)];
const joinZh = a => a.join('、');
const pct = x => num(100 * x, 0);
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function toK(value, unit) {
  const u = String(unit ?? '').trim().replace(/°/g, '').toUpperCase();
  if (u === 'K') return value;
  if (u === 'C') return value + 273.15;
  if (u === 'F') return (value - 32) * 5 / 9 + 273.15;
  if (u === 'R') return value * 5 / 9;
  return null;
}
const ev = (file, pointer, value, unit = null) => {
  const e = {path: `${file}#${pointer}`, value: value === undefined ? null : value};
  const u = unit || (pointer.endsWith('/kW') ? 'kW' : null);
  if (u) e.unit = u;
  return e;
};

// ---------------------------------------------------------------- 1.0 -> 1.1 升级（对应 probe_compat.py）
export function groupTotals(rows, totalsComplete = true) {
  const t = {heating: 0, cooling: 0, shaft_work: 0, internal_exchange: 0};
  const broken = new Set();
  for (const r of rows) for (const e of r.energy) {
    const key = e.role_hint === 'exchanged' ? 'internal_exchange' : e.kind === 'work' ? 'shaft_work' : (e.value >= 0 ? 'heating' : 'cooling');
    if (e.kW === null || e.kW === undefined) broken.add(key); else t[key] += e.kW;
  }
  const r6 = v => Math.round(v * 1e6) / 1e6;
  const out = {};
  for (const k of Object.keys(t)) out[k] = {kW: broken.has(k) ? null : r6(t[k]), complete: Boolean(totalsComplete) && !broken.has(k)};
  const ext = ['heating', 'cooling', 'shaft_work'], bad = ext.some(k => broken.has(k));
  out.overall = {kW: bad ? null : r6(ext.reduce((a, k) => a + t[k], 0)), complete: Boolean(totalsComplete) && !bad};
  return out;
}
function splitMessages(messages) {
  const lines = (messages || []).filter(m => String(m).trim() && !SKIP_LINES.includes(String(m).trim()));
  if (lines.length && !/^\s/.test(lines[0])) return [lines[0], lines.slice(1)];
  return [null, lines];
}
const BLOCK_IN_PATH = /\\Blocks\\([^\\]+)\\/i, BLOCK_IN_TEXT = /^([^\s（(：:]+)（[^）]*）/;
/** 从节点路径 \Data\Blocks\<ID>\… 解析块 id；解析不了才是 null。text 只给 1.0 迁移兜底（“ID（类型）…”）。与 probe_compat.block_from_path 一致。 */
export function blockFromPath(path, text = null) {
  let m = BLOCK_IN_PATH.exec(String(path || ''));
  if (m) return m[1];
  m = BLOCK_IN_TEXT.exec(String(text || ''));
  return m ? m[1] : null;
}
const withBlock = (item, text = null) => ({...item, block: item.block || blockFromPath(item.path, text ?? item.reason)});

export function upgradeSummary(summary, rules) {
  const s = JSON.parse(JSON.stringify(summary));
  if (s.schema === PROBE_SCHEMA) return s;
  if (s.schema !== LEGACY_SCHEMA) throw new AdviceInputError(`不认识的 probe 版本：${JSON.stringify(s.schema)}（需要 ${LEGACY_SCHEMA} 或 ${PROBE_SCHEMA}）。`);
  s.schema = PROBE_SCHEMA;
  s.migrated_from = LEGACY_SCHEMA;
  for (const b of s.blocks || []) {
    if ('messages' in b) {
      const [blkmsg, perError] = splitMessages(b.messages);
      delete b.messages;
      b.blkmsg = blkmsg; b.per_error = perError; b.per_error_total = null;
    }
    for (const e of b.energy || []) {
      if (!('verified' in e)) {
        const node = String(e.path || '').split('\\').pop();
        e.verified = Boolean(rules.legacy_verified_nodes?.[String(b.type).toLowerCase()]?.[node]);
      }
    }
  }
  s.discovery = s.discovery || {};
  s.energy_gaps = (s.energy_gaps || []).map(g => (isObj(g) ? withBlock(g) : withBlock({block: null, path: String(g), reason: '迁移自 aspen-probe/1（原为字符串）：' + g}, String(g))));
  s.unverified_paths = (s.discovery.unverified_paths || []).map(u => (isObj(u) ? withBlock(u) : withBlock({block: null, path: String(u), reason: '迁移自 aspen-probe/1（原为字符串）'})));
  delete s.discovery.unverified_paths;
  if (!('totals_complete' in s)) s.totals_complete = !s.energy_gaps.length && !(s.discovery.unmatched_block_types || []).length;
  s.group_totals = groupTotals(s.blocks || [], s.totals_complete);
  return s;
}

// ---------------------------------------------------------------- 输入校验（中文报错）
export function checkSummary(s) {
  const p = [];
  const need = (cond, msg) => { if (!cond) p.push(msg); };
  need(isObj(s.model) && typeof s.model.file === 'string' && /^[0-9a-f]{64}$/.test(s.model?.sha256 ?? ''), 'model.file / model.sha256 缺失或格式不对');
  need(isObj(s.status) && ['ok', 'warning', 'error'].includes(s.status?.state) && Array.isArray(s.status?.errors) && Array.isArray(s.status?.warnings) && typeof s.status?.run_completed === 'boolean', 'status 缺字段（state / run_completed / errors / warnings）');
  need(Array.isArray(s.blocks), 'blocks 不是数组');
  need(typeof s.calorie_J === 'number', 'calorie_J 缺失');
  need(isObj(s.totals_kW), 'totals_kW 缺失');
  need(isObj(s.discovery), 'discovery 缺失');
  need(Array.isArray(s.energy_gaps), 'energy_gaps 缺失');
  need(Array.isArray(s.unverified_paths), 'unverified_paths 缺失（1.1 里它在顶层）');
  need(isObj(s.group_totals) && isObj(s.group_totals.overall), 'group_totals 缺失或缺 overall');
  if (Array.isArray(s.blocks)) s.blocks.forEach((b, i) => {
    need(isObj(b) && typeof b.id === 'string' && typeof b.type === 'string' && Array.isArray(b.energy), `blocks[${i}] 缺 id / type / energy`);
    if (!isObj(b)) return;
    need(['ok', 'warning', 'error', 'unknown'].includes(b.status), `blocks[${i}].status 必须是 ok / warning / error / unknown`);
    need(Array.isArray(b.per_error), `blocks[${i}].per_error 不是数组`);
    (b.energy || []).forEach((e, j) => need(isObj(e) && (e.kind === 'heat' || e.kind === 'work') && typeof e.value === 'number' && typeof e.unit === 'string' && (e.kW === null || typeof e.kW === 'number'), `blocks[${i}].energy[${j}] 缺 kind / value / unit / kW`));
  });
  return p;
}

/** 与 aspen_study/advice.py 的 package_problems、result_package.validate_package 同语义。 */
export function packageProblems(S, graph, roles) {
  const out = [], sha = S.model.sha256;
  if (S.model.source_unchanged === false) out.push('probe-summary.json：体检期间源模型文件被改动（source_unchanged=false），结果对应的模型版本不确定。');
  const same = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
  if (graph) {
    if ((graph.model || {}).sha256 !== sha) out.push('graph.json 与 probe-summary.json 来自不同的模型（sha256 不一致）。');
    if (!same(new Set(graph.blocks.map(b => b.id)), new Set(S.blocks.map(b => b.id)))) out.push('probe-summary.json 的块与 graph.json 的块不一致。');
  }
  if (roles) {
    if (roles.model_sha256 !== sha) out.push('roles.json 与 probe-summary.json 来自不同的模型（sha256 不一致）。');
    if (graph) {
      if ('blocks' in roles && !same(new Set(Object.keys(roles.blocks)), new Set(graph.blocks.map(b => b.id)))) out.push('roles.json 的块与 graph.json 的块不一致。');
      if (!same(new Set(Object.keys(roles.streams || {})), new Set(graph.streams.map(s => s.id)))) out.push('roles.json 的流股与 graph.json 的流股不一致。');
    }
  }
  return out;
}

const NAMES = {[PROBE_SCHEMA]: SUMMARY_FILE, [LEGACY_SCHEMA]: SUMMARY_FILE, [GRAPH_SCHEMA]: GRAPH_FILE, [ROLES_SCHEMA]: ROLES_FILE};
/** docs: [{name, data}]（data 为已解析的 JSON）。按 schema 字段识别文件，不看文件名。 */
export function classifyBundle(docs, rules) {
  if (!docs.length) throw new AdviceInputError('没有收到文件。请选择 probe-summary.json（可同时选择 graph.json、roles.json），或包含它们的 .zip。');
  let summary = null, graph = null, roles = null;
  const warnings = [];
  for (const d of docs) {
    if (!isObj(d.data)) throw new AdviceInputError(`“${d.name}”不是 JSON 对象。请上传 aspen_study probe 生成的 probe-summary.json / graph.json / roles.json。`);
    const sch = d.data.schema;
    if (sch === PROBE_SCHEMA || sch === LEGACY_SCHEMA) {
      if (summary) warnings.push(`收到多个 probe-summary，只使用“${summary.name}”，忽略“${d.name}”。`); else summary = d;
    } else if (sch === GRAPH_SCHEMA) { if (!graph) graph = d; else warnings.push(`收到多个 graph.json，忽略“${d.name}”。`); }
    else if (sch === ROLES_SCHEMA) { if (!roles) roles = d; else warnings.push(`收到多个 roles.json，忽略“${d.name}”。`); }
    else if (typeof sch === 'string' && sch.startsWith('aspen-probe/')) throw new AdviceInputError(`“${d.name}”的版本是 ${sch}，本页只支持 ${LEGACY_SCHEMA} 和 ${PROBE_SCHEMA}。请用匹配版本的 aspen_study 重新体检。`);
    else if (sch === 'aspen-advice/1') warnings.push(`“${d.name}”是已生成的建议文件，已忽略；本页会重新计算。`);
    else throw new AdviceInputError(`“${d.name}”不是体检文件：没有认出 schema 字段（${JSON.stringify(sch ?? null)}）。需要 aspen-probe/1(.1)、aspen-model-graph/1 或 aspen-roles/1。`);
  }
  if (!summary) throw new AdviceInputError('缺少 probe-summary.json（schema 为 aspen-probe/1 或 1.1）。只有 graph.json / roles.json 不能分析；请运行 python -m aspen_study probe 模型.bkp 后上传输出目录里的文件。');
  let S;
  try { S = upgradeSummary(summary.data, rules); } catch (e) { if (e instanceof AdviceInputError) throw e; throw new AdviceInputError(`“${summary.name}”结构不完整，无法读取。`, [String(e)]); }
  const problems = checkSummary(S);
  if (problems.length) throw new AdviceInputError(`“${summary.name}”不符合 ${PROBE_SCHEMA}：${problems.slice(0, 3).join('；')}${problems.length > 3 ? `（共 ${problems.length} 处）` : ''}。`, problems);
  if (graph && !(Array.isArray(graph.data.blocks) && Array.isArray(graph.data.streams))) throw new AdviceInputError(`“${graph.name}”缺少 blocks / streams，不是完整的 graph.json。`);
  if (roles && !isObj(roles.data.streams)) throw new AdviceInputError(`“${roles.name}”缺少 streams，不是完整的 roles.json。`);
  const mismatch = packageProblems(S, graph?.data ?? null, roles?.data ?? null);
  if (mismatch.length) throw new AdviceInputError('这些文件不是同一次体检的产物，不做分析：' + mismatch.join(''), mismatch);
  return {summary: S, graph: graph?.data ?? null, roles: roles?.data ?? null, names: {summary: summary.name, graph: graph?.name ?? null, roles: roles?.name ?? null}, warnings};
}

// ---------------------------------------------------------------- 引擎
class Ctx {
  constructor(rules, S, G, R) { this.rules = rules; this.S = S; this.G = G; this.R = R; this.th = rules.thresholds; this.tx = rules.texts; this.items = []; this.skipped = []; this.blocked = new Set(); }
  rule(id) { return this.rules.rules[id]; }
  add(ruleId, tpl, vars, target, evidence, {severity = null, suffix = null, titleExtra = '', detailExtra = ''} = {}) {
    if (this.blocked.has(ruleId)) return;
    const v = {}; for (const [k, x] of Object.entries(vars)) v[k] = sv(x);
    this.items.push({
      id: ruleId + (target[1] ? ':' + target[1] : '') + (suffix ? ':' + suffix : ''), rule: ruleId, severity: severity || tpl.severity, category: tpl.category,
      target: target[1] || 'global', title_zh: render(tpl.title_zh, v) + titleExtra, detail_zh: render(tpl.detail_zh, v) + detailExtra,
      evidence, action_zh: render(tpl.action_zh, v), confidence: tpl.confidence});
  }
}
const blockLines = b => (b.blkmsg ? [b.blkmsg] : []).concat(b.per_error || []);
const linePointer = (b, i, k) => ((b.blkmsg && k === 0) ? `/blocks/${i}/blkmsg` : `/blocks/${i}/per_error/${k - (b.blkmsg ? 1 : 0)}`);

function statusRules(c) {
  const {S} = c, st = S.status;
  if (st.state === 'error' || st.errors.length) {
    const first = st.errors.length ? st.errors[0] : c.tx.unnamed;
    const e = [ev(SUMMARY_FILE, '/status/state', st.state), ...st.errors.slice(0, 2).map((x, k) => ev(SUMMARY_FILE, `/status/errors/${k}`, x))];
    c.add('status.error', c.rule('status.error'), {count: st.errors.length, first}, ['global', null], e);
  }
  if (st.run_completed === false) c.add('status.incomplete', c.rule('status.incomplete'), {}, ['global', null], [ev(SUMMARY_FILE, '/status/run_completed', false)]);
  for (const [key, kind] of [['errors', '错误'], ['warnings', '警告']]) {
    st[key].forEach((text, k) => {
      if (!/^块 ([^：]+)：/.test(text)) c.add('status.global-warning', c.rule('status.global-warning'), {kind, text}, ['global', null], [ev(SUMMARY_FILE, `/status/${key}/${k}`, text)], {suffix: `${key}-${k}`, severity: key === 'errors' ? 'warn' : null});
    });
  }
  if (S.model.source_unchanged === false) c.add('status.source-modified', c.rule('status.source-modified'), {}, ['global', null], [ev(SUMMARY_FILE, '/model/source_unchanged', false)]);
}

function extract(spec, text) {
  const out = {};
  for (const [name, rx] of Object.entries(spec)) {
    const vals = uniq([...text.matchAll(new RegExp(rx, 'g'))].map(m => m[1]));
    out[name] = vals.length ? joinZh(vals) : null;
  }
  return out;
}

function blockRules(c) {
  const {th, tx} = c;
  c.S.blocks.forEach((b, i) => {
    const lines = blockLines(b), text = lines.join('\n');
    const total = b.per_error_total ?? null, per = b.per_error || [];
    const truncated = (total !== null && total > per.length) || (total === null && lines.length >= th.per_error_cap);
    const note = truncated ? render(tx.truncated, {n: total !== null ? per.length : lines.length}) : '';
    const base = [ev(SUMMARY_FILE, `/blocks/${i}/status`, b.status), ev(SUMMARY_FILE, `/blocks/${i}/blkstat`, b.blkstat ?? null)];
    let matched = false;
    for (const pat of c.rules.message_patterns) {
      const rx = new RegExp(pat.regex, 'i');
      if (!rx.test(text)) continue;
      matched = true;
      const vars = {block: b.id, type: b.type};
      for (const [name, val] of Object.entries(extract(pat.extract, text))) vars[name] = val !== null ? val : tx.unknown;
      let sev = pat.severity, extra = '';
      if (b.status === 'error') sev = 'critical'; else if (b.status === 'ok') { sev = 'suggest'; extra = tx.status_ok_suffix; }
      const hits = lines.map((ln, k) => [k, ln]).filter(([, ln]) => rx.test(ln)).slice(0, 2).map(([k, ln]) => ev(SUMMARY_FILE, linePointer(b, i, k), ln));
      c.add(pat.id, pat, vars, ['block', b.id], base.concat(hits), {severity: sev, titleExtra: extra, detailExtra: note});
    }
    if ((b.status === 'warning' || b.status === 'error') && !matched) {
      const rid = b.status === 'error' ? 'block.unmatched-error' : 'block.unmatched-warning';
      const exc = lines.slice(0, 3).map(x => x.trim()).join(' / ') || tx.unnamed;
      c.add(rid, c.rule(rid), {block: b.id, type: b.type, blkstat: b.blkstat === null || b.blkstat === undefined ? '未读到' : b.blkstat, excerpt: exc}, ['block', b.id], base, {detailExtra: note});
    }
    if (b.status === 'unknown') c.add('block.status-unknown', c.rule('block.status-unknown'), {block: b.id, type: b.type}, ['block', b.id], base);
  });
}

function unitRules(c) {
  const {S} = c;
  const units = uniq(S.blocks.flatMap(b => b.energy.map(e => e.unit)));
  const u = S.units || {};
  if (units.some(x => x !== 'kW')) {
    c.add('units.non-si-set', c.rule('units.non-si-set'), {inset: u.INSET ?? '?', outset: u.OUTSET ?? '?', units: joinZh(units), calorie: S.calorie_J}, ['global', null],
      [ev(SUMMARY_FILE, '/units/INSET', u.INSET ?? null), ev(SUMMARY_FILE, '/units/OUTSET', u.OUTSET ?? null), ev(SUMMARY_FILE, '/calorie_J', S.calorie_J)]);
  }
  if (units.some(x => x.toLowerCase().includes('cal')) && S.calorie_J !== c.th.standard_calorie_J) c.add('units.calorie-definition', c.rule('units.calorie-definition'), {calorie: S.calorie_J}, ['global', null], [ev(SUMMARY_FILE, '/calorie_J', S.calorie_J)]);
  const nulls = [];
  S.blocks.forEach((b, i) => b.energy.forEach((e, j) => { if (e.kW === null || e.kW === undefined) nulls.push([i, j, b, e]); }));
  if (nulls.length) c.add('units.kw-null', c.rule('units.kw-null'), {count: nulls.length, items: nulls.map(([, , b, e]) => `${b.id} ${sv(e.value)} ${e.unit}`).join('；')}, ['global', null], nulls.slice(0, 5).map(([i, j]) => ev(SUMMARY_FILE, `/blocks/${i}/energy/${j}/kW`, null)));
}

const external = S => S.blocks.flatMap((b, i) => b.energy.map((e, j) => [i, b, j, e])).filter(([, , , e]) => e.role_hint !== 'exchanged' && e.kW !== null && e.kW !== undefined);

function energyRules(c) {
  const {S, th} = c;
  const ext = external(S);
  const perBlock = new Map();
  for (const [i, , , e] of ext) perBlock.set(i, (perBlock.get(i) ?? 0) + Math.abs(e.kW));
  const total = [...perBlock.values()].reduce((a, b) => a + b, 0);
  if (total > 0 && perBlock.size >= 2) {
    const ranked = [...perBlock.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]));
    const top = ranked.filter(([, v]) => v / total >= th.hotspot_min_share).slice(0, th.hotspot_top_n);
    if (top.length) {
      const topSet = new Set(top.map(t => t[0]));
      c.add('energy.hotspot', c.rule('energy.hotspot'), {top: joinZh(top.map(([i]) => S.blocks[i].id)), total: num(total),
        list: top.map(([i, v]) => `${S.blocks[i].id} ${pct(v / total)}%（${num(v)} kW）`).join('、')}, ['global', null],
      ext.filter(([i]) => topSet.has(i)).map(([i, , j, en]) => ev(SUMMARY_FILE, `/blocks/${i}/energy/${j}/kW`, en.kW)));
    }
  } else c.skipped.push({rule: 'energy.hotspot', reason_zh: '少于两个块有外部能量项，不做热点排序'});
  const warned = [...perBlock.entries()].filter(([i]) => ['warning', 'error'].includes(S.blocks[i].status)).sort((a, b) => a[0] - b[0]);
  const w = warned.reduce((a, [, v]) => a + v, 0);
  if (total > 0 && w / total >= th.warning_share_min) {
    c.add('energy.warning-share', c.rule('energy.warning-share'), {share: pct(w / total), total: num(total), warned: num(w),
      blocks: warned.map(([i, v]) => `${S.blocks[i].id}（${num(v)} kW）`).join('、')}, ['global', null], warned.map(([i]) => ev(SUMMARY_FILE, `/blocks/${i}/status`, S.blocks[i].status)));
  }
  const exch = S.blocks.flatMap((b, i) => b.energy.map((e, j) => [i, b, j, e])).filter(([, , , e]) => e.role_hint === 'exchanged' && e.kW !== null && e.kW !== undefined);
  if (exch.length) {
    const g = S.group_totals || {};
    const f = k => (((g[k] || {}).kW ?? null) === null ? '未知' : num(g[k].kW));
    c.add('energy.internal-exchange', c.rule('energy.internal-exchange'), {blocks: joinZh(uniq(exch.map(([, b]) => b.id))), exchange: num(exch.reduce((a, [, , , e]) => a + e.kW, 0)), heating: f('heating'), cooling: f('cooling')},
      ['global', null], exch.map(([i, , j, e]) => ev(SUMMARY_FILE, `/blocks/${i}/energy/${j}/kW`, e.kW)));
  }
  if (S.blocks.length && !S.blocks.some(b => b.energy.length)) c.add('energy.none', c.rule('energy.none'), {}, ['global', null], S.blocks.slice(0, 5).map((_, i) => ev(SUMMARY_FILE, `/blocks/${i}/energy`, [])));
  const expected = new Set(c.rules.energy_expected_types.map(t => t.toLowerCase()));
  S.blocks.forEach((b, i) => { if (!b.energy.length && expected.has(b.type.toLowerCase())) c.add('energy.block-missing', c.rule('energy.block-missing'), {block: b.id, type: b.type}, ['block', b.id], [ev(SUMMARY_FILE, `/blocks/${i}/energy`, [])]); });
}

function streamT(G, sid) {
  for (let k = 0; k < G.streams.length; k++) {
    const s = G.streams[k];
    if (s.id === sid) {
      const t = s.total || {};
      if ('T' in t && t.T_unit) { const K = toK(t.T, t.T_unit); if (K !== null) return [K, [ev(GRAPH_FILE, `/streams/${k}/total/T`, t.T, t.T_unit)]]; }
    }
  }
  return null;
}
function blockT(G, bid, which) {
  for (let k = 0; k < G.blocks.length; k++) {
    const b = G.blocks[k];
    if (b.id !== bid) continue;
    const r = which === 'in' ? b.inlet_temperature : b.outlet_temperature;
    if (r && 'value' in r && r.unit) { const K = toK(r.value, r.unit); if (K !== null) return [K, [ev(GRAPH_FILE, `/blocks/${k}/${which === 'in' ? 'inlet' : 'outlet'}_temperature/value`, r.value, r.unit)]]; }
    const ports = (b.ports || {})[which === 'in' ? 'in' : 'out'] || [];
    if (ports.length === 1) return streamT(G, ports[0]);
  }
  return null;
}
function overlap(hot, cold, dT, iso) {
  const loH = hot.tout - dT, hiH = hot.tin - dT;
  if (hot.tin < hot.tout || cold.tout < cold.tin) return null;
  const isoH = (hot.tin - hot.tout) < iso, isoC = (cold.tout - cold.tin) < iso;
  const clamp = x => Math.max(0, Math.min(1, x));
  let ok, fh, fc;
  if (isoH && isoC) { ok = hiH >= cold.tin; fh = 1; fc = 1; }
  else if (isoH) { ok = hiH >= cold.tin; fh = 1; fc = clamp((Math.min(hiH, cold.tout) - cold.tin) / (cold.tout - cold.tin)); }
  else if (isoC) { ok = hiH >= cold.tin; fh = clamp((hiH - Math.max(cold.tin, loH)) / (hiH - loH)); fc = 1; }
  else { const L = Math.min(hiH, cold.tout) - Math.max(loH, cold.tin); ok = L > 0; fh = L / (hiH - loH); fc = L / (cold.tout - cold.tin); }
  if (!ok) return null;
  return Math.min(Math.abs(hot.kW) * fh, cold.kW * fc);
}
function heatIntegration(c) {
  const {S, G} = c, gt = S.group_totals || {};
  const heating = (gt.heating || {}).kW ?? null, cooling = (gt.cooling || {}).kW ?? null;
  if (!heating || !cooling || heating <= 0 || cooling >= 0) return;
  const base = [ev(SUMMARY_FILE, '/group_totals/heating/kW', heating), ev(SUMMARY_FILE, '/group_totals/cooling/kW', cooling)];
  const vars = {heating: num(heating), cooling: num(cooling)};
  if (G === null) return; // requires=['graph']，已在 skipped 里登记
  const dT = c.th.heat_integration_dTmin_K, iso = c.th.isothermal_span_K;
  const hot = [], cold = [], mixed = [];
  S.blocks.forEach((b, i) => {
    const es = b.energy.filter(e => e.kind === 'heat' && e.role_hint !== 'exchanged');
    if (!es.length || es.some(e => e.kW === null || e.kW === undefined)) return;
    const q = es.reduce((a, e) => a + e.kW, 0);
    if (!(es.every(e => e.kW >= 0) || es.every(e => e.kW <= 0))) { mixed.push(b.id); return; }
    if (q === 0) return;
    const tin = blockT(G, b.id, 'in'), tout = blockT(G, b.id, 'out');
    if (tin === null || tout === null) return;
    const rec = {id: b.id, kW: q, tin: tin[0], tout: tout[0],
      ev: b.energy.map((e, j) => [e, j]).filter(([e]) => es.includes(e)).map(([e, j]) => ev(SUMMARY_FILE, `/blocks/${i}/energy/${j}/kW`, e.kW)).concat(tin[1], tout[1])};
    (q > 0 ? cold : hot).push(rec);
  });
  if (!hot.length || !cold.length) {
    let missing = '进出口温度', why = 'graph.json 里的加热/冷却块缺少进口或出口温度（或进口不止一股）';
    if (mixed.length) { missing = c.tx.hi_mixed_missing; why = c.tx.hi_mixed_why; }
    c.add('heat-integration.data-missing', c.rule('heat-integration.data-missing'), {...vars, missing, why}, ['global', null], base);
    return;
  }
  const pairs = [];
  for (const h of hot) for (const k of cold) { const bound = overlap(h, k, dT, iso); if (bound !== null && bound >= c.th.heat_integration_min_kW) pairs.push([bound, h, k]); }
  pairs.sort((a, b) => b[0] - a[0]);
  if (!pairs.length) { c.add('heat-integration.none', c.rule('heat-integration.none'), {dtmin: num(dT, 0)}, ['global', null], base); return; }
  for (const [bound, h, k] of pairs.slice(0, c.th.heat_integration_top_n)) {
    c.add('heat-integration.overlap', c.rule('heat-integration.overlap'), {hot: h.id, cold: k.id, hot_tin: num(h.tin, 1), hot_tout: num(h.tout, 1), hot_kw: num(Math.abs(h.kW)),
      cold_tin: num(k.tin, 1), cold_tout: num(k.tout, 1), cold_kw: num(k.kW), dtmin: num(dT, 0), bound: num(bound)}, ['block', h.id], h.ev.concat(k.ev), {suffix: k.id});
  }
}

function massBalance(c) {
  const {G} = c;
  if (G === null) return; // requires=['graph']，已在 skipped 里登记
  const ins = [], outs = [], units = new Set();
  G.streams.forEach((s, k) => {
    const t = s.total || {};
    if (s.class !== 'MATERIAL' || !('mass_flow' in t)) return;
    if (s.from === 'BOUNDARY' && s.to !== 'BOUNDARY') { ins.push([k, t.mass_flow]); units.add(t.mass_unit ?? null); }
    else if (s.to === 'BOUNDARY' && s.from !== 'BOUNDARY') { outs.push([k, t.mass_flow]); units.add(t.mass_unit ?? null); }
  });
  if (!ins.length || !outs.length || units.size !== 1 || units.has(null) || units.has('')) { c.skipped.push({rule: 'convergence.mass-balance', reason_zh: '边界物流缺质量流量或单位不一致，无法检查'}); return; }
  const tin = ins.reduce((a, [, v]) => a + v, 0), tout = outs.reduce((a, [, v]) => a + v, 0);
  if (tin <= 0) return;
  const rel = Math.abs(tin - tout) / tin;
  if (rel > c.th.mass_balance_rel_tol) {
    c.add('convergence.mass-balance', c.rule('convergence.mass-balance'), {in: num(tin, 3), out: num(tout, 3), unit: [...units][0], rel: num(100 * rel, 2), tol: num(100 * c.th.mass_balance_rel_tol, 2)},
      ['global', null], ins.concat(outs).map(([k, v]) => ev(GRAPH_FILE, `/streams/${k}/total/mass_flow`, v, [...units][0])).slice(0, 8));
  }
}

function completeness(c) {
  const {S} = c, gt = S.group_totals || {};
  const nulls = ['heating', 'cooling', 'shaft_work', 'internal_exchange'].filter(k => ((gt[k] || {}).kW ?? null) === null);
  if (S.totals_complete === false || nulls.length) c.add('data-completeness.totals-incomplete', c.rule('data-completeness.totals-incomplete'), {nulls: nulls.length ? joinZh(nulls) : c.tx.none}, ['global', null], [ev(SUMMARY_FILE, '/totals_complete', S.totals_complete), ev(SUMMARY_FILE, '/group_totals', gt)]);
  const gaps = S.energy_gaps;
  if (gaps.length) c.add('data-completeness.energy-gaps', c.rule('data-completeness.energy-gaps'), {count: gaps.length, gaps: gaps.map(g => `${g.block || c.tx.global}：${g.reason}`).join('；')}, ['global', null], gaps.slice(0, 3).map((g, k) => ev(SUMMARY_FILE, `/energy_gaps/${k}`, g)));
  const d = S.discovery;
  if (d.complete === false) c.add('data-completeness.discovery-incomplete', c.rule('data-completeness.discovery-incomplete'), {nodes: d.nodes_read ?? c.tx.unknown}, ['global', null], [ev(SUMMARY_FILE, '/discovery/complete', false)]);
  const um = d.unmatched_block_types || [];
  if (um.length) c.add('data-completeness.unmatched-block-types', c.rule('data-completeness.unmatched-block-types'), {types: joinZh(um)}, ['global', null], [ev(SUMMARY_FILE, '/discovery/unmatched_block_types', um)]);
  const paths = [], e = [];
  (S.unverified_paths || []).forEach((u, k) => { paths.push([u.block, u.path]); e.push(ev(SUMMARY_FILE, `/unverified_paths/${k}`, u)); });
  S.blocks.forEach((b, i) => b.energy.forEach((en, j) => { if (en.verified === false) { paths.push([b.id, en.path]); e.push(ev(SUMMARY_FILE, `/blocks/${i}/energy/${j}/verified`, false)); } }));
  const seen = new Set(), ordered = [];
  for (const [blk, p] of paths) if (!seen.has(p)) { seen.add(p); ordered.push([blk, p]); }
  if (ordered.length) {
    let shown = ordered.slice(0, 5).map(([blk, p]) => `${blk || c.tx.global} ${p}`).join('；');
    if (ordered.length > 5) shown += ' ' + render(c.tx.more, {n: ordered.length});
    c.add('data-completeness.unverified-paths', c.rule('data-completeness.unverified-paths'), {count: ordered.length, paths: shown}, ['global', null], e.slice(0, 5));
  }
  const st = S.study;
  if (st && st.ok === false) {
    const err = String(st.error ?? '').split(/\s+/).filter(Boolean).join(' ').slice(0, 120) || c.tx.unknown;
    c.add('data-completeness.study-failed', c.rule('data-completeness.study-failed'), {error: err}, ['global', null], [ev(SUMMARY_FILE, '/study/ok', false)]);
  }
}

function lca(c) {
  const {S, G, R} = c, sha = S.model.sha256;
  for (const [which, doc, isGraph] of [[GRAPH_FILE, G, true], [ROLES_FILE, R, false]]) {
    if (doc === null) continue;
    const other = isGraph ? (doc.model ?? {}).sha256 : doc.model_sha256;
    if (other !== sha) c.add('lca-readiness.sha-mismatch', c.rule('lca-readiness.sha-mismatch'), {which}, ['global', null], [ev(SUMMARY_FILE, '/model/sha256', sha), ev(which, isGraph ? '/model/sha256' : '/model_sha256', other ?? null)], {suffix: which});
  }
  if (R === null) return; // roles 相关规则 requires=['roles']，已在 skipped 里登记
  const streams = R.streams || {}, review = R.review || {};
  if (review.state !== 'reviewed') {
    const pend = review.pending || [];
    const shown = pend.slice(0, 5).join('；') + (pend.length > 5 ? ' ' + render(c.tx.more, {n: pend.length}) : '');
    c.add('lca-readiness.roles-draft', c.rule('lca-readiness.roles-draft'), {pending: pend.length, state: review.state ?? c.tx.unknown, items: shown || c.tx.none}, ['global', null], [ev(ROLES_FILE, '/review/state', review.state ?? null)]);
  }
  const products = Object.keys(streams).filter(k => streams[k].role === 'product');
  if (!products.length) c.add('lca-readiness.no-product', c.rule('lca-readiness.no-product'), {}, ['global', null], [ev(ROLES_FILE, '/streams', streams)]);
  const method = (R.allocation || {}).method ?? null;
  if (products.length > 1 && (method === null || method === 'none')) c.add('lca-readiness.multi-product', c.rule('lca-readiness.multi-product'), {products: joinZh(products), method: method || c.tx.none}, ['global', null], [ev(ROLES_FILE, '/allocation/method', method)]);
  const fu = R.functional_unit;
  if (!fu) c.add('lca-readiness.no-functional-unit', c.rule('lca-readiness.no-functional-unit'), {}, ['global', null], [ev(ROLES_FILE, '/functional_unit', null)]);
  else if (!products.includes(fu.stream)) {
    const role = (streams[fu.stream] || {}).role || c.tx.unlabeled;
    c.add('lca-readiness.fu-stream-mismatch', c.rule('lca-readiness.fu-stream-mismatch'), {stream: fu.stream, role}, ['stream', fu.stream], [ev(ROLES_FILE, '/functional_unit/stream', fu.stream ?? null)]);
  }
  for (const sid of products) {
    const pv = streams[sid].provenance || {}, conf = pv.confidence ?? null;
    if (pv.source === 'auto' && ((conf !== null && conf < c.th.low_confidence_below) || pv.needs_confirmation)) {
      c.add('lca-readiness.product-low-confidence', c.rule('lca-readiness.product-low-confidence'), {stream: sid, conf: conf === null ? '未读到' : num(conf, 2), reasons: (pv.reasons || []).join('；') || c.tx.unknown}, ['stream', sid], [ev(ROLES_FILE, `/streams/${sid}/provenance/confidence`, conf)]);
    }
  }
  const guess = [], energyBlocks = new Set(S.blocks.filter(b => b.energy.some(e => e.role_hint !== 'exchanged')).map(b => b.id));
  for (const [bid, v] of Object.entries(R.blocks || {})) if (energyBlocks.has(bid) && (v.provenance || {}).needs_confirmation) guess.push([bid, v.utility || c.tx.undecided]);
  if (guess.length) c.add('lca-readiness.utility-guess', c.rule('lca-readiness.utility-guess'), {count: guess.length, items: guess.map(([b, u]) => `${b}→${u}`).join('；')}, ['global', null], guess.slice(0, 5).map(([b, u]) => ev(ROLES_FILE, `/blocks/${b}/utility`, u)));
  const nofk = Object.keys(streams).filter(s => streams[s].role === 'feed' && (streams[s].inventory || {}).kind === 'material' && !(streams[s].inventory || {}).factor_key);
  if (nofk.length) c.add('lca-readiness.no-factor-key', c.rule('lca-readiness.no-factor-key'), {streams: joinZh(nofk)}, ['global', null], nofk.slice(0, 5).map(s => ev(ROLES_FILE, `/streams/${s}/inventory`, streams[s].inventory ?? null)));
}

/** summary 可以是 1.0 或 1.1；graph / roles 可为 null。返回 aspen-advice/1。 */
const INPUT_FILES = [['graph', GRAPH_FILE], ['roles', ROLES_FILE]];
/** 规则表里每条规则的 requires（graph / roles）缺了就整条跳过，并按规则表顺序登记到 skipped。 */
function skipMissingInputs(c) {
  const have = {graph: c.G !== null, roles: c.R !== null};
  for (const [rid, rule] of Object.entries(c.rules.rules)) {
    const missing = INPUT_FILES.map(([n]) => n).filter(n => (rule.requires || []).includes(n) && !have[n]);
    if (!missing.length) continue;
    c.blocked.add(rid);
    c.skipped.push({rule: rid, missing_inputs: missing, reason_zh: render(c.tx.skipped_missing, {files: joinZh(INPUT_FILES.filter(([n]) => missing.includes(n)).map(([, f]) => f))})});
  }
}
export function advise(summary, graph = null, roles = null, rules) {
  const S = upgradeSummary(summary, rules);
  const c = new Ctx(rules, S, graph, roles);
  skipMissingInputs(c);
  for (const fn of [statusRules, blockRules, unitRules, energyRules, heatIntegration, massBalance, completeness, lca]) fn(c);
  const ranked = c.items.map((it, n) => [n, it]).sort((a, b) => (SEV_RANK[a[1].severity] - SEV_RANK[b[1].severity]) || (CAT_ORDER.indexOf(a[1].category) - CAT_ORDER.indexOf(b[1].category)) || (a[0] - b[0]));
  const items = ranked.map(p => p[1]);
  const counts = {}; for (const k of Object.keys(SEV_RANK)) counts[k] = items.filter(it => it.severity === k).length;
  counts.total = items.length;
  return {schema: ADVICE_SCHEMA, rules_version: rules.version, model: {file: S.model.file, sha256: S.model.sha256},
    inputs: {probe: PROBE_SCHEMA, migrated_from: S.migrated_from ?? null, graph: graph !== null, roles: roles !== null}, counts, items, skipped: c.skipped};
}

/** 浏览器内的能量表：逐块逐项（原生值、单位、kW、是否真机验证），含合计。 */
export function energyRows(S) {
  const rows = [];
  S.blocks.forEach(b => {
    if (!b.energy.length) rows.push({block: b.id, type: b.type, status: b.status, label: '（无负荷）', value: null, unit: '', kW: null, verified: null, hint: null, empty: true});
    b.energy.forEach(e => rows.push({block: b.id, type: b.type, status: b.status, label: e.role_hint || (e.kind === 'work' ? 'work' : 'heat'), value: e.value, unit: e.unit, kW: e.kW, verified: e.verified, hint: e.role_hint ?? null, empty: false}));
  });
  return {rows, totals: S.group_totals, totalsComplete: S.totals_complete};
}
