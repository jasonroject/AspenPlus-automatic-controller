import {t,translatePage} from './i18n.mjs';
import {escapeHTML as esc} from './site.mjs';
import {inspectArtifact,artifactSeries,finiteDomain,domainFraction,domainTick,recordPage} from './model-artifact-data.mjs';
import {robustnessViewHTML} from './robustness-artifact-view.mjs';
const number=value=>!Number.isFinite(value)?'—':value!==0&&(Math.abs(value)>=1e7||Math.abs(value)<1e-5)?value.toExponential(5):value.toLocaleString('en-US',{maximumSignificantDigits:7});
const percent=value=>!Number.isFinite(value)?'—':Number.isFinite(value*100)?`${number(value*100)}%`:`${number(value)} × 100%`;
const numericText=value=>Number.isFinite(value)?String(value):'';
const label=spec=>`${spec.id} · ${spec.unit||'1'}`;
function accountingBasisHTML(a){
  if(!a.basis||!Object.values(a.basis).some(value=>value?.trim()))return `<p class="panel-foot">${t('Accounting basis: inspect the matching profile or dataset.','核算基准请查看匹配的配置或数据集。')}</p>`;
  const fields=[['functional_unit','Functional unit','功能单位'],['boundary','System boundary','系统边界'],['allocation_method','Allocation','分配方式'],['enthalpy_basis','Enthalpy basis','焓基准']];
  return `<details data-artifact-basis><summary>${t('Accounting basis','核算基准')}</summary><dl class="model-list">${fields.map(([key,en,zh])=>`<dt>${t(en,zh)}</dt><dd data-no-i18n>${esc(a.basis[key]?.trim()||t('Not declared','未声明'))}</dd>`).join('')}</dl><p class="panel-foot">${t('These declarations are supplied with the dataset. The units alone do not identify the target product or system boundary.','以上声明来自数据集，仅凭单位无法确定目标产品或系统边界。')}</p></details>`;
}
export function artifactExamplePath(value){
  if(typeof value!=='string'||!/^data\/generic-htl-pilot\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(value)||value.includes('..'))throw new Error('Use a reviewed JSON example in data/generic-htl-pilot/');
  return value;
}
const issueTranslations={
  'Producer did not mark this record as available.':'导出工具未声明该记录可用。',
  'Unknown observation group.':'未知的观测分组。',
  'One or more exported audit gates are not true.':'至少一项导出的审核门禁未通过。',
  'Missing finite declared inputs.':'缺少有限数值的已声明输入。',
  'Missing finite declared outputs.':'缺少有限数值的已声明输出。',
  'This group is not held-out or verification evidence.':'该分组不是留出或复核证据。',
  'Producer did not mark this evaluation as available.':'导出工具未声明该校验记录可用。',
  'Missing finite supplied or predicted outputs.':'缺少有限数值的提供值或预测值。'
};
const recordNote=row=>[row.error,...row.errors,...row.displayIssues.map(issue=>t(issue,issueTranslations[issue])),row.warnings.length?`${t('Warnings','警告')}: ${row.warnings.join('; ')}`:'',row.source||row.source_id].filter(Boolean).join('; ');
export function artifactScatter(points,xLabel,yLabel,title,parity=false){
  if(!points.length)return `<p class="chart-empty">${t('No complete eligible records to plot. Inspect the retained records below.','没有可绘制的完整合格记录，请查看下方保留的记录。')}</p>`;
  const w=560,h=330,left=70,top=25,pw=460,ph=235;
  const domain=parity?finiteDomain(points.flatMap(row=>[row.x,row.y])):null,dx=domain||finiteDomain(points.map(row=>row.x)),dy=domain||finiteDomain(points.map(row=>row.y));
  const x=value=>left+domainFraction(value,dx)*pw,y=value=>top+ph-domainFraction(value,dy)*ph;
  let body='';
  for(let i=0;i<5;i++){
    const vx=domainTick(dx,i/4),vy=domainTick(dy,i/4),xx=left+pw*i/4,yy=top+ph-ph*i/4;
    body+=`<line x1="${left}" x2="${left+pw}" y1="${yy}" y2="${yy}" stroke="#e8e8e4"/><text x="${left-10}" y="${yy+4}" text-anchor="end">${esc(number(vy))}</text><text x="${xx}" y="${top+ph+23}" text-anchor="middle">${esc(number(vx))}</text>`;
  }
  if(parity)body+=`<line x1="${left}" x2="${left+pw}" y1="${top+ph}" y2="${top}" stroke="#aaa" stroke-dasharray="4 4"/>`;
  body+=points.map(row=>`<circle cx="${x(row.x)}" cy="${y(row.y)}" r="4" fill="${row.split==='training'?'#333':'white'}" stroke="#333" stroke-width="1.5"><title>${esc(row.id)} · ${esc(row.split)}\n${esc(xLabel)}: ${esc(String(row.x))}\n${esc(yLabel)}: ${esc(String(row.y))}</title></circle>`).join('');
  return `<svg class="model-artifact-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" data-no-i18n><title>${esc(title)}</title>${body}<text x="${left}" y="13">${esc(yLabel)}</text><text x="${left+pw/2}" y="${h-12}" text-anchor="middle">${esc(xLabel)}</text></svg>`;
}
function pagination(page,kind){return `<div class="model-button-row"><button class="button secondary" data-artifact-page="${kind}" data-page-direction="-1" ${page.page===0?'disabled':''}>${t('Previous','上一页')}</button><span>${page.start}–${page.end} / ${page.total}</span><button class="button secondary" data-artifact-page="${kind}" data-page-direction="1" ${page.page===page.count-1?'disabled':''}>${t('Next','下一页')}</button></div>`;}
export function modelArtifactPanel(){return `<details class="model-artifacts" id="model-artifacts"><summary>${t('Explore models, predictions and scenarios','查看模型、预测与情景结果')}</summary><p>${t('Import a local surrogate bundle, prediction result or scenario analysis to inspect coverage, held-out comparisons and retained failures.','导入本地代理模型包、预测或情景分析结果，查看覆盖、留出对照和保留的失败记录。')}</p><div class="model-example-files"><p><strong>${t('HTL pilot · exploratory model','HTL 示例 · 探索性模型')}</strong></p><div class="model-button-row"><button type="button" class="button secondary" data-artifact-example="data/generic-htl-pilot/model.bundle.json">${t('Model checks','模型校验')}</button><button type="button" class="button secondary" data-artifact-example="data/generic-htl-pilot/predictions.json">${t('Mean predictions','均值预测')}</button><button type="button" class="button secondary" data-artifact-example="data/generic-htl-pilot/robustness.json">${t('Scenario ranges','情景范围')}</button></div><p class="panel-foot">${t('Its independent verification errors exceeded the prespecified 5% limit. These predictions and scenarios are retained for inspection, with regular prediction disabled.','其独立复核误差超过预先规定的 5% 上限。预测与情景结果保留供检查，常规预测未启用。')}</p></div><label class="model-upload">${t('Choose model results JSON','选择模型结果 JSON')}<input id="artifact-file" type="file" accept=".json"></label><p id="artifact-message" role="status" hidden></p><div id="artifact-view"></div><details><summary>${t('Create these files locally','在本地生成这些文件')}</summary><pre class="model-code" data-no-i18n>python -m process_pipeline.surrogate fit dataset.json --config criteria.json --output model.bundle.json
python -m process_pipeline.surrogate evaluate model.bundle.json --output model-evaluation.json
python -m process_pipeline.surrogate predict model.bundle.json --points queries.json --output predictions.json
python -m process_pipeline.robustness model.bundle.json --config scenarios.json --output robustness.json</pre><p>${t('The local tool checks hashes, frozen validation groups, explicit error criteria and the actual training domain. This viewer reads exported results; it does not fit or execute a model.','本地工具检查哈希、固定校验分组、明确的误差标准和实际训练域。本页面读取导出结果，不拟合或运行模型。')}</p></details></details>`;}
export function artifactViewHTML(a,state){
  if(a.robustness)return accountingBasisHTML(a)+robustnessViewHTML(a,state);
  state.input=a.inputs.some(x=>x.id===state.input)?state.input:a.inputs[0].id;
  state.response=a.responses.some(x=>x.id===state.response)?state.response:a.responses[0].id;
  const input=a.inputs.find(x=>x.id===state.input),response=a.responses.find(x=>x.id===state.response),series=artifactSeries(a,state.input,state.response),page=recordPage(a.rows,state.page);
  state.page=page.page;
  const status=a.bundle?(a.declaredEnabled?t('Producer declares prediction enabled (unverified)','导出工具声明预测已启用（未经独立验证）'):t('Exploratory model / prediction disabled','探索模型 / 常规预测未启用')):t('Exported prediction requests','已导出的预测请求');
  return `<div class="model-artifact-summary"><span><small>${t('Profile','模型配置')}</small><strong data-no-i18n>${esc(a.profileId)}</strong></span><span><small>${t('Displayable records','可绘制记录')}</small><strong>${a.validCount} / ${a.rows.length}</strong></span><span><small>${t('Unavailable records','不可绘制记录')}</small><strong>${a.failedCount}</strong></span></div>
    <p class="model-help"><strong>${status}</strong><br>${t('Declared evidence','声明的证据类型')}: <span data-no-i18n>${esc(a.evidence)}</span>. ${t('This is an exported claim, not independent verification of a native Aspen run or physical performance.','这是导出文件中的声明，不是对原生 Aspen 运行或物理性能的独立验证。')}</p>
    ${accountingBasisHTML(a)}
    ${a.warningCount?`<p class="panel-foot">${a.warningCount} ${t('records include exported warnings. Open records and sources below to inspect them, including warnings on otherwise available records.','条记录包含导出的警告。请展开下方记录与来源查看，包括仍可绘制记录上的警告。')}</p>`:''}
    ${a.trainingWarnings.length?`<details data-artifact-training><summary>${t('Fit warnings','拟合警告')} · ${a.trainingWarnings.length}</summary><p class="panel-foot">${t('Exported optimizer diagnostics are separate from native-run evidence and validation errors.','导出的优化器诊断与原生运行证据、校验误差分别保留。')}</p><ul class="model-list">${a.trainingWarnings.map(row=>`<li data-no-i18n>${esc(row.response)}: ${esc(row.message)}</li>`).join('')}</ul></details>`:''}
    <div class="import-actions"><label>${t('Input axis','输入坐标')}<select id="artifact-input">${a.inputs.map(spec=>`<option value="${esc(spec.id)}" ${spec.id===state.input?'selected':''}>${esc(label(spec))}</option>`).join('')}</select></label><label>${t('Response','响应指标')}<select id="artifact-response">${a.responses.map(spec=>`<option value="${esc(spec.id)}" ${spec.id===state.response?'selected':''}>${esc(label(spec))}</option>`).join('')}</select></label></div>
    <div class="model-artifact-plots"><section><h3>${t('Input and response coverage','输入与响应覆盖')}</h3><div class="model-chart-scroll">${artifactScatter(series.observations,label(input),label(response),t('Input and response coverage','输入与响应覆盖'))}</div><p class="panel-foot">${t('Each point is an exported record. Other inputs may also vary; this is not a controlled response curve. Filled points are training records; hollow points are other declared groups.','每个点对应一条导出记录，其他输入也可能变化，这不是固定其余变量后的响应曲线。实心点表示训练记录，空心点表示其他声明分组。')}</p></section>${a.bundle?`<section><h3>${t('Held-out predictions vs supplied outputs','留出预测与提供的输出对照')}</h3><div class="model-chart-scroll">${artifactScatter(series.pairs,t('Supplied output','提供的输出')+' · '+response.unit,t('Predicted','预测')+' · '+response.unit,t('Held-out comparison','留出对照'),true)}</div><p class="panel-foot">${t('The dashed line is equality. Only complete held-out or verification pairs are drawn; all other records remain below. Values are read from the exported evaluation.','虚线表示相等。仅绘制完整的留出或复核数据对，其余记录均保留在下方。数值读取自导出的校验结果。')}</p></section>`:''}</div>
    ${a.bundle?validationHTML(a,response,state):''}
    <details data-artifact-records><summary>${t('Inspect records and sources','检查记录与来源')}</summary><div class="table-scroll"><table><thead><tr><th>ID / ${t('Group','分组')}</th><th>${esc(label(input))}</th><th>${esc(label(response))}</th><th>${t('Status / source','状态 / 来源')}</th></tr></thead><tbody>${page.rows.map(row=>`<tr><th data-no-i18n>${esc(row.id)}<br>${esc(row.split||'prediction')}</th><td title="${esc(numericText(row.inputs?.[state.input]))}">${number(row.inputs?.[state.input])}</td><td title="${esc(numericText(row.outputs?.[state.response]))}">${number(row.outputs?.[state.response])}</td><td>${row.displayValid?t('Available','可用'):t('Unavailable','不可用')}<br><span data-no-i18n>${esc(recordNote(row))}</span></td></tr>`).join('')}</tbody></table></div>${pagination(page,'rows')}</details>
    <p class="model-readout" data-no-i18n>Model SHA-256: ${esc(a.modelHash)}</p><p class="panel-foot">${t('The local Python tool verifies model digests. This browser view checks display fields and preserves the declared hashes; it does not independently recompute or attest them.','模型摘要由本地 Python 工具验证。浏览器检查展示字段并保留声明的哈希，不独立重算或认证这些哈希。')}</p>`;
}
function validationHTML(a,response,state){
  const page=recordPage(a.pairs,state.pairPage);state.pairPage=page.page;
  const rule=a.criteria?.[response.id];
  return `<details data-artifact-validation><summary>${t('Validation coverage and errors','校验覆盖与误差')}</summary><p>${t('Eligible evaluation pairs','可绘制的校验数据对')}: ${a.validPairCount} / ${a.pairs.length} · ${t('Unavailable or ineligible','不可用或不符合分组要求')}: ${a.failedPairCount}</p><div class="table-scroll"><table><thead><tr><th>${t('Group','分组')}</th><th>${t('Valid / expected','有效 / 预期')}</th><th>MAE · ${esc(response.unit)}</th><th>RMSE · ${esc(response.unit)}</th><th>${t('Maximum relative error','最大相对误差')}</th><th>${t('Declared relative-error limit','声明的相对误差上限')}</th><th>${t('Declared check','声明的检查结果')}</th></tr></thead><tbody>${Object.entries(a.validation.splits).map(([split,row])=>{const m=row.metrics[response.id];return `<tr><th data-no-i18n>${esc(split)}</th><td>${row.valid} / ${row.expected}</td><td>${number(m?.mae)}</td><td>${number(m?.rmse)}</td><td title="${esc(numericText(m?.max_relative_error))}">${percent(m?.max_relative_error)}</td><td title="${esc(numericText(rule?.max_relative_error))}">${percent(rule?.max_relative_error)}</td><td>${m?.passed===true?t('Passed','通过'):t('Not passed / unavailable','未通过 / 不可用')}</td></tr>`;}).join('')}</tbody></table></div><p class="panel-foot">${t('Relative error: |prediction − supplied| / max(|supplied|, floor). Declared floor','相对误差：|预测值 − 提供值| / max(|提供值|, 分母下限)。声明的分母下限')}: <span data-no-i18n>${number(rule?.relative_floor)} ${Number.isFinite(rule?.relative_floor)?esc(response.unit):''}</span>. ${t('Checks are read from the exported evaluation.','检查结果读取自导出的校验文件。')}</p><p data-no-i18n>${esc((a.validation.reasons||[]).join('; '))}</p>
    <details data-artifact-pairs><summary>${t('Supplied and predicted values','提供值与预测值')}</summary><div class="table-scroll"><table><thead><tr><th>ID / ${t('Group','分组')}</th><th>${t('Supplied','提供值')} · ${esc(response.unit)}</th><th>${t('Predicted','预测')} · ${esc(response.unit)}</th><th>${t('Status / error / source','状态 / 错误 / 来源')}</th></tr></thead><tbody>${page.rows.map(row=>`<tr><th data-no-i18n>${esc(row.id)}<br>${esc(row.split||'unspecified')}</th><td title="${esc(numericText(row.actual?.[response.id]))}">${number(row.actual?.[response.id])}</td><td title="${esc(numericText(row.predicted?.[response.id]))}">${number(row.predicted?.[response.id])}</td><td>${row.displayValid?t('Available','可用'):t('Unavailable','不可用')}<br><span data-no-i18n>${esc(recordNote(row))}</span></td></tr>`).join('')}</tbody></table></div>${pagination(page,'pairs')}</details></details>`;
}
export function mountModelArtifacts(container,state={artifact:null,input:null,response:null,page:0,pairPage:0}){
  const query=selector=>container.querySelector(selector);let active=true,revision=0;
  const detailKeys=['basis','validation','pairs','records','training','robust-summary','robust-queries','robust-methods','robust-lineage'];
  const languageTarget=typeof window==='undefined'?null:window;
  function render(){
    const view=query('#artifact-view');if(!state.artifact){view.replaceChildren();return;}
    const disclosures=detailKeys.map(key=>[key,query(`[data-artifact-${key}]`)]).filter(([,element])=>element).map(([key,element])=>[key,element.open]);
    const focused=typeof document==='undefined'?null:document.activeElement;let focusSelector=null;
    if(focused&&view.contains?.(focused)){
      if(['artifact-input','artifact-response','artifact-preference','artifact-robust-filter'].includes(focused.id))focusSelector=`#${focused.id}`;
      else if(['rows','pairs','robust'].includes(focused.dataset?.artifactPage)&&['-1','1'].includes(focused.dataset?.pageDirection))focusSelector=`[data-artifact-page="${focused.dataset.artifactPage}"][data-page-direction="${focused.dataset.pageDirection}"]`;
      else if(focused.tagName==='SUMMARY'){const key=detailKeys.find(key=>focused.closest?.(`[data-artifact-${key}]`));if(key)focusSelector=`[data-artifact-${key}] > summary`;}
    }
    view.innerHTML=artifactViewHTML(state.artifact,state);
    for(const [key,open] of disclosures){const detail=query(`[data-artifact-${key}]`);if(detail)detail.open=open;}
    translatePage(container);
    if(focusSelector)query(focusSelector)?.focus?.({preventScroll:true});
  }
  function clear(){state.artifact=null;state.page=0;state.pairPage=0;state.robustPage=0;state.robustFilter='all';render();}
  async function readArtifact(read){
    const ticket=++revision;clear();const message=query('#artifact-message');message.hidden=false;message.textContent=t('Reading results…','正在读取结果…');
    try{
      const text=await read();if(!active||ticket!==revision)return;
      if(text===null){message.textContent=t('No file selected. Previous results were cleared.','未选择文件，之前的结果已清除。');return;}
      if(typeof text!=='string')throw new Error(t('The result must be JSON text.','结果必须是 JSON 文本。'));
      if(new TextEncoder().encode(text).length>20*1024*1024)throw new Error(t('Maximum file size: 20 MB','文件最大 20 MB'));
      const artifact=inspectArtifact(JSON.parse(text));state.artifact=artifact;render();
      message.textContent=artifact.robustness?t('Scenario results loaded. Choose a response metric and preference.','情景结果已加载。请选择响应指标和偏好权重。'):t('Results loaded. Choose an input and response to explore.','结果已加载。选择输入和响应指标即可查看。');
    }catch(error){if(!active||ticket!==revision)return;clear();message.textContent=error instanceof Error?error.message:String(error);}
  }
  async function change(event){
    if(event.target.id==='artifact-file'){
      await readArtifact(async()=>{
        const file=event.target.files?.[0];
        if(!file)return null;
        if(file.size>20*1024*1024)throw new Error(t('Maximum file size: 20 MB','文件最大 20 MB'));
        return file.text();
      });
    }else if(event.target.id==='artifact-input'||event.target.id==='artifact-response'){
      state[event.target.id==='artifact-input'?'input':'response']=event.target.value;render();
    }else if(event.target.id==='artifact-preference'){
      state.preference=event.target.value;render();
    }else if(event.target.id==='artifact-robust-filter'){
      state.robustFilter=event.target.value;state.robustPage=0;render();
    }
  }
  async function click(event){
    const example=event.target.closest?.('[data-artifact-example]');
    if(example?.dataset?.artifactExample!==undefined){if(example.disabled)return;await readArtifact(async()=>{
      const path=artifactExamplePath(example.dataset.artifactExample),response=await fetch(path,{cache:'no-store',credentials:'same-origin'});
      if(!response.ok)throw new Error(t('The reviewed example is unavailable. Previous results were cleared.','已审核示例暂不可用，之前的结果已清除。'));
      return response.text();
    });return;}
    const button=event.target.closest?.('[data-artifact-page]');if(!button||button.disabled||!state.artifact)return;
    const kind=button.dataset.artifactPage,direction=Number(button.dataset.pageDirection);if(!['rows','pairs','robust'].includes(kind)||![-1,1].includes(direction))return;
    const key=kind==='pairs'?'pairPage':kind==='robust'?'robustPage':'page';state[key]=(state[key]??0)+direction;render();
    query(kind==='pairs'?'[data-artifact-validation]':kind==='robust'?'[data-artifact-robust-queries]':'[data-artifact-records]').open=true;if(kind==='pairs')query('[data-artifact-pairs]').open=true;
  }
  function languageChange(){if(active)render();}
  container.addEventListener('change',change);container.addEventListener('click',click);render();
  languageTarget?.addEventListener('languagechange',languageChange);
  return()=>{active=false;revision++;container.removeEventListener('change',change);container.removeEventListener('click',click);languageTarget?.removeEventListener('languagechange',languageChange);};
}

