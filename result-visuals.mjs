import {t,getLanguage} from './i18n.mjs';
import {inputUncertainty} from './uncertainty-diagnostics.mjs';
import {inputUncertaintyHTML} from './uncertainty-views.mjs';
import {buildResultExport,supportDomain} from './result-exports.mjs';
import {downloadCSV,downloadText,standaloneSVG} from './chart-export.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (value, digits = 4) => Number.isFinite(value) ? (value !== 0 && Math.abs(value) < 10 ** -digits ? value.toExponential(2) : value.toLocaleString('en-US', {maximumFractionDigits: digits})) : '—';
const nominal = cuts => cuts?.find(c => c.alpha === 1)?.range?.[0] ?? null;
const finite = value => Number.isFinite(value) ? value : null;

// Only reads audited outputs. No second accounting implementation or chart-only imputation.
export function resultVisualData(project, report, caseId, category) {
  const selected = report?.results?.find(r => r.id === caseId) ?? report?.results?.[0];
  if (!selected) return null;
  const categories = report.categories ?? [];
  const selectedCategory = categories.includes(category) ? category : categories[0];
  const impact = selected.impacts.find(i => i.category === selectedCategory);
  const factors=project.factors.filter(f=>f.category===selectedCategory);
  const factorUnits=new Set(factors.map(f=>String(f.impact_unit||'').trim())),factorMethods=new Set(factors.map(f=>String(f.method||'').trim()));
  const contextConsistent=factorUnits.size===1&&!factorUnits.has('')&&factorMethods.size===1&&!factorMethods.has('');
  const covered = new Set(impact?.contributions.map(c => c.id) ?? []);
  const inventory = project.inventory.filter(r => r.case_id === selected.id);
  const sourceBlocks = project.blocks.filter(r => r.case_id === selected.id);
  return {
    caseId: selected.id, categories, category: selectedCategory,
    provenance:{project:project.meta.name||'',boundary:project.meta.boundary||'',functionalUnit:project.meta.functional_unit||'',evidence:project.meta.evidence_type||'imported_data',modelHash:project.meta.source_sha256||'',locallyModified:project.meta.locally_modified===true,originModelHash:project.meta.origin?.source_sha256||'',originEvidence:project.meta.origin?.evidence_type||'',caseSource:project.cases.find(row=>row.id===selected.id)?.source||''},
    balanceComplete: selected.balance.complete,
    balanceWithinTolerance: selected.balance.within_tolerance,
    blocks: selected.balance.blocks.map(b => ({...b,source:sourceBlocks.find(row=>row.id===b.id)?.source||''})),
    missingBlocks: sourceBlocks.filter(b => !selected.balance.blocks.some(row => row.id === b.id)).map(b => b.id),
    missingBlockSources:Object.fromEntries(sourceBlocks.map(row=>[row.id,row.source||''])),
    impact: impact ? {
      category: impact.category, unit: impact.unit, method: impact.method, complete: impact.complete,contextConsistent,
      // A known subtotal is never promoted to a complete footprint.
      total: impact.complete ? finite(nominal(impact.cuts)) : null,
      subtotal: contextConsistent?finite(impact.nominal_subtotal):null, covered: impact.covered, count: impact.total,
      contributions: impact.contributions.filter(c => Number.isFinite(c.nominal)).map(c => ({...c,unit:factors.find(f=>f.id===c.factor_id)?.impact_unit||'',method:factors.find(f=>f.id===c.factor_id)?.method||'',inventorySource:inventory.find(row=>row.id===c.id)?.source||''})).sort((a,b) => b.nominal - a.nominal),
      missing: inventory.filter(row => !covered.has(row.id)).map(row => ({id:row.id, name:row.name || row.id, factorId:row.factor_id,source:row.source||''})),
      cuts: impact.complete ? impact.cuts.map(c => ({alpha:c.alpha, range:[...c.range]})) : [],
    } : null,
    comparable: project.meta.comparable_cases === true,
    cases: report.results.map(row => {
      const rowImpact = row.impacts.find(i => i.category === selectedCategory);
      return {id:row.id, energy:finite(nominal(row.energy)), impact:rowImpact?.complete ? finite(nominal(rowImpact.cuts)) : null,
        yield:finite(row.yield?.[1]) === null ? null : row.yield[1] * 100,
        impactComplete:rowImpact?.complete === true, balanceWithinTolerance:row.balance.within_tolerance,source:project.cases.find(c=>c.id===row.id)?.source||''};
    }),
  };
}

function dataTable(headings, rows, caption) {
  return `<details class="rv-data"><summary>${t('View chart data','查看图表数据')}</summary><div class="rv-table-scroll" tabindex="0"><table><caption>${esc(caption)}</caption><thead><tr>${headings.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((v,i)=>i===0?`<th scope="row">${esc(v)}</th>`:`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}

function bars(rows, unit, selectedId) {
  const maximum = Math.max(0, ...rows.map(r=>r.value ?? 0));
  return `<div class="rv-bars" role="list">${rows.map(row=>`<div class="rv-bar-row ${row.id===selectedId?'is-selected':''}" role="listitem"><div class="rv-bar-label"><span title="${esc(row.label)}">${esc(row.label)}</span><strong>${row.value === null ? t('Unavailable','不可用') : fmt(row.value)}</strong></div><div class="rv-track" aria-hidden="true">${row.value === null ? '<span class="rv-missing-track"></span>' : `<span style="width:${maximum ? Math.max(0,row.value/maximum*100) : 0}%"></span>`}</div></div>`).join('')}</div><p class="rv-axis-note">${t('Zero-based scale','从零起始的刻度')} · ${esc(unit)}</p>`;
}

function exportButtons(kind,svgAvailable=true,csvAvailable=true){
  return `<div class="rv-export-actions" role="group" aria-label="${t('Export this chart','导出此图表')}">${kind==='cases'?'':`<button type="button" data-rv-export="${kind}" data-rv-format="svg" ${svgAvailable?'':'disabled'}>${t('Save SVG','保存 SVG')}</button>`}<button type="button" data-rv-export="${kind}" data-rv-format="csv" ${csvAvailable?'':'disabled'}>${t('Save data CSV','保存数据 CSV')}</button></div>`;
}

function contributionPanel(data) {
  const impact = data.impact;
  if (!impact) return `<div class="rv-empty">${t('Import impact factors and calculate to see contributions.','导入影响因子并计算后，即可查看贡献图。')}</div>`;
  if(!impact.contextConsistent)return `<div class="rv-chart-card"><h3>${t('Inventory contributions','清单贡献')}</h3><p class="rv-warning">${t('This category mixes methods or impact units. A common contribution chart and subtotal are withheld. Align the factors before comparing; individual values retain their own units below.','此类别混用了方法或影响单位，暂不绘制共同贡献图或小计。请先统一因子再比较；下方逐项保留原始单位。')}</p>${exportButtons('contributions',false,impact.contributions.length+impact.missing.length>0)}${dataTable([t('Inventory','清单项'),t('Nominal contribution','名义贡献'),t('Unit','单位'),t('Method','方法')],impact.contributions.map(row=>[row.name,fmt(row.nominal,7),row.unit?`${row.unit}/kg`:'—',row.method]),t('Individual contributions; no common total','逐项贡献；不提供共同总量'))}</div>`;
  const unit = `${impact.unit}/kg ${t('product','产品')}`;
  const rows = impact.contributions.slice(0,12).map(row=>({id:row.id, label:row.name, value:row.nominal}));
  return `<div class="rv-chart-card"><div class="rv-chart-heading"><h3>${t('What drives the impact?','哪些清单项贡献最大？')}</h3><span>${impact.complete?t('Complete declared inventory','已覆盖声明的全部清单'):t('Partial coverage','清单覆盖不完整')}</span></div><p class="rv-description">${esc(impact.category)} · ${esc(unit)}</p>
    ${rows.length ? bars(rows,unit) : `<p class="rv-empty">${t('No characterized inventory rows.','尚无完成表征的清单项。')}</p>`}
    <p class="rv-total">${impact.complete?t('Nominal total','名义总量'):t('Covered-row subtotal only','仅已覆盖清单项的小计')} <strong>${fmt(impact.complete?impact.total:impact.subtotal)}</strong> <span>${esc(unit)}</span></p>
    ${impact.missing.length?`<p class="rv-warning">${t('Not characterized','尚未表征')}: ${impact.missing.map(row=>esc(row.name)).join(' · ')}. ${t('Missing values are not zero. A complete footprint is withheld.','缺失值不等于零，暂不提供完整足迹。')}</p>`:''}
    ${impact.contributions.length>12?`<p class="rv-description">${t('Chart shows the 12 largest contributions. All characterized rows are in the table.','图中显示贡献最大的 12 项，表格保留全部已表征清单项。')}</p>`:''}
    <p class="rv-description">${esc(impact.method)} · ${impact.covered}/${impact.count} ${t('inventory rows characterized','项清单已表征')}</p>
    ${exportButtons('contributions',rows.length>0,impact.contributions.length+impact.missing.length>0)}${dataTable([t('Inventory','清单项'),t('Nominal contribution','名义贡献'),t('Factor','因子'),t('Source','来源')],impact.contributions.map(row=>[row.name,fmt(row.nominal,7),row.factor_id,row.source]),`${impact.category} · ${unit}`)}
  </div>`;
}

export function supportAxis(cuts) {
  return supportDomain(cuts);
}

function supportPanel(data,diagnostics) {
  const impact = data.impact;
  const heading = `<h3>${t('How wide are the input supports?','输入支持区间有多宽？')}</h3><p class="rv-description">${t('Lines show α-cut bounds. The point is the nominal result at α = 1.','线段表示 α 截集上下界，圆点表示 α = 1 时的名义结果。')}</p>`;
  if (!impact?.complete) return `<div class="rv-chart-card">${heading}<p class="rv-empty">${t('Complete the selected impact category before showing support bounds.','补齐所选影响类别后，再显示支持区间。')}</p>${exportButtons('supports',false)}${inputUncertaintyHTML(diagnostics)}</div>`;
  const [minimum,maximum] = supportAxis(impact.cuts);
  const scale=maximum||1;
  const x = value => 72 + (value/scale-minimum/scale)/(maximum/scale-minimum/scale)*328;
  const height = impact.cuts.length*48+72;
  const description = t('Possibility supports from imported triangular inputs; not probability, confidence intervals or predictive uncertainty.','这些是导入三角模糊输入推导的可能性支持区间，不是概率、置信区间或预测不确定性。');
  const svg = `<svg class="rv-support" viewBox="0 0 440 ${height}" role="img" aria-label="${esc(t('Impact possibility supports','影响可能性支持区间'))}"><title>${esc(impact.category)}</title><desc>${esc(description)}</desc><line class="rv-grid" x1="72" x2="72" y1="14" y2="${height-52}"/>${impact.cuts.map((cut,i)=>{const y=24+i*48;const bounds=cut.range[0]===cut.range[1]?fmt(cut.range[0],5):cut.range.map(v=>fmt(v,5)).join(' – ');return `<g><title>α = ${cut.alpha}: ${bounds} ${esc(impact.unit)}/kg</title><text x="0" y="${y+4}">α = ${cut.alpha}</text><line class="rv-guide" x1="72" x2="400" y1="${y}" y2="${y}"/><line class="rv-interval" x1="${x(cut.range[0])}" x2="${x(cut.range[1])}" y1="${y}" y2="${y}"/><line class="rv-cap" x1="${x(cut.range[0])}" x2="${x(cut.range[0])}" y1="${y-5}" y2="${y+5}"/><line class="rv-cap" x1="${x(cut.range[1])}" x2="${x(cut.range[1])}" y1="${y-5}" y2="${y+5}"/>${cut.alpha===1?`<circle cx="${x(cut.range[0])}" cy="${y}" r="5"/>`:''}<text x="72" y="${y+19}" class="rv-bounds">${bounds}</text></g>`;}).join('')}<line class="rv-grid" x1="72" x2="400" y1="${height-52}" y2="${height-52}"/><text x="72" y="${height-29}">${fmt(minimum,4)}</text><text x="236" y="${height-29}" text-anchor="middle">${fmt(minimum/2+maximum/2,4)}</text><text x="400" y="${height-29}" text-anchor="end">${fmt(maximum,4)}</text></svg>`;
  return `<div class="rv-chart-card">${heading}<div class="rv-svg-scroll">${svg}</div><p class="rv-axis-note">${t('Axis zoomed to the displayed supports','坐标轴缩放至当前支持区间')} · ${fmt(minimum,4)}–${fmt(maximum,4)}</p><p class="rv-description">${esc(impact.unit)}/kg ${t('product','产品')}. ${description}</p>${exportButtons('supports')}${dataTable(['α',t('Lower bound','下界'),t('Upper bound','上界')],impact.cuts.map(c=>[c.alpha,fmt(c.range[0],7),fmt(c.range[1],7)]),`${impact.category} · ${impact.unit}/kg`)}${inputUncertaintyHTML(diagnostics)}</div>`;
}

function energyPanel(data) {
  const rows = data.blocks;
  if (!rows.length) return `<p class="rv-empty">${t('Complete block duties, units and connections to draw energy flows.','补齐设备负荷、单位和连接后，即可绘制能量图。')}</p>${exportButtons('equipment',false,data.missingBlocks.length>0)}`;
  const peak = Math.max(...rows.flatMap(b=>[Math.abs(b.heat),Math.abs(b.power)]),0) || 1;
  return `<div class="rv-chart-card rv-wide"><div class="rv-chart-heading"><h3>${t('Signed equipment duties','设备有符号热负荷与轴功')}</h3><span>kW</span></div><p class="rv-description">${t('Positive: into the block. Negative: out of the block. Q is heat; W is shaft work.','正值表示输入设备，负值表示从设备输出。Q 为热量，W 为轴功。')}</p><div class="rv-energy-axis"><span>−${fmt(peak,2)}</span><span>0</span><span>+${fmt(peak,2)} kW</span></div><div class="rv-duty-list">${rows.map(row=>`<div class="rv-duty-row"><strong>${esc(row.id)}</strong><div>${[['Q',row.heat],['W',row.power]].map(([kind,value])=>`<div class="rv-duty-item"><span>${kind}</span><div class="rv-duty-track" aria-hidden="true"><i class="${kind==='W'?'rv-work':''}" style="left:${value<0?50-Math.abs(value)/peak*50:50}%;width:${Math.abs(value)/peak*50}%"></i></div><span>${fmt(value,4)}</span></div>`).join('')}</div></div>`).join('')}</div>
    ${data.missingBlocks.length?`<p class="rv-warning">${t('Blocks without complete balance inputs','衡算输入不完整的设备')}: ${data.missingBlocks.map(esc).join(', ')}. ${t('These are omitted, not treated as zero.','这些设备未绘入图中，不视为零负荷。')}</p>`:''}
    <p class="rv-description">${t('Duties come from the normalized block balance. Purchased-energy inventory is separate; the figure does not infer utility suppliers or heat-recovery credits.','负荷取自单位统一后的设备衡算。购入能源单独列入清单，本图不会推断公用工程来源或热回收抵扣。')}</p>
    ${exportButtons('equipment')}${dataTable([t('Block','设备'),'Q / kW','W / kW',t('Mass residual / kg/h','质量残差 / kg/h'),t('Energy residual / kW','能量残差 / kW')],rows.map(row=>[row.id,fmt(row.heat,7),fmt(row.power,7),fmt(row.mass_residual_kg_h,7),fmt(row.energy_residual_kW,7)]),t('Normalized block duties and numerical residuals','单位统一后的设备负荷及数值残差'))}</div>`;
}

function casesPanel(data) {
  if (data.cases.length<2) return `<p class="rv-empty">${t('This project has one case. Import another comparable case to show side-by-side metrics. For the reference HTL model, use Prediction & robustness to explore precomputed conditions.','当前项目只有一个工况。再导入一个可比工况即可并列展示指标。对于参考 HTL 模型，可前往“预测与鲁棒性”查看预计算工况。')}</p>`;
  if (!data.comparable) return `<p class="rv-empty">${t('Review and confirm comparable functions, boundaries and allocation in step 2 before comparing the cases visually.','请先在第 2 步检查并确认工况具有可比的功能、边界和分配规则，再进行图表对比。')}</p>`;
  const rows=data.cases.slice(0,20);
  const metrics=[['energy',t('Purchased energy','购入能耗'),'kWh/kg'],['impact',data.category||t('Impact','环境影响'),`${data.impact?.unit||'—'}/kg`],['yield',t('Target / feed yield','目标产物 / 进料产率'),'%']];
  return `<p class="rv-description">${t('Separate axes preserve each metric’s unit. Dark bars mark the selected case. Missing values remain unavailable; this view does not rank cases.','各指标分别使用自己的坐标轴与单位。深色条表示当前工况，缺失值保留为不可用，本图不进行排名。')}</p><div class="rv-comparison-grid">${metrics.map(([key,label,unit])=>`<div class="rv-chart-card"><h3>${esc(label)}</h3>${bars(rows.map(row=>({id:row.id,label:row.id,value:row[key]})),unit,data.caseId)}</div>`).join('')}</div>${data.cases.length>20?`<p class="rv-description">${t('Showing the first 20 cases. Export the audit for all cases.','显示前 20 个工况，导出审计文件可查看全部工况。')}</p>`:''}${dataTable([t('Case','工况'),'kWh/kg',`${data.impact?.unit||'—'}/kg`,t('Yield / %','产率 / %'),t('Balance check','衡算检查')],rows.map(row=>[row.id,fmt(row.energy),fmt(row.impact),fmt(row.yield),row.balanceWithinTolerance?t('Within tolerance','容差内'):t('Needs review','需检查')]),t('Nominal case metrics; complete category totals only','工况名义指标；仅显示完整影响类别的总量'))}`;
}

const mounted = new Map();
export function renderResultVisuals(container, options) {
  if (!container) return;
  const previous = mounted.get(container);
  const externalCategoryChanged=previous && previous.category!==options.category;
  const state={...options,view:previous?.view||'impact',selectedCategory:previous?.caseId===options.caseId&&!externalCategoryChanged?previous.selectedCategory:options.category};
  const data=resultVisualData(options.project,options.report,options.caseId,state.selectedCategory);
  if (!data) {clearResultVisuals(container);return;}
  const diagnostics=inputUncertainty(options.project,options.report,data.caseId,data.category);
  state.selectedCategory=data.category;mounted.set(container,state);
  container.classList.add('result-visuals');
  container.innerHTML=`<div class="rv-header"><div><span class="rv-eyebrow">${t('CALCULATED FROM IMPORTED DATA','基于导入数据计算')}</span><h2>${t('See what the numbers mean.','让数据更直观。')}</h2><p>${t('Trace each visual back to your inputs and audited results.','每张图都可追溯至输入清单与衡算结果。')}</p></div><label class="rv-category">${t('Impact category','影响类别')}<select data-rv-category ${data.categories.length?'':'disabled'}>${data.categories.length?data.categories.map(c=>`<option value="${esc(c)}" ${c===data.category?'selected':''}>${esc(c)}</option>`).join(''):`<option>${t('No factors imported','尚未导入因子')}</option>`}</select></label></div>
    <div class="rv-tabs" role="group" aria-label="${t('Chart views','图表视图')}">${[['impact',t('Impact & supports','影响与支持区间')],['energy',t('Equipment energy','设备能量')],['cases',t('Across cases','工况对比')]].map(([key,label])=>`<button type="button" data-rv-view="${key}" aria-pressed="${state.view===key}">${label}</button>`).join('')}</div>
    <div class="rv-body">${state.view==='impact'?`<div class="rv-impact-grid">${contributionPanel(data)}${supportPanel(data,diagnostics)}</div>`:state.view==='energy'?energyPanel(data):`${casesPanel(data)}${exportButtons('cases',false,data.cases.length>0)}`}</div><p class="rv-export-status" data-rv-export-status role="status" hidden></p>`;
  container.querySelector('[data-rv-category]').addEventListener('change',e=>{state.selectedCategory=e.target.value;renderResultVisuals(container,state);container.dispatchEvent(new CustomEvent('resultcategorychange',{detail:{category:state.selectedCategory}}));});
  for(const button of container.querySelectorAll('[data-rv-view]'))button.addEventListener('click',()=>{state.view=button.dataset.rvView;renderResultVisuals(container,state);container.querySelector(`[data-rv-view="${state.view}"]`).focus({preventScroll:true});});
  for(const button of container.querySelectorAll('[data-rv-export]'))button.addEventListener('click',()=>{
    // A detached or superseded result must never export the previous calculation.
    if(mounted.get(container)!==state||!container.isConnected||button.disabled)return;
    const message=container.querySelector('[data-rv-export-status]');
    try{
      const kind=button.dataset.rvExport,format=button.dataset.rvFormat,chart=buildResultExport(data,kind);
      const filename=`process-${kind}-${data.caseId}-${getLanguage()}`.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').slice(0,150);
      if(format==='csv')downloadCSV(`${filename}.csv`,chart.columns,chart.rows);
      else if(chart.svg)downloadText(`${filename}.svg`,standaloneSVG(chart.svg,chart),'image/svg+xml;charset=utf-8');
      else throw new Error(t('Complete the chart inputs before exporting SVG.','补齐图表输入后，再导出 SVG。'));
      message.textContent=t('Export prepared from the current calculation. CSV preserves full numerical precision.','已根据当前计算生成导出文件，CSV 保留完整数值精度。');
    }catch(error){message.textContent=`${t('Export unavailable','暂时无法导出')}: ${error.message}`;}
    message.hidden=false;
  });
}

export function clearResultVisuals(container) {
  if (!container) return;
  mounted.delete(container);container.innerHTML='';
}

if (typeof window !== 'undefined') window.addEventListener('languagechange',()=>{
  for(const [container,options] of mounted)if(container.isConnected)renderResultVisuals(container,options);else mounted.delete(container);
});
