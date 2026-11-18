from pathlib import Path
root=Path(__file__).resolve().parents[2]
p=root/'analysis_web/universal.html'
s=p.read_text(encoding='utf-8')
s=s.replace('universal.css?v=2','universal.css?v=3').replace('universal.js?v=2','universal.js?v=3')
s=s.replace('</head>','<link rel="stylesheet" href="result-visuals.css"></head>')
s=s.replace('Save your project before leaving.','<span id="session-status">Working data is retained in this tab. Download a copy to keep it.</span>')
s=s.replace('Changes stay in browser memory. Recalculate after editing, and save your project to keep a copy.','Changes are retained in this tab. Recalculate after editing; download a project for a permanent copy.')
s=s.replace('<div id="energy-chart"></div>','')
s=s.replace('<a href="#energy-section">Energy flows ↓</a>','<a href="#visual-section">Visual analysis ↓</a><a href="#energy-section">Energy balances ↓</a>')
s=s.replace('<article class="panel" id="energy-section">','<article class="panel" id="visual-section"><div class="panel-heading"><div><span class="section-kicker">FROM INPUTS TO INSIGHT</span><h2>Read the patterns.</h2><p>Switch between impact contributions, block duties and case comparisons. Every chart uses your current calculation.</p></div></div><div id="result-visuals"></div></article>\n<article class="panel" id="energy-section">')
s=s.replace('</section><footer class="workspace-footer">','<article class="panel next-lab" id="prediction-handoff"><div><span class="section-kicker">CONTINUE YOUR RESEARCH</span><h2>From this case to operating variation.</h2><p id="handoff-description"></p><p class="panel-foot" id="handoff-scope"></p></div><a id="open-prediction" class="button primary" href="pipeline.html?from=import">Explore reference predictions →</a></article>\n</section><footer class="workspace-footer">')
p.write_text(s,encoding='utf-8')
p=root/'analysis_web/universal.js';s=p.read_text(encoding='utf-8')
s=s.replace("import {readiness,eligibleCases,resultGuidance} from './workspace-state.mjs';", "import {readiness,eligibleCases,resultGuidance} from './workspace-state.mjs';\nimport {t,mountLanguage,translatePage} from './i18n.mjs';\nimport {renderResultVisuals,clearResultVisuals} from './result-visuals.mjs';\nimport {readSession,writeSession,referenceLink} from './workspace-session.mjs';")
s=s.replace('const appliedSheets=new Set();',"const appliedSheets=new Set();\nlet referenceProject=null,restoring=true,persistTimer;\nmountLanguage(document.querySelector('.workbench-header'));\n")
s=s.replace("  $('#comparison-hint').textContent=", "  $('#comparison-hint').textContent=")
s=s.replace("${count} eligible cases. Set your priorities below, then compare. No performance threshold is imposed.`;", "${count} eligible cases. Set your priorities below, then compare. No performance threshold is imposed.`;\n  if(!restoring)schedulePersist();")
s=s.replace("function invalidate(){report=null;ranking=null;", "function invalidate(){report=null;ranking=null;clearResultVisuals($('#result-visuals'));")
s=s.replace(",'energy-chart'",'')
s=s.replace("function energyChart(blocks){", "function energyChart(blocks){")
start=s.index('function energyChart(blocks){');end=s.index('function render(){',start)
s=s[:start]+s[end:]
s=s.replace("  $('#energy-chart').innerHTML=energyChart(b.blocks);", "  renderResultVisuals($('#result-visuals'),{project,report,caseId:r.id,category:$('#rank-category').value});\n  renderHandoff();")
s=s.replace("report.results.map(r=>`<option>${esc(r.id)}</option>`)","report.results.map(r=>`<option value=\"${esc(r.id)}\">${esc(r.id)}</option>`)")
s=s.replace("report.categories.map(c=>`<option>${esc(c)}</option>`)","report.categories.map(c=>`<option value=\"${esc(c)}\">${esc(c)}</option>`)")
s=s.replace("for(const input of document.querySelectorAll('#rank-category,[id^=\"weight-\"]'))input.addEventListener('input',()=>{ranking=null;", "for(const input of document.querySelectorAll('#rank-category,[id^=\"weight-\"]'))input.addEventListener('input',()=>{if(input.id==='rank-category'&&report)renderResultVisuals($('#result-visuals'),{project,report,caseId:$('#result-case').value,category:input.value});ranking=null;")
s=s.removesuffix("sync();\n$('#message').hidden=true;\n")
s+='''
function renderHandoff(){
  const link=referenceLink(project,referenceProject);
  $('#open-prediction').href=link.href;
  $('#open-prediction').textContent=link.matches?t('Continue to HTL prediction →','继续到 HTL 预测 →'):t('Explore the HTL reference lab →','浏览 HTL 参考模型 →');
  $('#handoff-description').textContent=link.matches?t('This unchanged native export matches the HTL reference model. Open its 325 °C / 8.5 m HR condition, then compare operating variation.','这份未修改的原生导出与 HTL 参考模型一致。打开 325 °C / 8.5 m 的 HR 工况，再查看工况扰动与排名稳定性。'):t('Imported-data comparisons use the declared fuzzy supports above. The separate HTL lab explores the existing reference model.','导入数据的比较采用上方声明的模糊支持区间。独立的 HTL 分析模块用于探索已有参考模型。');
  $('#handoff-scope').textContent=t('The lab uses frozen reference predictions, not a model fitted to your import. Your applied inputs and results will be restored when you return to this tab.','预测模块读取已保存的参考模型结果，不会用本次导入数据训练模型。返回本标签页时，将恢复已应用输入和计算结果。');
}
function currentSession(){
  return {project,draft:pendingJSON?$('#project-json').value:null,activeTab,calculated:Boolean(report),caseId:$('#result-case').value,category:$('#rank-category').value,
    weights:['energy','impact','yield'].map(k=>$('#weight-'+k).value),ranking,
    sheets,applied:[...appliedSheets],sheet:$('#sheet').value,header:$('#header-row').value,transpose:$('#transpose').checked,type:$('#table-type').value,mode:$('#apply-mode').value,
    mappings:[...document.querySelectorAll('#mapping-body tr')].map(row=>({field:row.dataset.field,column:row.querySelector('select').value,constant:row.querySelector('input').value}))};
}
function persist(){
  if(restoring)return;let saved=false;try{saved=writeSession(sessionStorage,currentSession());}catch{}
  $('#session-status').textContent=saved?t('Retained in this tab. Download a copy to keep it.','已保留在本标签页。下载副本可长期保存。'):t('Tab recovery unavailable. Download your applied project; staged worksheets must be imported again.','标签页恢复不可用。请下载已应用项目；暂存工作表需重新导入。');
}
function schedulePersist(){clearTimeout(persistTimer);persistTimer=setTimeout(persist,250);}
function restore(){
  let state;try{state=readSession(sessionStorage);}catch{}
  if(!state){sync();$('#message').hidden=true;restoring=false;return;}
  try{
    project=state.project;sync();
    if(state.sheets?.length){
      sheets=state.sheets;for(const index of state.applied||[])appliedSheets.add(index);
      $('#sheet').innerHTML=sheets.map((sheet,i)=>`<option value="${i}">${esc(sheet.name)}</option>`).join('');
      $('#sheet').value=state.sheet||'0';$('#header-row').value=state.header||'1';$('#transpose').checked=Boolean(state.transpose);$('#table-type').value=state.type||'streams';$('#apply-mode').value=state.mode||'replace';$('#mapping-panel').hidden=false;mapping();
      for(const row of document.querySelectorAll('#mapping-body tr')){const mapped=state.mappings?.find(m=>m.field===row.dataset.field);if(mapped){row.querySelector('select').value=mapped.column;row.querySelector('input').value=mapped.constant;}}
    }
    if(state.weights)for(const [index,key] of ['energy','impact','yield'].entries())$('#weight-'+key).value=state.weights[index];
    if(state.calculated&&!state.draft){
      report=assess(project);$('#result-case').innerHTML=report.results.map(r=>`<option value="${esc(r.id)}">${esc(r.id)}</option>`).join('');
      $('#rank-category').innerHTML=report.categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
      if(report.results.some(r=>r.id===state.caseId))$('#result-case').value=state.caseId;
      if(report.categories.includes(state.category))$('#rank-category').value=state.category;
      render();
      if(state.ranking&&project.meta.comparable_cases)$('#rank').click();
    }
    if(state.draft){pendingJSON=true;$('#project-json').value=state.draft;$('#project-json').closest('details').open=true;}
    const tab=pendingJSON?'import':state.activeTab==='results'&&!report?'context':state.activeTab;
    showTab(['import','context','results'].includes(tab)?tab:'import',false);
    message(t('Restored this tab’s workspace. Your inputs, mappings and pending edits are retained.','已恢复本标签页的工作区，包括输入、字段映射和待应用的编辑。'));
  }catch{report=null;pendingJSON=false;activeTab='import';sync();showTab('import',false);message(t('Applied inputs restored. Review the tables and calculate again.','已恢复已应用输入，请检查数据表后重新计算。'));}
  restoring=false;updateWorkflow();
}
restore();
window.addEventListener('pagehide',persist);
document.addEventListener('input',schedulePersist);document.addEventListener('change',schedulePersist);
window.addEventListener('languagechange',()=>{if(report){render();}else updateWorkflow();translatePage();});
fetch('data/universal-htl.json').then(r=>{if(!r.ok)throw new Error('Reference unavailable');return r.json();}).then(data=>{referenceProject=data;if(report)renderHandoff();}).catch(()=>{});
'''
p.write_text(s,encoding='utf-8')
p=root/'analysis_web/universal.css';s=p.read_text(encoding='utf-8');s+='''
/* Charts and the reference-model handoff remain inside the results hierarchy. */
#visual-section,#prediction-handoff{scroll-margin-top:100px}.next-lab{display:flex;align-items:center;gap:28px;background:#f4f4f1}.next-lab>div{flex:1}.next-lab p{font-size:13px;line-height:1.8}.next-lab .button{flex-shrink:0;text-decoration:none}.workbench-header .language-switch{margin-left:0}
@media(max-width:700px){.next-lab{flex-direction:column;align-items:stretch}.next-lab .button{text-align:center}.workbench-header{gap:10px}.workbench-header .wordmark{margin-right:auto}.workbench-header>.button{margin-left:0}.workbench-header nav{order:4}.results-nav{flex-wrap:wrap}}
''';p.write_text(s,encoding='utf-8')
