import {TABLES,blankProject,suggest,parseCSV,adaptAspen,assess,rank,clean} from './universal-core.mjs';
import {readiness,eligibleCases,resultGuidance} from './workspace-state.mjs';
import {t,mountLanguage,translatePage} from './i18n.mjs';
import {renderResultVisuals,clearResultVisuals} from './result-visuals.mjs';
import {readSession,writeSession,referenceLink,validateWorkspaceShape} from './workspace-session.mjs';
import {scanPreferences} from './uncertainty-diagnostics.mjs';
import {preferenceControlsHTML,renderPreferenceScan} from './uncertainty-views.mjs';
import {readSpreadsheet} from './spreadsheet-import.mjs';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,n=4)=>Number.isFinite(v)?(v!==0&&Math.abs(v)<10**(-n)?v.toExponential(2):v.toLocaleString('en-US',{maximumFractionDigits:n})):'—';
let project=blankProject(),sheets=[],matrix=[],report=null,ranking=null,preferenceScan=null,activeTab='import',pendingJSON=false,busy=false;
const appliedSheets=new Set();
let referenceProject=null,restoring=true,persistTimer;
mountLanguage(document.querySelector('.workbench-header'));

const message=(text,error=false)=>{$('#message').hidden=false;$('#message').textContent=t(text);$('#message').dataset.kind=error?'error':'info';};
function updateWorkflow(){
  const ready=readiness(project),index=['import','context','results'].indexOf(activeTab);
  $('#workflow-count').textContent=`Step ${index+1} of 3`;
  $('#workflow-title').textContent=activeTab==='import'?'Import & map':activeTab==='context'?'Review basis':'Results & comparison';
  $('#workflow-description').textContent=pendingJSON?'Your JSON edits are not applied. Apply JSON edits in step 1 before continuing.':activeTab==='import'?(sheets.length?`${appliedSheets.size} of ${sheets.length} worksheets applied. Review each mapping, apply it, then continue to the basis.`:ready.hasCases?'Your project is loaded. Continue to review its basis and factors.':'Choose an export, or try the guided example first. Nothing is uploaded to a server.'):activeTab==='context'?'Review the checklist and calculation basis, then calculate. Missing evidence will stay visible.':'Start with the summary, inspect any issues, then explore energy, impacts and comparison.';
  for(const b of document.querySelectorAll('[data-tab]')){b.disabled=busy||(b.dataset.tab==='results'&&!report)||(pendingJSON&&b.dataset.tab!=='import');b.dataset.complete=String(b.dataset.tab==='import'&&ready.hasCases||b.dataset.tab==='context'&&Boolean(report));}
  for(const id of ['import-next','edit-context'])$('#'+id).disabled=busy||!ready.hasCases||pendingJSON;
  const unapplied=sheets.length-appliedSheets.size;
  $('#import-next').textContent=unapplied?'Review applied tables →':'Continue to review →';
  $('#calculate').disabled=busy||!ready.hasCases||pendingJSON;
  $('#save-project').disabled=busy||pendingJSON||!Object.keys(TABLES).some(k=>project[k].length);
  $('#export-results').disabled=!report||busy;
  for(const id of ['files','load-demo','load-htl','add-row','apply-table','edit-table','row-start'])$('#'+id).disabled=busy||pendingJSON;
  for(const input of document.querySelectorAll('#data-editor input,#data-editor button,.table-chip'))input.disabled=pendingJSON||busy;
  $('#project-json').disabled=busy;$('#apply-json').disabled=busy;
  $('#discard-json').disabled=!pendingJSON;
  $('#readiness-list').innerHTML=ready.checks.map(c=>`<li class="${c.ok?'is-ready':'needs-review'}"><span aria-hidden="true">${c.ok?'✓':'○'}</span><div><strong>${esc(c.label)}</strong><small>${esc(c.detail)}</small></div><em>${c.ok?'Present':'Review'}</em></li>`).join('');
  $('#review-status').textContent=ready.schemaError?`Input issue: ${ready.schemaError}`:ready.complete?'Inputs present. Calculate to check numerical closure and factor coverage.':ready.hasCases?'Some inputs need attention. You can calculate to inspect the missing-data diagnostics.':'Add a reference case in step 1 before calculating.';
  if(unapplied)$('#review-status').textContent+=` ${unapplied} staged worksheet${unapplied===1?' is':'s are'} NOT applied and will not be included. Calculation uses the currently applied tables only.`;
  $('#worksheet-next').hidden=!sheets.length;
  $('#worksheet-next').disabled=busy||sheets.every((_,i)=>appliedSheets.has(i));
  $('#worksheet-next').textContent=sheets.every((_,i)=>appliedSheets.has(i))?'All worksheets applied':'Next worksheet →';
  const count=eligibleCases(report,$('#rank-category').value).length;
  $('#rank').disabled=!report||!project.meta.comparable_cases||count<2;
  $('#go-compare').disabled=!report;
  $('#go-compare').textContent=count<2?'Comparison requirements →':'Compare cases →';
  $('#comparison-hint').textContent=!report?'Calculate a project to compare cases.':count<2?`${count} eligible case${count===1?'':'s'} for this category. Add or complete cases in step 1: at least two balanced cases with energy, yield and complete category factors are needed.`:!project.meta.comparable_cases?'Next: return to step 2 and confirm that the cases share a comparable function, boundary and allocation.':`${count} eligible cases. Set your priorities below, then compare. No performance threshold is imposed.`;
  translatePage();
  if(!restoring)schedulePersist();
}
function showTab(name,scroll=true){if(pendingJSON&&name!=='import'){message('Apply or discard the pending JSON edits in step 1 first.',true);return;}if(name==='results'&&!report){message('Review the basis in step 2, then calculate to unlock results.');return;}activeTab=name;for(const b of document.querySelectorAll('[data-tab]')){const on=b.dataset.tab===name;b.setAttribute('aria-pressed',String(on));if(on)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');$('#tab-'+b.dataset.tab).hidden=!on;}updateWorkflow();if(scroll){$('#workflow-title').scrollIntoView({block:'start',behavior:'instant'});$('#workflow-title').focus({preventScroll:true});}}
function invalidate(){report=null;ranking=null;preferenceScan=null;clearResultVisuals($('#result-visuals'));for(const id of ['balance-body','impact-results','rank-results','results-summary','result-error-list','energy-kpis','balance-status','flow-body'])$('#'+id).innerHTML='';if(activeTab==='results')showTab('context',false);else updateWorkflow();}
function sync(){
  pendingJSON=false;invalidate();$('#project-json').value=JSON.stringify(project,null,2);
  $('#table-counts').innerHTML=Object.keys(TABLES).map(k=>`<button class="table-chip" data-edit-table="${k}"><strong>${esc(k)}</strong><span>${project[k].length} rows ${project[k].length?'✓':'· add data'}</span></button>`).join('');
  const meta=project.meta;for(const [id,key] of [['project-name','name'],['boundary','boundary'],['functional-unit','functional_unit'],['allocation-method','allocation_method'],['enthalpy-basis','enthalpy_basis']])$('#'+id).value=meta[key]||'';
  $('#calorie').value=meta.calorie_J??'';$('#inventory-complete').checked=meta.inventory_complete===true;$('#comparable').checked=meta.comparable_cases===true;
  $('#coverage-summary').textContent=`${project.cases.length} cases · ${project.inventory.length} inventory rows · ${project.factors.length} factor entries. Add or edit them in Import & map.`;
  editRows();updateWorkflow();
}
function editRows(){
  const table=$('#edit-table').value,fields=TABLES[table],start=Math.max(0,Number($('#row-start').value)-1);
  const row=project[table][start];$('#data-editor').innerHTML=row?fields.map(f=>`<label>${esc(f)}<input data-row="${start}" data-field="${f}" aria-label="Row ${start+1} ${f}" value="${esc(row[f]??'')}"></label>`).join('')+`<div><p>Row ${start+1} of ${project[table].length}</p><button class="table-action" data-remove="${start}">Remove row</button></div>`:'<p>No row at this position. Select a valid row number or Add row.</p>';
}
$('#edit-table').addEventListener('change',()=>{$('#row-start').value=1;editRows();});$('#row-start').addEventListener('change',editRows);
$('#data-editor').addEventListener('input',e=>{const input=e.target;if(!input.dataset.field)return;project[$('#edit-table').value][Number(input.dataset.row)][input.dataset.field]=input.value;invalidate();$('#project-json').value=JSON.stringify(project,null,2);message('Table edit retained locally. Recalculate to update the analysis.');});
$('#data-editor').addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(!b||pendingJSON||busy)return;project[$('#edit-table').value].splice(Number(b.dataset.remove),1);context();sync();message('Removed the row from this local project. Original file unchanged.');});
$('#add-row').addEventListener('click',()=>{const table=$('#edit-table').value;project[table].push(Object.fromEntries(TABLES[table].map(f=>[f,f==='case_id'&&project.cases.length===1?project.cases[0].id:''])));$('#row-start').value=project[table].length;context();sync();message('Added a blank row. Supply units, source and required values before calculating.');});
function context(){
  for(const [id,key] of [['project-name','name'],['boundary','boundary'],['functional-unit','functional_unit'],['allocation-method','allocation_method'],['enthalpy-basis','enthalpy_basis']])project.meta[key]=$('#'+id).value.trim();
  project.meta.calorie_J=$('#calorie').value?Number($('#calorie').value):null;project.meta.inventory_complete=$('#inventory-complete').checked;project.meta.comparable_cases=$('#comparable').checked;
}
function loadProject(data){
  const p=validateWorkspaceShape(adaptAspen(data));
  project=p;sheets=[];matrix=[];appliedSheets.clear();$('#mapping-panel').hidden=true;$('#files').value='';sync();showTab('context');message(`Loaded ${project.meta.name||'project'}. Next: review the basis below, then calculate.`);
}
function download(name,data){const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function guarded(fn){return async(...args)=>{try{await fn(...args);}catch(e){message(e.message,true);$('#message').scrollIntoView({block:'center'});}finally{updateWorkflow();}};}
function importing(fn){return guarded(async(...args)=>{if(busy)return;busy=true;updateWorkflow();message('Reading data locally…');try{await fn(...args);}finally{busy=false;if(args[0]?.target===$('#files'))$('#files').value='';updateWorkflow();}});}
function rowsForSheet(){
  const src=sheets[Number($('#sheet').value)];if(!src)return[];
  const header=Number($('#header-row').value);if(!Number.isInteger(header)||header<1||header>100)throw new Error(t('Header row must be an integer from 1 to 100.','表头行必须为 1 至 100 的整数。'));
  let rows=src.rows.slice(header-1);
  if($('#transpose').checked){const width=Math.max(0,...rows.map(r=>r.length));rows=Array.from({length:width},(_,i)=>rows.map(r=>r[i]??''));}
  if(rows.length<2)throw new Error('Choose a header row with data below it');
  if(rows.length>10001)throw new Error('Limit: 10,000 rows per worksheet. Split larger exports into cases.');
  return rows;
}
function inferType(name){const s=name.toLowerCase();if(/block|设备/.test(s))return'blocks';if(/factor|因子/.test(s))return'factors';if(/invent|清单/.test(s))return'inventory';if(/case|工况/.test(s))return'cases';return'streams';}
function mapping(){
  matrix=rowsForSheet();if(!matrix.length)return;
  const headers=matrix[0].map(String),type=$('#table-type').value,src=sheets[Number($('#sheet').value)];
  $('#mapping-source').textContent=src.name;const proposed=suggest(headers,type);
  const hints={case_id:project.cases.length===1?project.cases[0].id:'case-1',source:src.name,allocation:1};
  const matched=field=>headers[proposed.find(r=>r.field===field)?.index]||'';
  if(/kg[_ /]h/i.test(matched('mass_flow')+matched('product_rate')))hints.mass_unit='kg/h';
  if(/kw/i.test(matched('heat')+matched('power')+matched('enthalpy_flow')))hints.energy_unit='kW';
  $('#mapping-body').innerHTML=proposed.map(r=>`<tr data-field="${r.field}"><td>${esc(r.field)}</td><td><select aria-label="${r.field} source column"><option value="-1">Unmapped</option>${headers.map((h,i)=>`<option value="${i}" ${i===r.index?'selected':''}>${i+1} · ${esc(h)}</option>`).join('')}</select></td><td><input aria-label="${r.field} constant" value="${esc(hints[r.field]??'')}"></td><td>${r.index<0?'No reliable match':`${fmt(r.score*100,0)}% text similarity${r.ambiguous?' · ambiguous':''}`}</td></tr>`).join('');
  $('#preview').innerHTML=`<thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${matrix.slice(1,6).map(r=>`<tr>${headers.map((_,i)=>`<td>${esc(r[i])}</td>`).join('')}</tr>`).join('')}</tbody>`;
}
$('#files').addEventListener('change',importing(async e=>{
  const files=[...e.target.files];if(!files.length)return;
  if(files.length>10)throw new Error('Import at most 10 files at a time');
  if(files.some(f=>f.size>20*1024*1024))throw new Error('Maximum file size: 20 MB');
  if(files.some(f=>f.name.toLowerCase().endsWith('.json'))){if(files.length!==1)throw new Error('Import one JSON project separately from worksheets');loadProject(JSON.parse(await files[0].text()));return;}
  const next=[];
  for(const file of files){const bytes=await file.arrayBuffer();
    if(/\.(csv|tsv)$/i.test(file.name))next.push({name:file.name,rows:parseCSV(new TextDecoder($('#encoding').value,{fatal:true}).decode(bytes))});
    else if(/\.(xlsx|xls)$/i.test(file.name)){
      next.push(...readSpreadsheet(bytes,XLSX,file.name));
    }else throw new Error('Unsupported file type; export CSV, Excel or JSON from Aspen first');
  }
  if(!next.length)throw new Error('No data worksheets found');sheets=next;appliedSheets.clear();$('#files').value='';invalidate();
  $('#sheet').innerHTML=sheets.map((s,i)=>`<option value="${i}">${esc(s.name)}</option>`).join('');$('#mapping-panel').hidden=false;$('#header-row').value=1;$('#transpose').checked=false;$('#table-type').value=inferType(sheets[0].name);showTab('import');mapping();message('Files parsed locally. Review each worksheet mapping, then Apply.');
}));
$('#sheet').addEventListener('change',guarded(()=>{$('#header-row').value=1;$('#transpose').checked=false;$('#table-type').value=inferType(sheets[Number($('#sheet').value)].name);mapping();}));
for(const id of ['suggest','table-type'])$('#'+id).addEventListener(id==='suggest'?'click':'change',guarded(mapping));
$('#apply-table').addEventListener('click',guarded(()=>{
  // Rebuild source rows after a header/transpose change; mapping column indices are reviewed explicitly.
  const current=rowsForSheet();if(JSON.stringify(current[0])!==JSON.stringify(matrix[0]))throw new Error('Header changed. Select Suggest mapping, review it, then apply.');
  const fields=[...document.querySelectorAll('#mapping-body tr')].map(r=>({field:r.dataset.field,index:Number(r.querySelector('select').value),constant:r.querySelector('input').value}));
  const selected=fields.filter(f=>f.index>=0).map(f=>f.index);if(new Set(selected).size!==selected.length)throw new Error('One source column is mapped more than once; resolve ambiguous suggestions');
  const identifiers=['id','case_id','from','to','factor_id','category'];
  const rows=current.slice(1).filter(r=>r.some(v=>clean(v)!=='')).map(row=>Object.fromEntries(fields.map(f=>{let v=f.index>=0?(row[f.index]??''):f.constant;if(identifiers.includes(f.field))v=clean(v);return[f.field,v];})));
  if(!rows.length)throw new Error('No data rows');const type=$('#table-type').value;
  context();project[type]=$('#apply-mode').value==='append'?[...project[type],...rows]:rows;appliedSheets.add(Number($('#sheet').value));
  project.meta.inventory_complete=false;project.meta.comparable_cases=false;sync();message(`Applied ${rows.length} rows to ${type}. Review the remaining worksheets and calculation basis.`);
}));
$('#apply-json').addEventListener('click',guarded(()=>loadProject(JSON.parse($('#project-json').value))));
$('#load-demo').addEventListener('click',importing(async()=>{const r=await fetch('data/universal-example.json');if(!r.ok)throw new Error('Example unavailable');loadProject(await r.json());}));
$('#load-htl').addEventListener('click',importing(async()=>{const r=await fetch('data/universal-htl.json');if(!r.ok)throw new Error('Example unavailable');loadProject(await r.json());}));
$('#template').addEventListener('click',()=>{const wb=XLSX.utils.book_new();for(const [name,fields]of Object.entries(TABLES))XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([fields]),name);XLSX.writeFile(wb,'process-import-template.xlsx');});
$('#save-project').addEventListener('click',()=>{if(pendingJSON)return;context();download('process-project.json',project);message('Project saved. Keep this JSON file to restore your inputs later.');});
for(const b of document.querySelectorAll('[data-tab]'))b.addEventListener('click',()=>showTab(b.dataset.tab));
$('#edit-context').addEventListener('click',()=>showTab('context'));$('#back-import').addEventListener('click',()=>{context();$('#project-json').value=JSON.stringify(project,null,2);showTab('import');});
for(const input of document.querySelectorAll('#tab-context input,#tab-context select'))input.addEventListener('input',()=>{context();invalidate();$('#project-json').value=JSON.stringify(project,null,2);message('Basis changed. Calculate again to update results.');});
$('#import-next').addEventListener('click',()=>showTab('context'));
$('#worksheet-next').addEventListener('click',guarded(()=>{const current=Number($('#sheet').value),order=sheets.map((_,i)=>i).sort((a,b)=>((a-current-1+sheets.length)%sheets.length)-((b-current-1+sheets.length)%sheets.length));const next=order.find(i=>!appliedSheets.has(i));if(next===undefined)return;$('#sheet').value=String(next);$('#sheet').dispatchEvent(new Event('change'));$('#mapping-panel').scrollIntoView({block:'start'});message(`Review ${sheets[next].name}, then apply its mapping.`);}));
$('#table-counts').addEventListener('click',e=>{const button=e.target.closest('[data-edit-table]');if(!button)return;$('#edit-table').value=button.dataset.editTable;$('#row-start').value=1;$('#row-editor').open=true;editRows();$('#row-editor').scrollIntoView({block:'start'});});
$('#project-json').addEventListener('input',()=>{pendingJSON=true;invalidate();message('JSON edits are pending. Select Apply JSON edits before continuing.');});
$('#discard-json').addEventListener('click',()=>{pendingJSON=false;$('#project-json').value=JSON.stringify(project,null,2);updateWorkflow();message('Unapplied JSON edits discarded. Your last applied project is retained.');});
$('#fix-inputs').addEventListener('click',()=>{showTab('import');$('#row-editor').open=true;$('#row-editor').scrollIntoView({block:'start'});});
$('#review-basis').addEventListener('click',()=>showTab('context'));
$('#go-compare').addEventListener('click',()=>$('#comparison-section').scrollIntoView({block:'start'}));
for(const id of ['mapping-body','header-row','transpose','table-type'])$('#'+id).addEventListener('input',()=>{appliedSheets.delete(Number($('#sheet').value));updateWorkflow();});
function issues(errors){return errors.length?`<div class="audit-issues"><ul>${errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul></div>`:'';}
function metric(label,value,unit){return `<article class="overview-kpi"><div class="overview-kpi-label">${esc(label)}</div><div class="overview-kpi-value">${fmt(value,5)} <span class="overview-kpi-unit">${esc(unit)}</span></div></article>`;}
function impactDetails(i){
  const incompatible=i.errors.includes('Category factors must use one declared method and impact unit');
  const partial=Number.isFinite(i.nominal_subtotal);
  const heading=incompatible?t('Mixed methods or units','方法或单位不一致'):esc(i.unit)+'/kg product';
  const state=i.complete?t('Declared inventory fully characterized','声明的清单已全部表征'):partial?t('INCOMPLETE — partial subtotal only','不完整——仅为部分小计'):t('INCOMPLETE — no category total','不完整——无类别合计');
  const support=i.complete?`<div class="table-scroll"><table><thead><tr><th>α level</th><th>Lower bound</th><th>Upper bound</th></tr></thead><tbody>${i.cuts.map(c=>`<tr><td>${c.alpha}</td><td>${fmt(c.range[0],6)}</td><td>${fmt(c.range[1],6)}</td></tr>`).join('')}</tbody></table></div>`:partial?`<p>${t(`Covered-row nominal subtotal: ${fmt(i.nominal_subtotal,6)}. This is not a complete footprint.`)}</p>`:`<p>${incompatible?t('Subtotal unavailable: incompatible methods or units. Inspect each contribution in its own declared context.','小计不可用：方法或单位不一致。请按各贡献项自身声明的依据分别查看。'):t('Subtotal unavailable. Review the reported calculation issues.','小计不可用，请检查报告的计算问题。')}</p>`;
  return `<div class="impact-card"><h3><span data-no-i18n>${esc(i.category)}</span> · <span>${heading}</span></h3><p><span>${state}</span> · ${i.covered}/${i.total} <span>${t('inventory rows','条清单记录')}</span> · <span data-no-i18n>${incompatible?'':esc(i.method)}</span></p>${issues(i.errors)}${support}<details><summary>Contribution and factor lineage</summary><div class="table-scroll"><table><thead><tr><th>Inventory</th><th>Nominal contribution</th>${incompatible?'<th>Method</th>':''}<th>Factor</th><th>Source</th></tr></thead><tbody>${i.contributions.map(c=>`<tr><td data-no-i18n>${esc(c.name)}</td><td>${fmt(c.nominal)}${incompatible?` <span data-no-i18n>${esc(c.unit)}/kg</span>`:''}</td>${incompatible?`<td data-no-i18n>${esc(c.method)}</td>`:''}<td data-no-i18n>${esc(c.factor_id)}</td><td data-no-i18n>${esc(c.source)}</td></tr>`).join('')}</tbody></table></div></details></div>`;
}
function render(){
  const r=report.results.find(x=>x.id===$('#result-case').value);if(!r)return;const b=r.balance;
  const guidance=resultGuidance(r),impact=r.impacts.find(i=>i.category===$('#rank-category').value)||r.impacts[0];
  const kpi=(label,value,unit,note)=>`<article class="overview-kpi"><div class="overview-kpi-label">${esc(label)}</div><div class="overview-kpi-value">${typeof value==='number'?fmt(value,3):esc(value)} <span class="overview-kpi-unit">${esc(unit)}</span></div><p class="panel-foot">${esc(note)}</p></article>`;
  $('#results-summary').innerHTML=kpi('Balance check',b.within_tolerance?'Closed':b.complete?'Review':'Incomplete','',b.within_tolerance?'Numerical tolerance met; not physical validation.':'Open the issues below before comparing.')+kpi('Purchased energy',r.energy?.at(-1).range[0]??'Unavailable','kWh/kg','Nominal value · allocated target-product basis')+kpi(impact?.category||'Environmental impact',impact?.complete?impact.nominal_subtotal:'Unavailable',impact?.complete?`${impact.unit}/kg`:'',impact?.complete?'Nominal value · declared inventory only':'Complete factors and inventory scope first.')+kpi('Target / feed yield',r.yield?r.yield[1]*100:'Unavailable',r.yield?'%':'','Nominal mass yield · declared reference feed');
  $('#result-error-list').innerHTML=guidance.errors.length?`<div class="audit-issues"><h3>${guidance.errors.length} item${guidance.errors.length===1?'':'s'} to review</h3><ul>${guidance.errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul></div>`:'<p class="result-clear">✓ No missing-data or balance issues reported for this case. Review the declared scope before interpreting its impact.</p>';
  $('#results-next').textContent=guidance.errors.length?'Next: edit the inputs or review the basis, then calculate again. Any available figures below retain their declared scope.':project.cases.length<2?'Next: inspect the energy flows and factor contributions, then export your audit. Add another comparable case to enable ranking.':'Next: inspect energy and impact details, then compare the eligible cases below.';
  $('#fix-inputs').hidden=!guidance.errors.length;
  $('#impact-scope').textContent=`Declared boundary: ${project.meta.boundary}.${project.meta.native_warnings?' Native report: '+project.meta.native_warnings:''}`;
  $('#balance-status').innerHTML=`<p>${b.complete?(b.within_tolerance?'Declared balances meet the numerical tolerance. Physical validation is separate.':'Balances computed, but numerical tolerance exceeded. This case is excluded from ranking.'):'Balance incomplete — totals withheld.'}</p><p class="panel-foot">${esc(b.tolerance)}</p>`+issues([...b.errors,...r.issues]);
  $('#energy-kpis').innerHTML=b.total?metric('External heating',b.total.external_heat_in_kW,'kW')+metric('External cooling',b.total.external_heat_out_kW,'kW')+metric('Boundary energy residual',b.total.energy_residual_kW,'kW'):'';
  renderResultVisuals($('#result-visuals'),{project,report,caseId:r.id,category:$('#rank-category').value});
  renderHandoff();
  $('#balance-body').innerHTML=b.blocks.map(x=>`<tr><td>${esc(x.id)}</td><td>${fmt(x.heat)}</td><td>${fmt(x.power)}</td><td>${fmt(x.mass_residual_kg_h,7)}</td><td>${fmt(x.energy_residual_kW,7)}</td></tr>`).join('');
  $('#flow-body').innerHTML=b.streams.map(s=>`<tr><td>${esc(s.id)}</td><td>${esc(s.from)} → ${esc(s.to)}</td><td>${fmt(s.mass)}</td><td>${fmt(s.enthalpy)}</td></tr>`).join('');
  $('#impact-results').innerHTML=(r.energy?`<p>Purchased-energy intensity, α = 0 support: <strong>${r.energy[0].range.map(v=>fmt(v,4)).join('–')} kWh/kg product</strong>.</p>`:'')+(r.impacts.length?r.impacts.map(impactDetails).join(''):'<p>Impact totals are unavailable. Review the reference-product inputs and factor coverage.</p>');
  for(const [index,card] of [...$('#impact-results').querySelectorAll('.impact-card')].entries()){
    const i=r.impacts[index];if(!i.complete)continue;const table=card.querySelector('.table-scroll'),details=document.createElement('details');details.innerHTML='<summary>Inspect all five possibility levels</summary>';table.before(details);details.append(table);
    const summary=document.createElement('div');summary.className='impact-values';summary.innerHTML=`<div><span>Lower support · α = 0</span><strong>${fmt(i.cuts[0].range[0],4)}</strong></div><div><span>Nominal · α = 1</span><strong>${fmt(i.nominal_subtotal,4)}</strong></div><div><span>Upper support · α = 0</span><strong>${fmt(i.cuts[0].range[1],4)}</strong></div>`;details.before(summary);
  }
  updateWorkflow();
}
$('#calculate').addEventListener('click',guarded(()=>{if(pendingJSON)throw new Error('Apply the pending JSON edits first');context();invalidate();const next=assess(project);if(!next.results.length)throw new Error('Import at least one case');report=next;ranking=null;$('#rank-results').innerHTML='';$('#result-case').innerHTML=report.results.map(r=>`<option value="${esc(r.id)}">${esc(r.id)}</option>`).join('');$('#rank-category').innerHTML=report.categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');render();showTab('results');message('Analysis updated. Start with the summary; review any issues before using the comparison.');}));
$('#result-case').addEventListener('change',render);
$('#rank').addEventListener('click',guarded(()=>{
  ranking=null;preferenceScan=null;$('#rank-results').innerHTML='';if(!report)throw new Error('Calculate first');ranking=rank(report,$('#rank-category').value,['energy','impact','yield'].map(k=>$('#weight-'+k).value),project.meta.comparable_cases);
  $('#rank-results').innerHTML=`<p>Weights normalized to ${ranking.weights.map(v=>fmt(v,3)).join(' / ')}. Excluded incomplete cases: ${esc(ranking.excluded.join(', ')||'none')}.</p><div class="table-scroll" tabindex="0"><table><thead><tr><th>Case</th><th>Nominal score</th><th>Low / medium / high membership</th><th>Score support</th><th>Possible rank range</th></tr></thead><tbody>${ranking.rows.map(r=>`<tr><td>${esc(r.id)}</td><td>${fmt(r.score)}</td><td>${r.membership.map(v=>fmt(v,3)).join(' / ')}</td><td>${r.score_support.map(v=>fmt(v,3)).join('–')}</td><td>${r.possible_rank.join('–')}</td></tr>`).join('')}</tbody></table></div>`+preferenceControlsHTML();
}));
for(const input of document.querySelectorAll('#rank-category,[id^="weight-"]'))input.addEventListener('input',()=>{if(input.id==='rank-category'&&report)render();ranking=null;preferenceScan=null;$('#rank-results').innerHTML='<p>Weights or category changed. Evaluate ranking again.</p>';updateWorkflow();});
$('#result-visuals').addEventListener('resultcategorychange',event=>{if(!report?.categories.includes(event.detail.category))return;$('#rank-category').value=event.detail.category;ranking=null;preferenceScan=null;$('#rank-results').innerHTML='<p>Weights or category changed. Evaluate ranking again.</p>';render();});
$('#export-results').addEventListener('click',()=>{if(!report)return;download('process-analysis.json',{project,report,ranking,preference_scan:preferenceScan,created_at:new Date().toISOString()});message('Analysis and audit saved, including your inputs, assumptions and available ranking.');});

function renderHandoff(){
  const link=referenceLink(project,referenceProject);
  $('#open-prediction').href=link.href;
  $('#open-prediction').textContent=link.matches?t('Continue to HTL prediction →','继续到 HTL 预测 →'):t('Explore the HTL reference lab →','浏览 HTL 参考模型 →');
  $('#handoff-description').textContent=link.matches?t('This is the supplied native HTL export. Open the same nominal 325 °C / 8.5 m HR condition in the frozen prediction lab.','这是提供的原生 HTL 导出。在冻结预测模块中打开同一名义工况：325 °C / 8.5 m、HR。'):t('Imported-data comparisons use the declared fuzzy supports above. The separate HTL lab explores the older reference model, not the 17-case pilot.','导入数据的比较采用上方声明的模糊支持区间。独立的 HTL 分析模块用于探索旧参考模型，不是 17 工况试运行模型。');
  $('#handoff-scope').textContent=t('The lab uses an older frozen reference model, separate from both the 17-case pilot and your imported project. Your applied inputs and results will be restored when you return to this tab.','预测模块使用旧的冻结参考模型，与 17 工况试运行模型和本次导入项目相互独立。返回本标签页时，将恢复已应用输入和计算结果。');
  if(link.matches){
    const current=report?.results.find(row=>row.id===project.cases[0].id),specific=current?.energy?.find(cut=>cut.alpha===1)?.range[0],product=Number(project.cases[0].product_rate);
    const explanation=t('The prediction lab shows electricity per 100 kg wet feed over 1 h; this workspace shows purchased energy per kg target product. Carbon footprint remains per kg target. Predicted values can differ from the native outputs.','预测模块的电耗按 100 kg 湿进料、1 h 展示；此工作区按每 kg 目标产品展示购入能量。碳足迹仍按每 kg 目标产品。预测值可能与原生输出不同。');
    $('#handoff-scope').textContent+=' '+explanation;
    if(Number.isFinite(specific)&&Number.isFinite(product))$('#handoff-scope').textContent+=' '+t(`Native basis conversion: ${fmt(specific,4)} kWh/kg × ${fmt(product,4)} kg = ${fmt(specific*product,4)} kWh per 100 kg wet feed.`,`原生基准换算：${fmt(specific,4)} kWh/kg × ${fmt(product,4)} kg = ${fmt(specific*product,4)} kWh / 100 kg 湿进料。`);
  }

}
function currentSession(){
  return {project,draft:pendingJSON?$('#project-json').value:null,activeTab,calculated:Boolean(report),caseId:$('#result-case').value,category:$('#rank-category').value,
    weights:['energy','impact','yield'].map(k=>$('#weight-'+k).value),ranking,preferenceScan:Boolean(preferenceScan),
    sheets,applied:[...appliedSheets],sheet:$('#sheet').value,header:$('#header-row').value,transpose:$('#transpose').checked,type:$('#table-type').value,mode:$('#apply-mode').value,reviewedHeader:matrix[0]??null,
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
      $('#sheet').value=state.sheet||'0';$('#header-row').value=state.header||'1';$('#transpose').checked=Boolean(state.transpose);$('#table-type').value=state.type||'streams';$('#apply-mode').value=state.mode||'replace';$('#mapping-panel').hidden=false;
      try{
        mapping();
        if(JSON.stringify(matrix[0])===JSON.stringify(state.reviewedHeader)){
          for(const row of document.querySelectorAll('#mapping-body tr')){const mapped=state.mappings?.find(m=>m.field===row.dataset.field);if(mapped){row.querySelector('select').value=mapped.column;row.querySelector('input').value=mapped.constant;}}
        }else matrix=[]; // A changed header must be suggested and reviewed again.
      }catch{matrix=[];$('#mapping-body').innerHTML='';$('#preview').innerHTML='';}
    }
    if(state.weights)for(const [index,key] of ['energy','impact','yield'].entries())$('#weight-'+key).value=state.weights[index];
    if(state.calculated&&typeof state.draft!=='string'){
      report=assess(project);$('#result-case').innerHTML=report.results.map(r=>`<option value="${esc(r.id)}">${esc(r.id)}</option>`).join('');
      $('#rank-category').innerHTML=report.categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
      if(report.results.some(r=>r.id===state.caseId))$('#result-case').value=state.caseId;
      if(report.categories.includes(state.category))$('#rank-category').value=state.category;
      render();
      if(state.ranking&&project.meta.comparable_cases){$('#rank').click();if(state.preferenceScan){preferenceScan=scanPreferences(report,$('#rank-category').value,true);renderPreferenceScan($('#rank-results [data-preference-output]'),preferenceScan);}}
    }
    if(typeof state.draft==='string'){pendingJSON=true;$('#project-json').value=state.draft;$('#project-json').closest('details').open=true;}
    const tab=pendingJSON?'import':state.activeTab==='results'&&!report?'context':state.activeTab;
    showTab(['import','context','results'].includes(tab)?tab:'import',false);
    message(sheets.length&&!matrix.length?t('Inputs and drafts restored. Correct the header row, then suggest and review the mapping again.','输入与草稿已恢复。请修正表头行后重新建议并检查字段映射。'):t('Restored this tab’s workspace. Your inputs, mappings and pending edits are retained.','已恢复本标签页的工作区，包括输入、字段映射和待应用的编辑。'));
  }catch{report=null;pendingJSON=false;activeTab='import';sync();showTab('import',false);message(t('Applied inputs restored. Review the tables and calculate again.','已恢复已应用输入，请检查数据表后重新计算。'));}
  restoring=false;updateWorkflow();
}
restore();
window.addEventListener('pagehide',persist);
document.addEventListener('input',schedulePersist);document.addEventListener('change',schedulePersist);
window.addEventListener('languagechange',()=>{if(report){render();if(preferenceScan)renderPreferenceScan($('#rank-results [data-preference-output]'),preferenceScan);}else updateWorkflow();translatePage();});
fetch('data/universal-htl.json').then(r=>{if(!r.ok)throw new Error('Reference unavailable');return r.json();}).then(data=>{referenceProject=data;if(report)renderHandoff();}).catch(()=>{});

$('#rank-results').addEventListener('click',guarded(event=>{if(!event.target.closest('[data-preference-run]'))return;preferenceScan=scanPreferences(report,$('#rank-category').value,project.meta.comparable_cases);renderPreferenceScan($('#rank-results [data-preference-output]'),preferenceScan);schedulePersist();}));
