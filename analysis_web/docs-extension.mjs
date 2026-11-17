// A frozen evidence object is supplied only after the v2 release is reviewed.
// Null renders no placeholder or uncompleted result in the public documentation.
const groups=[
  ['legacy_holdout_3',3,'Legacy holdout','历史留出'],
  ['legacy_verification_2',2,'Legacy verification','历史复核'],
  ['local_verification_8',8,'Local verification','局部复核'],
  ['prospective_verification_4',4,'Fresh prospective verification','全新前瞻复核']
];
const responses=[
  ['purchased_energy_kWh_kg','Purchased energy','购入能耗','kWh/kg',.01],
  ['yield_fraction','Target/feed yield','目标产物/进料产率','1',.001],
  ['impact:Climate change','Climate impact','气候影响','kg CO2-eq/kg',.01]
];
const select=(zh,en,cn)=>zh?cn:en;
const percent=value=>Number.isFinite(value)?`${(100*value).toFixed(6)}%`:'—';
const number=value=>Number.isFinite(value)?Number(value.toPrecision(7)).toString():'—';
function requireEvidence(condition,message){if(!condition)throw new Error(`Extension documentation: ${message}`);}

export function extensionSections(evidence,zh=false){
  if(evidence===null||evidence===undefined)return '';
  const {summary,cohort_evaluation:grouped,local_comparison:local}=evidence;
  requireEvidence(summary?.version==='v2-extension'&&summary.unique_native_cases===37&&summary.accepted_unique_cases===37&&summary.native_runs_retained===38,'complete native counts required');
  requireEvidence(summary.counts?.training===20&&summary.counts?.holdout===3&&summary.counts?.verification===14,'frozen split counts required');
  requireEvidence(typeof summary.prediction_enabled==='boolean'&&summary.validation_passed===summary.prediction_enabled&&summary.exploratory===!summary.prediction_enabled,'consistent prediction status required');
  requireEvidence(summary.fit_attempts===1&&summary.criteria_changed===false&&summary.original_splits_changed===false&&summary.old_files_unchanged===true&&summary.physical_validation===false,'one extension and unchanged scope required');
  requireEvidence(grouped?.model_sha256===summary.model_sha256&&grouped.prediction_enabled===summary.prediction_enabled,'grouped report identity required');
  requireEvidence(local?.new_eight?.expected===8&&local.new_eight.valid_pairs===8&&local.new_eight.complete===true&&local.model_refitted===false&&local.model_qualification_changed===false,'frozen-v1 local evidence required');
  requireEvidence(typeof local.model_sha256==='string'&&local.model_sha256===summary.baseline_model_sha256,'original v1 identity required');
  requireEvidence(local.center_repeat?.original_point_id==='case-008'&&Object.values(local.center_repeat.metrics||{}).length===3&&Object.values(local.center_repeat.metrics).every(metric=>metric.original===metric.repeated&&metric.absolute_difference===0),'separate center-repeat evidence required');
  for(const [key,count] of groups){
    const group=grouped.cohorts?.[key];
    requireEvidence(group?.expected===count&&group.prospectively_reserved_for_v2===(key==='prospective_verification_4'),'separate fresh/legacy cohorts required');
    for(const [response,,,unit,floor] of responses){
      const metric=group.metrics?.[response];
      requireEvidence(metric?.unit===unit&&metric.expected===count&&metric.criterion===.05&&metric.relative_floor===floor,'response units/counts/5% criterion required');
      requireEvidence(metric.complete===false||[metric.mae,metric.rmse,metric.max_relative_error].every(value=>Number.isFinite(value)&&value>=0),'complete finite metrics required');
    }
  }
  requireEvidence(responses.every(([key,,,unit])=>local.new_eight.metrics?.[key]?.unit===unit&&Number.isFinite(local.new_eight.metrics[key].max_relative_error)),'complete local response values required');
  const localErrors=responses.map(([key])=>percent(local.new_eight.metrics[key].max_relative_error));
  const localText=select(zh,
    `Nine copied-model runs checked the 328/330/332 °C × 12.25/12.5/12.75 m neighborhood. Eight coordinates were new. Against the frozen v1 model, their maximum relative errors were <strong>${localErrors[0]} for purchased energy, ${localErrors[1]} for target/feed yield, and ${localErrors[2]} for climate impact</strong>. The 330 °C / 12.5 m center repeated original holdout <code>case-008</code>; its three native metrics matched the earlier run at exported precision. It is not a ninth new location, and no repeatability acceptance limit was preregistered.`,
    `在 328/330/332 °C × 12.25/12.5/12.75 m 邻域完成了 9 次模型副本运行，其中 8 个坐标此前未运行。与冻结 v1 相比，最大相对误差分别为<strong>购入能耗 ${localErrors[0]}、目标产物/进料产率 ${localErrors[1]}、气候影响 ${localErrors[2]}</strong>。330 °C / 12.5 m 中心点重复原留出工况 <code>case-008</code>，三项原生指标在导出精度下与此前运行一致。它不计作第 9 个新增坐标，也未预先设定重复性验收限。`);
  const status=summary.prediction_enabled
    ?select(zh,'The frozen v2 model met its declared simulator-error checks; ordinary prediction is enabled within its declared training support.','冻结 v2 模型通过声明的仿真误差检查，可在声明的训练支持域内进行常规预测。')
    :select(zh,'The frozen v2 model did not meet all declared simulator-error checks. Ordinary prediction remains disabled; prediction and finite-scenario files are exploratory.','冻结 v2 模型未通过全部声明的仿真误差检查。常规预测仍禁用，预测与有限情景文件保留探索性标记。');
  const rows=groups.flatMap(([key,count,en,cn])=>responses.map(([response,labelEn,labelZh,unit])=>{
    const metric=grouped.cohorts[key].metrics[response];
    const state=!metric.complete?select(zh,'Incomplete','不完整'):metric.passed?select(zh,'Within 5%','不超过 5%'):select(zh,'Above 5%','超过 5%');
    return `<tr><td>${select(zh,en,cn)} · ${count}</td><td>${select(zh,labelEn,labelZh)}<br><small>${unit}</small></td><td>${number(metric.mae)}</td><td>${number(metric.rmse)}</td><td>${percent(metric.max_relative_error)}</td><td>${state}</td></tr>`;
  })).join('');
  return [
    `<h2 id="pilot-local">${select(zh,'A local check of v1','v1 的局部复核')}</h2><p>${localText}</p>`,
    `<p>${select(zh,'This check did not refit or qualify v1. The original failed verification and disabled ordinary-prediction status remain. Local agreement does not validate global candidate ranks, probabilities, background LCA or physical reliability.','局部复核没有重新拟合或使 v1 合格；原复核失败与常规预测禁用状态继续保留。局部吻合不能证明全局候选排序、概率、背景 LCA 或物理可靠性。')}</p>`,
    `<h2 id="pilot-v2">${select(zh,'One adaptive extension','一次自适应扩点')}</h2>`,
    `<p>${select(zh,'V2 retains <strong>37 unique native coordinates: 20 training, 3 legacy holdout and 14 verification</strong>. The verification group contains 2 original, 8 local and <strong>4 fresh prospective locations</strong>, reported separately below. The original 17 runs, local 9 runs and extension 12 runs retain 38 execution records; the repeated center appears only once in the merged dataset. All 37 unique cases passed the declared execution and accounting checks.','v2 保留 <strong>37 个唯一原生坐标：20 个训练点、3 个历史留出点和 14 个复核点</strong>。复核组由原 2 点、局部 8 点和 <strong>4 个全新前瞻复核点</strong>组成，下方分别报告。原 17 次、局部 9 次与扩点 12 次共保留 38 条运行记录，重复中心在合并数据中只计一次。37 个唯一工况均通过声明的运行与核算检查。')}</p>`,
    `<p><strong>${status}</strong></p>`,
    `<p>${select(zh,'This was one adaptive extension after reviewing v1, with one frozen fit using only the original 12 plus new 8 training points. Previously known holdout, verification and local groups are development evidence for v2, not fresh independent tests. The 5% maximum-relative-error limits remain unchanged. The denominator floors are 0.01 kWh/kg for energy, 0.001 for target/feed yield and 0.01 kg CO2-eq/kg for climate impact. These are prediction-error checks, not operating-performance thresholds.','这是审阅 v1 后的一次自适应扩点，只执行一次冻结拟合，训练仅使用原 12 点与新增 8 点。已知的留出、复核和局部组属于 v2 的开发依据，不能称为全新独立验证。最大相对误差上限仍为 5%；能耗、目标产物/进料产率和气候影响的分母下限分别为 0.01 kWh/kg、0.001 和 0.01 kg CO2-eq/kg。这是预测误差检查，不是工况性能门槛。')}</p>`,
    `<details><summary>${select(zh,'Errors by evidence group','查看各证据组的误差')}</summary><p>${select(zh,'MAE and RMSE use each response’s displayed unit; maximum relative error is a percentage. The fresh-four group is shown separately. Passing one group cannot hide a failure in another. The local-eight errors here use v2; the preceding local check used frozen v1.','MAE 与 RMSE 使用响应旁列出的单位，最大相对误差以百分数表示。全新 4 点单列；某组通过不能掩盖另一组失败。此表的局部 8 点误差针对 v2，上文局部复核针对冻结 v1。')}</p><div class="table-wrap" tabindex="0" role="region" aria-label="${select(zh,'V2 errors by evidence group','v2 各证据组误差')}"><table><thead><tr><th>${select(zh,'Group · points','分组 · 点数')}</th><th>${select(zh,'Response / unit','响应 / 单位')}</th><th>MAE</th><th>RMSE</th><th>${select(zh,'Maximum relative error','最大相对误差')}</th><th>${select(zh,'Error check','误差检查')}</th></tr></thead><tbody>${rows}</tbody></table></div></details>`,
    `<p>${select(zh,'Energy and climate impact remain per kg outlet target, and yield remains the target/feed mass ratio. Complete native checks or finite-scenario coverage do not establish physical validation; scenario shares are not probabilities. The original v1 evidence remains available.','能耗与气候影响仍按每 kg 出口目标产物表示，产率仍为目标产物与进料的质量比。原生检查或有限情景覆盖完整不代表物理验证，情景占比不是概率；原 v1 证据继续保留。')} <a href="models.html">${select(zh,'Open local models','打开本地模型')}</a> · <a href="data/generic-htl-extension/README.md">${select(zh,'V2 package notes','v2 数据包说明')}</a> · <a href="data/generic-htl-extension/index.json" download>${select(zh,'File manifest','文件清单')}</a></p>`
  ].join('');
}
