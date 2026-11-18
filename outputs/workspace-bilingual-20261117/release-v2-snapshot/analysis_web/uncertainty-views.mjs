import {t} from './i18n.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(value,digits=4)=>Number.isFinite(value)?(value!==0&&Math.abs(value)<10**-digits?value.toExponential(2):value.toLocaleString('en-US',{maximumFractionDigits:digits})):'—';
const range=values=>values?.map(v=>fmt(v)).join(' – ')||'—';

export function inputUncertaintyHTML(diagnostics){
  const d=diagnostics,kinds={inventory:t('Inventory quantity','清单数量'),factor:t('Impact factor','影响因子'),product:t('Product rate','产品流量')};
  return `<details class="uncertainty-details"><summary>${t('Which inputs create this range?','哪些输入产生了这个区间？')}</summary>
    <p>${t('Only explicitly varying input bounds are listed. Each footprint interval changes one input while all others remain nominal.','这里只列出明确声明了变化范围的输入。每一项足迹区间只改变该输入，其余输入保持名义值。')}</p>
    ${d.varying.length?`<div class="uncertainty-table-scroll" tabindex="0"><table><caption>${esc(d.category||'')} · ${esc(d.unit||'')}</caption><thead><tr><th>${t('Input & source','输入与来源')}</th><th>${t('Declared lower / mode / upper','声明的下界 / 众数 / 上界')}</th><th>${t('One-input footprint support','单项输入变化的足迹支持区间')}</th></tr></thead><tbody>${d.varying.map(row=>`<tr><th scope="row"><span>${kinds[row.kind]} · ${esc(row.label)}</span><small data-no-i18n>${esc(row.source||t('Source not supplied','未提供来源'))}</small></th><td>${fmt(row.lower)} / ${fmt(row.mode)} / ${fmt(row.upper)}<small>${esc(row.unit)}</small></td><td>${row.impactSupport?range(row.impactSupport):t('Unavailable','不可用')}<small>${row.kind==='factor'&&row.affectedInventory.length>1?t('Shared across matching inventory rows','在匹配的清单项之间共享'):''}${row.error?esc(row.error):''}</small></td></tr>`).join('')}</tbody></table></div>`:`<p class="uncertainty-empty">${t('No varying bounds were declared. A collapsed support does not establish zero physical or model uncertainty.','尚未声明变化范围。支持区间退化为单点，并不证明物理或模型不确定性为零。')}</p>`}
    ${!d.available?`<p>${t('Complete the selected impact category before interpreting sensitivity intervals.','补齐所选影响类别后，才能解读敏感性区间。')}</p>`:''}
    <p class="uncertainty-note">${t('Declared fixed inputs','声明为定值的输入')}: ${d.fixedCounts.inventory} ${t('quantities','项数量')} · ${d.fixedCounts.factors} ${t('factors','个因子')} · ${d.fixedCounts.product} ${t('product rate','项产品流量')}. ${t('Unspecified bounds are treated as fixed for this calculation.','未给出范围的输入在本次计算中按定值处理。')}</p>
    <p class="uncertainty-note">${t('Do not add these one-input spans together. They are not variance shares, confidence intervals or the combined fuzzy support. Shared factors vary together across their linked inventory rows.','不可将这些单项区间相加。它们不是方差贡献、置信区间，也不是合并后的模糊支持区间。共享因子会在所关联的清单项中同时变化。')}</p>
    ${d.errors.length?`<p class="uncertainty-note">${d.errors.map(esc).join(' · ')}</p>`:''}</details>`;
}

export function preferenceControlsHTML(){
  return `<details class="uncertainty-details preference-details"><summary>${t('How sensitive is ranking to your priorities?','排名对偏好权重有多敏感？')}</summary><p>${t('Compare 66 combinations of energy, impact and yield weights on a 0.1 grid. This uses nominal results and keeps your current weights unchanged.','在步长为 0.1 的网格上比较 66 组能耗、影响和产率权重。扫描使用名义结果，并保留当前设置的权重。')}</p><button type="button" class="button secondary" data-preference-run>${t('Scan 66 preference combinations','扫描 66 组偏好权重')}</button><div data-preference-output aria-live="polite"></div></details>`;
}

export function renderPreferenceScan(container,scan){
  if(!container)return;
  container.innerHTML=`<div class="preference-summary"><strong>${scan.sampleCount}</strong><span>${t('preference settings','组偏好设置')}</span><strong>${scan.rows.length}</strong><span>${t('eligible cases','个可比工况')}</span></div>
    <p class="uncertainty-note">${t('Leading credit is divided equally when cases tie. The shared percentages sum to 100% of this chosen preference grid, not a probability distribution. Rank spans include tied positions.','并列领先时平均分配领先份额。各工况的共享百分比合计为这套偏好网格的 100%，不是概率分布。排名跨度包含并列名次。')}</p>
    <div class="uncertainty-table-scroll" tabindex="0"><table><caption>${esc(scan.category)} · ${t('Nominal preference sensitivity','名义结果的偏好敏感性')}</caption><thead><tr><th>${t('Case','工况')}</th><th>${t('Shared leading share','共享领先份额')}</th><th>${t('Settings leading or tied','领先或并列的设置数')}</th><th>${t('Nominal rank span','名义排名跨度')}</th></tr></thead><tbody>${scan.rows.map(row=>`<tr><th scope="row" data-no-i18n>${esc(row.id)}</th><td>${fmt(row.preferenceShare*100,1)}%<span class="preference-bar" aria-hidden="true"><i style="width:${row.preferenceShare*100}%"></i></span></td><td>${row.leaderInclusions} / ${scan.sampleCount}</td><td>${row.rankRange.join('–')}</td></tr>`).join('')}</tbody></table></div>
    <p class="uncertainty-note">${t('Excluded incomplete cases','排除的不完整工况')}: ${esc(scan.excluded.join(', ')||t('none','无'))}. ${t('These results describe sensitivity to preference choices. Operating perturbations and prediction error are not varied in this scan.','这些结果描述对偏好选择的敏感性。本次扫描未改变工况扰动或预测误差。')}</p>`;
}
