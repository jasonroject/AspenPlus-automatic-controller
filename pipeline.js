import {t, getLanguage, mountLanguage, translatePage} from './i18n.mjs';
import {escapeHTML as esc,conditionKey,responseSlice,climateContributions,orderedCandidates,supportedPoint,pairChart,responseChart,contributionChart,rankChart,metricRangeChart} from './pipeline-charts.mjs';
import {mountResponseInspector,clearResponseInspector} from './response-inspector.mjs';
import {downloadCSV,downloadSVG} from './chart-export.mjs';
import {predictionColumns,predictionChartRows} from './pipeline-export.mjs';

const q = selector => document.querySelector(selector);
const format = (value,digits=2) => Number.isFinite(value) ? value.toLocaleString(getLanguage()==='zh'?'zh-CN':'en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits}) : '—';
let analysis, observations={rows:[],sources:[]}, current=null, currentScenario='HR', currentSlice=null, currentContributions=[];
let inputsDirty=false, selectedCandidate='', section='predict', observationsAvailable=false;
const params = new URL(location.href).searchParams;
const condition = row => `${format(row.temperature_C,1)} °C / ${format(row.length_m,2)} m`;
const energyUnit=()=>t('kWh / 100 kg wet feed','kWh / 100 kg 湿进料'),carbonUnit=()=>t('kg CO₂-eq/kg target','kg CO₂-eq/kg 目标单体'),outputUnit=()=>t('kg / 100 kg wet feed','kg / 100 kg 湿进料');
const metric = (name,scenario=currentScenario) => name==='energy' ? {key:scenario+'_electricity_kWh',label:t('Equivalent electricity','等效电耗'),unit:energyUnit()} : name==='carbon' ? {key:'CF_'+scenario,label:t('Carbon footprint','碳足迹'),unit:carbonUnit()} : {key:'target_kg_h',label:t('Target monomer output','目标单体产出'),unit:outputUnit()};
const nativeEvidenceLabel=key=>key.startsWith('STD_')||key==='CF_STD'?t('Native-derived STD accounting','原生数据推导的 STD 核算值'):t('Native simulation result','原生仿真结果');
const card = (label,value,unit,note) => `<article class="overview-kpi"><div class="overview-kpi-label">${esc(label)}</div><div class="overview-kpi-value">${esc(value)}<span class="overview-kpi-unit">${esc(unit)}</span></div><p class="overview-kpi-note">${esc(note)}</p></article>`;
function updateActions(){
  q('#predict-button').disabled=!analysis?.prediction_enabled;
  q('#download-prediction').disabled=!current;
  q('#download-plan').disabled=!current;
  q('#next-robust').disabled=!current||!analysis?.robustness;
  q('[data-section="robust"]').disabled=!analysis?.robustness;
  q('#plan-context').textContent=current ? `${t('Plan for','计划工况')} ${condition(current)}. ${t('The local runner executes the HR reference flowsheet; STD energy is reconstructed from its boundary.','本地执行器运行 HR 参考流程；STD 能耗根据对应边界重构。')}` : t('Show a valid prediction in step 1 before downloading a plan.','请先在第 1 步生成有效预测，再下载扫描计划。');
  updateChartExports();
}
const chartTargets={energy:'#energy-pair',carbon:'#carbon-pair',response:'#response-chart'};
const exportedRows=kind=>predictionChartRows(kind,{analysis,current,scenario:currentScenario,slice:currentSlice,observations,dirty:inputsDirty});
function chartTitle(kind){return kind==='response'?`${metric(q('#trend-metric').value).label} — ${currentScenario}`:kind==='energy'?t('STD and HR equivalent-electricity predictions','STD 与 HR 等效电耗预测'):t('STD and HR carbon-footprint predictions','STD 与 HR 碳足迹预测');}
function updateChartExports(){
  for(const button of document.querySelectorAll('[data-chart-export]')){
    const kind=button.dataset.chartExport,format=button.dataset.exportFormat;
    button.disabled=!exportedRows(kind).length||!q(chartTargets[kind]).querySelector('svg');
    button.textContent=format==='svg'?t('Save SVG ↓','保存 SVG ↓'):t('Data CSV ↓','数据 CSV ↓');
    button.setAttribute('aria-label',`${chartTitle(kind)} · ${format==='svg'?t('Save SVG','保存 SVG'):t('Download chart data CSV','下载图表数据 CSV')}`);
    button.title=format==='svg'?t('Editable vector chart with units and evidence notes.','可编辑矢量图，附有单位与证据说明。'):t('Exact numeric values. Spreadsheet-safe text; original text remains in JSON.','保留数值精度；文本经电子表格安全转义，原始文本保留在 JSON。');
  }
}
function installChartExports(){
  for(const [kind,target] of Object.entries(chartTargets)){
    q(target).insertAdjacentHTML('afterend',`<div class="chart-export-actions"><button type="button" class="button secondary" data-chart-export="${kind}" data-export-format="svg" disabled>SVG ↓</button><button type="button" class="button secondary" data-chart-export="${kind}" data-export-format="csv" disabled>CSV ↓</button><span data-export-status role="status"></span></div>`);
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-chart-export]');if(!button||button.disabled)return;
    const kind=button.dataset.chartExport,rows=exportedRows(kind),svg=q(chartTargets[kind]).querySelector('svg');
    if(!rows.length||!svg)return;
    const status=button.parentElement.querySelector('[data-export-status]');
    const name=`htl-${kind}-${current.temperature_C}C-${current.length_m}m-${kind==='response'?currentScenario+'-'+currentSlice.metric+'-'+currentSlice.axis:'STD-HR'}`;
    try{
      if(button.dataset.exportFormat==='csv')downloadCSV(name+'.csv',predictionColumns,rows);
      else {
        const description=kind==='response'?t('Line: frozen GP predictions. Hollow circles: results from native records. Solid circle: selected prediction. STD heating is reconstructed from the HR boundary; native records are not interpolated.','曲线为冻结 GP 预测，空心点为原生记录推导的结果，实心点为所选预测。STD 供热由 HR 边界重构；不对原生记录插值。'):t('Frozen GP predictions at one operating condition. STD energy is reconstructed from the HR boundary.','同一工况的冻结 GP 预测；STD 能耗由 HR 边界重构。');
        const metadata={
          [t('Selected condition','所选工况')]:`${current.temperature_C} °C / ${current.length_m} m`,
          [t('Basis','核算基准')]:`${analysis.basis.wet_feed_kg} kg ${t('wet feed','湿进料')} / ${analysis.basis.duration_h} h; ${analysis.basis.pressure_MPa} MPa`,
          [t('Scope','范围')]:t('Fixed-background climate accounting; simulation/model evidence, not physical validation.','固定背景气候影响核算；属于仿真/模型证据，不代表物理验证。'),
          [t('Source','来源')]:'data/pipeline.json',
          'Reference SHA-256':analysis.training.reference_sha256,
        };
        if(kind==='response'){
          metadata[t('Held fixed','固定输入')]=`${currentSlice.fixed}: ${current[currentSlice.fixed]} ${currentSlice.fixed==='length_m'?'m':'°C'}`;
          metadata[t('Shown records','图中记录')]=`${currentSlice.predictions.length} ${t('predictions','个预测点')} / ${currentSlice.native.length} ${t('native records','条原生记录')}`;
        }
        downloadSVG(name+'.svg',svg,{title:chartTitle(kind),description,metadata});
      }
      status.textContent=t('Saved','已保存');
    }catch(error){status.textContent=t('Export unavailable: ','暂时无法导出：')+error.message;}
  });
}
function showSection(name,scroll=true){
  section=['predict','robust','evidence'].includes(name)?name:'predict';
  if(section==='robust'&&!analysis?.robustness)section='evidence';
  for(const button of document.querySelectorAll('[data-section]')){const on=button.dataset.section===section;button.setAttribute('aria-pressed',String(on));q('#section-'+button.dataset.section).hidden=!on;}
  history.replaceState(null,'',location.pathname+location.search+'#'+section);
  if(scroll)q('#section-'+section).scrollIntoView({block:'start',behavior:'instant'});
}
function clearPrediction(){
  clearResponseInspector(q('#response-chart'));
  current=null;currentSlice=null;currentContributions=[];inputsDirty=true;
  q('#prediction-result').innerHTML='';q('#prediction-visuals').hidden=true;
  q('#prediction-error').hidden=false;q('#prediction-error').textContent=t('Inputs changed. Select Show prediction to refresh all results and exports.','输入已更改。点击“生成预测”更新全部结果与导出。');
  updateActions();renderCandidateContext();
}
function selectedPoint(report=true){
  const form=q('#prediction-form');
  if(!form.checkValidity()){if(report)form.reportValidity();return null;}
  return supportedPoint(analysis.grid.rows,Number(q('#predict-temperature').value),Number(q('#predict-length').value));
}
function refreshReferenceContext(){
  if(params.get('from')!=='import')return;
  q('#reference-context').hidden=false;
  const coordinates=params.get('reference')==='htl'&&['temperature','length'].every(key=>params.get(key)?.trim()&&Number.isFinite(Number(params.get(key))));
  q('#reference-context').textContent=coordinates?
    `${t('Reference coordinates supplied by the import link','导入链接提供的参考工况')}: ${Number(params.get('temperature'))} °C / ${Number(params.get('length'))} m. ${t('Cards and curves show frozen GP predictions, not the imported native values. Energy is shown per 100 kg wet feed over 1 h; carbon footprint remains per kg target.','卡片和曲线显示冻结 GP 预测值，不是导入的原生数值。能耗按 100 kg 湿进料、1 h 显示；碳足迹仍按每 kg 目标单体显示。')}`:
    t('You are exploring a separate HTL reference model. No operating coordinates or data were carried over from your import. Values below use the reference settings and frozen GP predictions; they do not analyze or retrain on your imported project.','当前浏览独立的 HTL 参考模型，未从导入项目带入工况坐标或数据。下方使用参考设置与冻结 GP 预测，不分析本次导入项目，也不会据此重新训练。');
}
function renderAccountingBasis(){
  if(!analysis)return;
  const pump=format(analysis.accounting.pump_inventory_kWh,3);
  q('#accounting-basis-body').innerHTML=`<p>${t('Basis: 100 kg wet model-compound feed over 1 h at 25 MPa. Target mass is catechol + o-cresol across the final outlets, before isolated-product recovery.','基准：100 kg 湿模型化合物进料、1 h、25 MPa。目标质量为最终出口中邻苯二酚与邻甲酚之和，不是分离回收产品量。')}</p><p>${t('HR electricity inventory = positive HEATER duty + positive REACTOR duty, integrated over 1 h, plus a fixed pump inventory of','HR 电力清单 = HEATER 与 REACTOR 的正热负荷在 1 h 内的积分，再加固定泵清单')} <strong>${pump} kWh</strong>. ${t('Useful heat is converted to equivalent electricity with η = 1. The fixed pump inventory is distinct from the native pump work used in the balance.','有用热按 η = 1 换算为等效电耗；固定泵清单与设备衡算使用的原生泵轴功分别保留。')}</p><p>${t('STD replaces the HR heater term with the positive no-recovery preheat enthalpy difference max(0, H(S3) − H(S2)). Fresh verification runs use the HR flowsheet; STD is a reconstructed heating counterfactual.','STD 将 HR 加热器项替换为无热回收预热边界的正焓差 max(0, H(S3) − H(S2))。新的原生复核运行使用 HR 流程，STD 为重构的无热回收供热对照。')}</p><p>${t('The energy inventory excludes separator B6 heat and cooling-service burdens. It is not a complete plant utility inventory. Carbon footprint uses inherited feed, electricity, direct CO₂/CH₄ and wastewater factors, divided by target mass; no new openLCA run is performed.','能源清单不包含 B6 分离器热负荷与冷却服务负荷，不代表全厂公用工程清单。碳足迹沿用进料、电力、直接 CO₂/CH₄ 与废水因子，除以目标单体质量；未重新运行 openLCA。')}</p>`;
}
function renderPrediction(reportValidity=true){
  if(!analysis?.prediction_enabled)return;
  const row=selectedPoint(reportValidity);
  if(!row){clearPrediction();q('#prediction-error').textContent=t('Choose an exact supported grid point: 310–350 °C in 0.5 °C steps and 5–20 m in 0.25 m steps. No rounding or extrapolation is performed.','请选择精确的网格点：310–350 °C，步长 0.5 °C；5–20 m，步长 0.25 m。不会自动取整或外推。');return;}
  current=row;currentScenario=q('#predict-scenario').value;inputsDirty=false;
  const url=new URL(location.href);url.searchParams.set('temperature',row.temperature_C);url.searchParams.set('length',row.length_m);url.searchParams.set('scenario',currentScenario);history.replaceState(null,'',url);
  q('#prediction-error').hidden=true;q('#prediction-visuals').hidden=false;
  q('#prediction-result').innerHTML=card(t('Equivalent electricity','等效电耗'),format(row[currentScenario+'_electricity_kWh'],3),energyUnit(),`${format(row[currentScenario+'_electricity_kWh']/row.target_kg_h,3)} ${t('kWh/kg target','kWh/kg 目标单体')} · ${currentScenario}`)
    +card(t('Carbon footprint','碳足迹'),format(row['CF_'+currentScenario],3),carbonUnit(),t('Fixed-background climate accounting','固定背景气候影响核算'))
    +card(t('Outlet target monomers','出口目标单体'),format(row.target_kg_h,3),outputUnit(),t('Catechol + o-cresol; not isolated recovery','邻苯二酚 + 邻甲酚；非分离回收量'));
  q('#pair-context').textContent=`${condition(row)} · ${t('Frozen GP predictions: HR reference flowsheet and reconstructed STD heating counterfactual. Energy: 100 kg wet feed / 1 h; footprint: 1 kg target.','冻结 GP 预测：HR 参考流程与重构的 STD 无热回收供热对照。能耗按 100 kg 湿进料 / 1 h，碳足迹按 1 kg 目标单体。')}`;
  q('#energy-pair').innerHTML=pairChart(['STD','HR'].map(s=>({label:s,value:row[s+'_electricity_kWh']})),energyUnit(),t('STD and HR equivalent-electricity predictions','STD 与 HR 等效电耗预测'));
  q('#carbon-pair').innerHTML=pairChart(['STD','HR'].map(s=>({label:s,value:row['CF_'+s]})),carbonUnit(),t('STD and HR carbon-footprint predictions','STD 与 HR 碳足迹预测'));
  const native=observations.rows.find(r=>conditionKey(r.temperature_C,r.length_m)===conditionKey(row.temperature_C,row.length_m));
  q('#native-match').textContent=native ? `${nativeEvidenceLabel(currentScenario+'_electricity_kWh')} (${native.split}): ${currentScenario} ${format(native[currentScenario+'_electricity_kWh'],3)} ${energyUnit()} = ${format(native[currentScenario+'_electricity_kWh']/native.target_kg_h,3)} ${t('kWh/kg target','kWh/kg 目标单体')} · ${format(native['CF_'+currentScenario],3)} ${carbonUnit()}. ${t('The cards above remain frozen GP predictions.','上方卡片仍显示冻结 GP 预测值。')}` : t('No native sample is available at these exact coordinates. The values above are predictions.','此精确坐标没有原生样本，上方数值均为预测。');
  if(!observationsAvailable)q('#native-match').textContent=t('Native chart data could not be loaded. Predictions remain available, but no native markers are shown.','未能读取原生图表数据。预测仍可查看，但不显示原生样本标记。');
  renderTrend();renderClimate();updateActions();renderCandidateContext();
}
function renderTrend(){
  if(!current)return;
  const axis=q('#trend-axis').value,spec=metric(q('#trend-metric').value),nativeLabel=nativeEvidenceLabel(spec.key),xLabel=axis==='temperature_C'?t('Temperature / °C','温度 / °C'):t('Tube length / m','管长 / m');
  currentSlice=responseSlice(analysis.grid.rows,observations.rows,current,axis,spec.key);
  q('#response-chart').innerHTML=`<div class="chart-legend"><span><i></i>${t('GP prediction','GP 预测')}</span><span><i class="native"></i>${nativeLabel}</span><span><i class="selected"></i>${t('Selected prediction','所选预测')}</span></div>`+responseChart(currentSlice,{xLabel,yLabel:`${spec.label} · ${spec.unit}`,title:`${spec.label} — ${currentScenario}`,nativeLabel,selectedLabel:t('Selected prediction','所选预测')});
  mountResponseInspector(q('#response-chart'),currentSlice,{xLabel,yLabel:`${spec.label} · ${spec.unit}`,predictionLabel:t('GP prediction','GP 预测'),nativeLabel,noNativeLabel:t('No native value at this exact coordinate.','此精确坐标没有原生数据。'),inspectLabel:t('Inspect exported points','检查导出网格点'),hint:t('Move across the chart or use the slider. Arrow keys, Home and End inspect existing grid points; prediction inputs stay unchanged.','移动到图上或使用滑块；方向键、Home 和 End 检查已有网格点，不修改预测输入。')});
  const fixed=axis==='temperature_C'?`${format(current.length_m,2)} m`:`${format(current.temperature_C,1)} °C`;
  q('#response-caption').textContent=`${currentScenario} · ${t('Held fixed','固定输入')}: ${fixed}. ${currentSlice.predictions.length} ${t('grid predictions','个网格预测点')} · ${currentSlice.native.length} ${t('native points on this exact slice','个位于该精确切片的原生样本点')}. ${t('No native points are invented or interpolated. The vertical axis follows the displayed response range.','不生成或插值原生样本点；纵轴按当前响应范围显示。')}`;
  const rows=[...currentSlice.predictions.map(r=>({...r,kind:'prediction',source:'data/pipeline.json',split:''})),...currentSlice.native.map(r=>({...r,kind:'native'}))].sort((a,b)=>a[axis]-b[axis]);
  q('#response-data').innerHTML=`<table><thead><tr><th>${esc(xLabel)}</th><th>${esc(spec.label)} / ${esc(spec.unit)}</th><th>${t('Evidence type','证据类型')}</th><th>${t('Source / split','来源 / 分组')}</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${format(r[axis],2)}</td><td>${format(r[spec.key],5)}</td><td>${r.kind==='native'?nativeLabel:t('GP prediction','GP 预测')}</td><td data-no-i18n>${esc(r.source)}${r.split?' / '+esc(r.split):''}</td></tr>`).join('')}</tbody></table>`;
  updateChartExports();
}
function renderClimate(){
  const names={feed:t('Feed background','进料背景'),electricity:t('Electricity','电力'),direct:t('Direct emissions','直接排放'),wastewater:t('Wastewater','废水处理')},colors=['#272727','#73736f','#b6b6b0','#e5e5df'];
  currentContributions=climateContributions(current,currentScenario,analysis.accounting).map(row=>({...row,label:names[row.id]}));
  q('#climate-chart').innerHTML=contributionChart(currentContributions,t('Carbon-footprint contributions per kg target','每 kg 目标单体的碳足迹构成'));
  q('#climate-data').innerHTML=`<div class="contribution-list">${currentContributions.map((row,i)=>`<div><i style="background:${colors[i]}"></i>${esc(row.label)}<strong>${format(row.value,row.value<.01?5:3)}</strong><small>${esc(carbonUnit())}</small></div>`).join('')}</div>`;
}
function renderCandidateContext(){
  if(!analysis?.robustness)return;
  const rows=analysis.robustness.scenarios[q('#robust-scenario').value];
  const match=current&&rows.find(r=>conditionKey(r.temperature_C,r.length_m)===conditionKey(current.temperature_C,current.length_m));
  q('#candidate-context').textContent=!current ? t('Candidate comparisons use the fixed interior grid, independently of unsaved prediction inputs.','候选工况比较使用固定的内部网格，不随尚未生成预测的输入变化。') : match ? `${t('Your selected condition is included','当前所选工况已包含在候选集中')}: ${condition(current)}.` : `${condition(current)}: ${t('this exact point is not in the 266-candidate ranking grid. Review the listed candidates; no nearest-point rank is substituted.','此精确点不属于 266 个排名候选工况。请查看列表中的候选工况，不会用邻近点排名代替。')}`;
}
function renderCandidateRanges(){
  const rows=analysis?.robustness?.scenarios[q('#robust-scenario').value]??[];
  const row=rows.find(r=>conditionKey(r.temperature_C,r.length_m)===q('#robust-candidate').value);
  if(!row){q('#candidate-ranges').innerHTML='';q('#inspect-candidate').disabled=true;return;}
  selectedCandidate=q('#robust-candidate').value;q('#inspect-candidate').disabled=false;
  const scenario=q('#robust-scenario').value;
  q('#candidate-ranges').innerHTML=['yield','energy','carbon'].map(name=>{
    const spec=metric(name,scenario),range=row.intervals[spec.key],extent=[Math.min(...rows.map(r=>r.intervals[spec.key][0])),Math.max(...rows.map(r=>r.intervals[spec.key][2]))];
    return `<div class="range-card"><h3>${esc(spec.label)}</h3><strong>${format(range[1],3)}</strong><span>${esc(spec.unit)} · P50</span>${metricRangeChart(range,extent,`${spec.label}: P05 ${range[0]}, P50 ${range[1]}, P95 ${range[2]}`)}<div class="range-extents"><div><small>P05</small>${format(range[0],3)}</div><div><small>P95</small>${format(range[2],3)}</div></div><p class="panel-foot">${t('Scale: all candidates in this scenario','尺度：此方案的全部候选工况')}</p></div>`;
  }).join('');
  renderVariability(row,scenario);
}
function renderVariability(row,scenario){
  const available=Boolean(row.variability&&analysis.robustness.diagnostics?.[scenario]);
  q('#stability-diagnostics').hidden=!available;q('#stability-diagnostics').closest('.diagnostics-panel').hidden=!available;
  if(!available)return;
  const percent=(value,reason)=>Number.isFinite(value)?format(value,2)+'%':t('Unavailable: ','不可用：')+(reason==='zero_mean'?t('zero mean','均值为零'):t('zero median','中位数为零'));
  q('#variability-data').innerHTML=`<table><thead><tr><th>${t('Metric / unit','指标 / 单位')}</th><th>${t('Scenario mean','情景均值')}</th><th>${t('Standard deviation','标准差')}</th><th>CV</th><th>${t('Relative P05–P95 span','相对 P05–P95 区间宽度')}</th></tr></thead><tbody>${['yield','energy','carbon'].map(name=>{const spec=metric(name,scenario),item=row.variability[spec.key];return `<tr><td>${esc(spec.label)}<br><small>${esc(spec.unit)}</small></td><td>${format(item.mean,4)}</td><td>${format(item.standard_deviation,4)}</td><td>${percent(item.CV_pct,item.CV_undefined_reason)}</td><td>${percent(item.relative_P05_P95_span_pct,item.relative_span_undefined_reason)}</td></tr>`;}).join('')}</tbody></table>`;
}
function renderSamplingDiagnostics(){
  const diagnostics=analysis.robustness.diagnostics?.[q('#robust-scenario').value];if(!diagnostics)return;
  const agreement=diagnostics.rank_agreement;
  const tie=diagnostics.exact_tie_audit;
  q('#rank-agreement').innerHTML=`<p>${t('Spearman correlation against nominal scores across all candidates. Exact ties receive average ranks; high overall agreement does not guarantee a stable winner.','全部候选工况相对名义评分的 Spearman 相关系数；完全并列时使用平均秩。整体一致性高不保证第一名稳定。')}</p><div class="diagnostic-values">${['P05','P50','P95'].map((label,i)=>`<span>${label}<strong>${format(agreement.p05_p50_p95?.[i],4)}</strong></span>`).join('')}</div><p class="panel-foot">${agreement.defined_samples} ${t('defined draws','组可计算情景')} · ${agreement.undefined_samples} ${t('undefined draws (constant rank vector)','组不可计算情景（排名向量恒定）')}. ${t('Median mean absolute rank shift','平均绝对排名变化的中位数')}: ${format(diagnostics.mean_absolute_rank_shift_p05_p50_p95[1],2)}.</p>`;
  q('#sampling-diagnostics').innerHTML=`<table><thead><tr><th>${t('Draws','样本量')}</th><th>${t('Largest top-1 change / percentage points','第一名频率最大变化 / 百分点')}</th><th>${t('Nominal leader: top-1 frequency','名义第一名的首位频率')}</th><th>${t('Most frequent winner','首位频率最高的工况')}</th></tr></thead><tbody>${diagnostics.sampling_prefixes.map(row=>`<tr><td>${row.samples}</td><td>${format(row.max_top1_change_from_previous_pp,2)}</td><td>${format(row.nominal_leader_top1_fraction*100,2)}%</td><td>${format(row.leader_temperature_C,0)} °C / ${format(row.leader_length_m,0)} m · ${format(row.leader_top1_fraction*100,2)}%</td></tr>`).join('')}</tbody></table>`;
  q('#sampling-diagnostics').insertAdjacentHTML('beforeend',`<p class="panel-foot">${t('Standard deviation uses ddof = 0. Quantiles use linear interpolation at p × (N − 1), equivalent to type 7. Prefix changes describe this finite sample; they do not prove convergence.','标准差使用 ddof = 0。分位数按 p × (N − 1) 线性插值，等价于 type 7。前缀差异描述当前有限样本，不证明收敛。')}</p>${tie?`<p class="panel-foot">${t('Draws with an exact score tie','存在完全相同评分的情景数')}: ${tie.draws_with_any_exact_score_tie} / ${analysis.robustness.samples}. ${t('The archived top-1 measure assigns one ordinal winner per draw; Spearman uses average ranks for ties.','归档第一名频率每组情景只计一个序位第一名；Spearman 对并列值使用平均秩。')}</p>`:''}`);
}
function renderRobustness(){
  if(!analysis?.robustness){q('#robust-description').textContent=t('Robustness results are unavailable until validation passes.','校验通过前不提供鲁棒性结果。');return;}
  const r=analysis.robustness,scenario=q('#robust-scenario').value,rows=orderedCandidates(r.scenarios[scenario],q('#robust-order').value);
  q('#robust-description').textContent=`${r.samples.toLocaleString()} ${t('shared scenarios across','组共同扰动情景，共')} ${r.candidate_count} ${t('candidates','个候选工况')}. ${t('312–348 °C in 2 °C steps; 6–19 m in 1 m steps. Full perturbation ranges remain inside the prediction domain.','312–348 °C，步长 2 °C；6–19 m，步长 1 m。全部扰动范围均位于预测域内。')}`;
  q('#rank-chart').innerHTML=rankChart(rows,{title:t('Scenario ranking ranges for the first eight candidates','前八个候选工况的情景排名区间'),conditionLabel:t('Condition','工况'),rankLabel:t('Scenario rank · P05 / P50 / P95','情景排名 · P05 / P50 / P95'),topLabel:t('Top-1 frequency','第一名频率'),nominalLabel:t('Nominal rank','名义排名')});
  const interval=(values,n=2)=>`${format(values[0],n)}–${format(values[2],n)}`;
  q('#robust-body').innerHTML=rows.slice(0,20).map(row=>`<tr><td>${condition(row)}</td><td>${row.nominal_rank}</td><td>${format(row.top1_fraction*100,1)}%<span class="frequency"><i style="width:${row.top1_fraction*100}%"></i></span></td><td>${format(row.top5_fraction*100,1)}%</td><td>${interval(row.rank_p05_p50_p95,0)}</td><td>${interval(row.intervals.target_kg_h,3)}</td><td>${interval(row.intervals[scenario+'_electricity_kWh'],3)}</td><td>${interval(row.intervals['CF_'+scenario],3)}</td><td><button class="table-action" data-inspect="${row.temperature_C},${row.length_m},${scenario}">${t('Inspect →','查看 →')}</button></td></tr>`).join('');
  const difference=Math.max(...rows.map(row=>Math.abs(row.first_half_top1-row.second_half_top1)))*100;
  q('#stability-note').textContent=`${t('Sampling check: largest top-1 frequency difference between the two sample halves','采样检查：两半样本中第一名频率的最大差值')} ${format(difference,1)} ${t('percentage points. Frequencies depend on these scenario assumptions and equal weights.','个百分点。频率取决于当前情景假设与等权重偏好。')}`;
  const before=selectedCandidate||q('#robust-candidate').value;
  q('#robust-candidate').innerHTML=rows.map(row=>`<option value="${conditionKey(row.temperature_C,row.length_m)}">${condition(row)} · ${t('rank','排名')} ${row.nominal_rank}</option>`).join('');
  if(rows.some(row=>conditionKey(row.temperature_C,row.length_m)===before))q('#robust-candidate').value=before;
  renderCandidateRanges();renderCandidateContext();renderSamplingDiagnostics();
}
function renderEvidence(){
  const fresh=analysis.fresh_runs.filter(r=>r.accepted).length,hold=analysis.holdout_metrics.target_kg_h?.n||0;
  q('#evidence-stats').innerHTML=card(t('Archived native samples','归档原生样本'),String(analysis.native_reference_count),t('conditions','个工况'),t('Training, holdout and extremum evidence','训练、留出集和极值复核证据'))+card(t('Native verification','原生复核'),`${fresh} / ${analysis.fresh_runs.length}`,t('accepted','通过数值检查'),t('Excluded from fitting','未参与拟合'))+card(t('In-domain holdouts','域内留出集'),String(hold),t('conditions','个工况'),`${analysis.grid.rows.length.toLocaleString()} ${t('GP grid predictions','个 GP 网格预测点')}`);
  q('#scan-body').innerHTML=analysis.fresh_runs.map(r=>`<tr><td>${format(r.temperature_C,2)}</td><td>${format(r.length_m,2)}</td><td>${r.accepted?t('Numerical checks passed','数值检查通过'):esc(r.error||t('Check failed','检查未通过'))}${r.warnings.length?`<details><summary>${t('Original report warnings','原始报告警告')}</summary><span data-no-i18n>${r.warnings.map(esc).join('<br>')}</span></details>`:''}</td><td>${format(r.mass_residual_kg_h,6)}</td><td>${format(r.max_block_energy_residual_kW,6)}</td></tr>`).join('');
  q('#validation-description').textContent=`${hold} ${t('reserved in-domain points and','个域内留出点，以及')} ${fresh} ${t('native verification points. All were excluded from fitting.','个原生复核点，均未参与拟合。')}`;
  const labels={target_kg_h:t('Target monomer mass','目标单体质量'),STD_electricity_kWh:t('STD electricity','STD 电耗'),HR_electricity_kWh:t('HR electricity','HR 电耗'),CF_STD:t('STD carbon footprint','STD 碳足迹'),CF_HR:t('HR carbon footprint','HR 碳足迹')};
  q('#validation-body').innerHTML=Object.entries(labels).map(([key,label])=>`<tr><td>${esc(label)}</td><td>${format(analysis.holdout_metrics[key]?.median_APE_pct,3)}%</td><td>${format(analysis.holdout_metrics[key]?.max_APE_pct,3)}%</td><td>${format(analysis.fresh_metrics[key]?.max_APE_pct,3)}%</td></tr>`).join('');
  const limitations=[
    t('Fixed-background climate calculation, not a new openLCA run or complete multi-impact LCIA.','固定背景气候影响计算，不是新的 openLCA 运行或完整多类别 LCIA。'),
    t('Native cal/s is converted using 4.1868 J/cal. The manuscript archive uses its original units and remains unchanged.','原生 cal/s 按 4.1868 J/cal 换算；论文归档仍使用其原单位约定。'),
    t('Actual Celsius uses Kelvin minus 273.15; archived manuscript labels used Kelvin minus 273.','实际摄氏温度采用 K 减 273.15；论文归档标签采用 K 减 273。'),
    t('The archived 330 °C / 10 m inventory offset is retained in the source record, not fitted away.','归档 330 °C / 10 m 的清单偏移保留于来源记录，未通过拟合抹除。'),
    t('Dense-grid cells are surrogate predictions. STD energy is reconstructed from the native HR boundary, not a separate fresh STD run.','密集网格为代理模型预测。STD 能耗由原生 HR 边界重构，不代表另一次新的 STD 运行。')];
  q('#limitations').innerHTML=limitations.map(item=>`<li>${esc(item)}</li>`).join('');
  q('#failure-note').innerHTML=`${analysis.historical_failed_attempts.length} ${t('historical failed attempts and their retry status remain in the export. Native model SHA-256:','次历史失败尝试及其重试状态保留在导出数据中。原生模型 SHA-256：')} <span data-no-i18n>${esc(analysis.fresh_runs[0]?.source_sha256||'unavailable')}</span>`;
  renderIntegrity(labels);
}
function renderIntegrity(labels){
  const integrity=analysis.validation_integrity,coverage=analysis.validation_coverage;
  const available=Boolean(integrity&&coverage);q('#integrity-details').hidden=!available;q('#integrity-details').closest('.diagnostics-panel').hidden=!available;if(!available)return;
  const status=integrity.passed?t('Source and frozen-training checks passed.','来源与固定训练数据检查通过。'):t('Source or frozen-training checks failed. Predictions are disabled.','来源或固定训练数据检查未通过，预测已停用。');
  const pair=(scope,key)=>coverage[scope]?.metrics?.[key]?`${coverage[scope].metrics[key].valid_pairs} / ${coverage[scope].metrics[key].expected}`:'—';
  q('#integrity-summary').innerHTML=`<p>${status} ${t('These are artifact consistency checks, not physical validation. Validation metrics require every expected pair; invalid pairs are retained as diagnostics and disable release.','这些检查仅验证文件与数据一致性，不代表物理验证。校验指标要求全部预期数据对完整；无效数据对保留为诊断，并停止发布预测。')}</p>${integrity.errors.length?`<p data-no-i18n>${integrity.errors.map(esc).join('<br>')}</p>`:''}<div class="table-scroll" tabindex="0"><table><thead><tr><th>${t('Response','响应指标')}</th><th>${t('Holdout valid / expected','留出集有效 / 预期')}</th><th>${t('Verification valid / expected','复核点有效 / 预期')}</th></tr></thead><tbody>${Object.entries(labels).map(([key,label])=>`<tr><td>${esc(label)}</td><td>${pair('holdout',key)}</td><td>${pair('fresh',key)}</td></tr>`).join('')}</tbody></table></div><p class="panel-foot">${t('Training coordinates, normalized response labels, fitted kernel metadata and reference-file hash are checked before exporting predictions.','导出预测前检查训练坐标、归一化响应标签、拟合核函数元数据和参考文件哈希。')}</p><span class="source-hash" data-no-i18n>Estimator SHA-256: ${esc(integrity.estimator_sha256)}<br>Reference CSV SHA-256: ${esc(integrity.reference_sha256)}<br>Coefficients SHA-256: ${esc(integrity.coefficients_sha256)}</span>`;
}
function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function inspect(tValue,lValue,scenario){q('#predict-temperature').value=tValue;q('#predict-length').value=lValue;q('#predict-scenario').value=scenario;renderPrediction();showSection('predict');}
q('#prediction-form').addEventListener('submit',e=>{e.preventDefault();renderPrediction();});
for(const input of q('#prediction-form').querySelectorAll('input'))input.addEventListener('input',clearPrediction);
q('#predict-scenario').addEventListener('change',clearPrediction);
for(const button of document.querySelectorAll('[data-section]'))button.addEventListener('click',()=>showSection(button.dataset.section));
q('#next-robust').addEventListener('click',()=>{q('#robust-scenario').value=currentScenario;selectedCandidate='';if(current){const match=analysis.robustness.scenarios[currentScenario].find(row=>conditionKey(row.temperature_C,row.length_m)===conditionKey(current.temperature_C,current.length_m));if(match)selectedCandidate=conditionKey(match.temperature_C,match.length_m);}renderRobustness();showSection('robust');});
q('#next-evidence').addEventListener('click',()=>showSection('evidence'));
q('#trend-axis').addEventListener('change',renderTrend);q('#trend-metric').addEventListener('change',renderTrend);
q('#robust-scenario').addEventListener('change',()=>{selectedCandidate='';renderRobustness();});q('#robust-order').addEventListener('change',renderRobustness);
q('#robust-candidate').addEventListener('change',renderCandidateRanges);
q('#inspect-candidate').addEventListener('click',()=>{const row=analysis.robustness.scenarios[q('#robust-scenario').value].find(r=>conditionKey(r.temperature_C,r.length_m)===q('#robust-candidate').value);if(row)inspect(row.temperature_C,row.length_m,q('#robust-scenario').value);});
q('#robust-body').addEventListener('click',e=>{const button=e.target.closest('[data-inspect]');if(button){const [tv,lv,s]=button.dataset.inspect.split(',');inspect(tv,lv,s);}});
q('#download-analysis').addEventListener('click',()=>{if(analysis)download('htl-pipeline-results.json',analysis);});
q('#download-prediction').addEventListener('click',()=>{if(!current)return;download('htl-selected-prediction.json',{version:1,kind:'frozen_reference_GP_prediction',input:{temperature_C:current.temperature_C,length_m:current.length_m,scenario:currentScenario},basis:analysis.basis,prediction:current,climate_contributions:currentContributions.map(({id,value})=>({id,value,unit:'kg CO2-eq/kg target'})),response_slice:currentSlice,observation_sources:observations.sources,reference_sha256:analysis.training.reference_sha256,limitations:analysis.limitations});});
q('#download-plan').addEventListener('click',()=>{if(!current)return;const tv=current.temperature_C,lv=current.length_m;download('htl-scan-plan.json',{version:1,model:'reference HTL HR model',units:{temperature_C:'actual degrees Celsius',length_m:'m'},points:[{temperature_C:tv,length_m:lv},{temperature_C:tv<=349?tv+1:tv-1,length_m:lv},{temperature_C:tv,length_m:lv<=19.5?lv+.5:lv-.5}]});});
window.addEventListener('languagechange',()=>{
  document.title=t('Prediction & Robustness · Process Studio','预测与鲁棒性 · Process Studio');
  refreshReferenceContext();if(!analysis)return;
  renderAccountingBasis();renderEvidence();renderRobustness();if(current)renderPrediction(false);else if(inputsDirty)q('#prediction-error').textContent=t('Inputs changed. Select Show prediction to refresh all results and exports.','输入已更改。点击“生成预测”更新全部结果与导出。');updateActions();
});
async function initialize(){
  mountLanguage(q('#pipeline-language'));
  q('#pipeline-status').removeAttribute('data-i18n-en');q('#pipeline-status').removeAttribute('data-i18n-zh');
  t('Prediction & Robustness · Process Studio','预测与鲁棒性 · Process Studio');translatePage();refreshReferenceContext();updateActions();
  try{
    const responses=await Promise.all([fetch('data/pipeline.json'),fetch('data/pipeline-observations.json').catch(()=>null)]);
    if(!responses[0].ok)throw new Error(`HTTP ${responses[0].status}`);
    analysis=await responses[0].json();
    if(responses[1]?.ok){try{observations=await responses[1].json();observationsAvailable=Array.isArray(observations.rows);if(!observationsAvailable)observations={rows:[],sources:[]};}catch{observations={rows:[],sources:[]};}}
    q('#pipeline-status').textContent=analysis.prediction_enabled?t('Archived HTL reference GP · Separate from the 17-case pilot · Fixed-background climate accounting','旧版 HTL 参考 GP · 与 17 工况试运行模型独立 · 固定背景气候影响核算'):t('Reference-model checks are incomplete or failed. Predictions are disabled; inspect the evidence.','参考模型检查未完成或未通过。预测已停用，请查看计算依据。');
    if(params.has('temperature'))q('#predict-temperature').value=params.get('temperature');
    if(params.has('length'))q('#predict-length').value=params.get('length');
    if(['STD','HR'].includes(params.get('scenario')))q('#predict-scenario').value=params.get('scenario');
    renderAccountingBasis();renderEvidence();renderRobustness();renderPrediction(false);q('#download-analysis').disabled=false;
    showSection(analysis.prediction_enabled?(location.hash.slice(1)||'predict'):'evidence',false);updateActions();translatePage();
  }catch(error){q('#pipeline-error').hidden=false;q('#pipeline-error').textContent=`${t('Analysis could not be loaded','分析加载失败')}: ${error.message}`;q('#pipeline-status').textContent=t('No prediction is available. Reload after the analysis file is restored.','暂无可用预测，请在分析文件恢复后重新加载。');updateActions();}
}
installChartExports();
initialize();
