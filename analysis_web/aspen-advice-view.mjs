// 建议面板与能量表的纯 HTML 渲染（无 DOM 依赖，可在 Node 测试）。样式在 aspen-advice.css，视觉由设计侧维护。
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const SEVERITY_ZH = {critical: '严重', warn: '警告', suggest: '建议', info: '提示'};
export const CATEGORY_ZH = {convergence: '收敛与运行', 'thermo/phase': '物性与相态', reaction: '反应', units: '单位', energy: '能量', 'heat-integration': '热集成', 'data-completeness': '数据完整性', 'lca-readiness': 'LCA 就绪度'};
export const STATE_ZH = {ok: '正常', warning: '有警告', error: '有错误', unknown: '未知'};
export const CONFIDENCE_ZH = {verified: '直接读数', heuristic: '经验推断'};
const kw = v => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', {maximumFractionDigits: 3}));

export function adviceHTML(advice) {
  if (!advice.items.length) return '<p class="advice-empty">没有发现需要提醒的问题。这不等于模型没有问题：规则只覆盖探针读到的字段。</p>';
  return '<ol class="advice-list">' + advice.items.map(it => `<li class="advice-item" data-severity="${esc(it.severity)}" data-rule="${esc(it.rule)}">
<header><span class="advice-sev">${esc(SEVERITY_ZH[it.severity])}</span> <strong>${esc(it.title_zh)}</strong>
<span class="advice-meta">${esc(CATEGORY_ZH[it.category] || it.category)} · ${it.target === 'global' ? '整体' : esc(it.target)} · ${esc(CONFIDENCE_ZH[it.confidence])}</span></header>
<p>${esc(it.detail_zh)}</p><p class="advice-action"><b>建议：</b>${esc(it.action_zh)}</p>
<details><summary>证据（${it.evidence.length}）</summary><ul>${it.evidence.map(e => `<li><code>${esc(e.path)}</code> = <code>${esc(JSON.stringify(e.value))}${e.unit ? ' ' + esc(e.unit) : ''}</code></li>`).join('')}</ul></details></li>`).join('') + '</ol>';
}

export function energyHTML({rows, totals, totalsComplete}) {
  const body = rows.map(r => `<tr data-status="${esc(r.status)}"><td>${esc(r.block)}</td><td>${esc(r.type)}</td><td>${esc(STATE_ZH[r.status] || r.status)}</td><td>${esc(r.label)}</td>
<td class="num">${r.value === null ? '—' : esc(r.value)}</td><td>${esc(r.unit)}</td><td class="num">${kw(r.kW)}</td><td>${r.verified === null ? '' : r.verified ? '已验证' : '未验证'}</td></tr>`).join('');
  const t = totals || {};
  const tot = [['外部加热', 'heating'], ['外部冷却', 'cooling'], ['轴功', 'shaft_work'], ['内部换热（不计入外购）', 'internal_exchange'], ['净值（加热+冷却+轴功，不含内部换热）', 'overall']]
    .map(([label, k]) => `<tr><th scope="row" colspan="6">${label}</th><td class="num">${kw((t[k] || {}).kW)}</td><td></td></tr>`).join('');
  return `<table class="energy-table"><caption>逐块能量表（kW 列由原生单位换算；缺失为 —，不当 0）</caption><thead><tr><th>块</th><th>类型</th><th>状态</th><th>项目</th><th>原生值</th><th>单位</th><th>kW</th><th>读取</th></tr></thead><tbody>${body}</tbody><tfoot>${tot}${totalsComplete ? '' : '<tr><td colspan="8">合计不完整：有块缺读数或单位无法换算，合计仅供参考。</td></tr>'}</tfoot></table>`;
}

export function headerHTML(result, advice) {
  const S = result.summary, c = advice.counts;
  const inputs = [['probe-summary', result.names.summary], ['graph', result.names.graph], ['roles', result.names.roles]].map(([k, v]) => `${k}：${v ? esc(v) : '未提供'}`).join('　');
  return `<section class="advice-head"><h2>${esc(S.model.file)}　<small>运行状态：${esc(STATE_ZH[S.status.state])}</small></h2>
<p>${inputs}${S.migrated_from ? '　（旧版 aspen-probe/1，已在浏览器里升级）' : ''}</p>
<p class="advice-counts">严重 ${c.critical}　警告 ${c.warn}　建议 ${c.suggest}　提示 ${c.info}</p>
${result.warnings.map(w => `<p class="advice-note">${esc(w)}</p>`).join('')}</section>`;
}
