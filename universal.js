import {TABLES,blankProject,suggest,parseCSV,adaptAspen,assess,rank,clean} from './universal-core.mjs';
import {readiness,eligibleCases,resultGuidance} from './workspace-state.mjs';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,n=4)=>Number.isFinite(v)?(v!==0&&Math.abs(v)<10**(-n)?v.toExponential(2):v.toLocaleString('en-US',{maximumFractionDigits:n})):'—';
let project=blankProject(),sheets=[],matrix=[],report=null,ranking=null,activeTab='import',pendingJSON=false,busy=false;
const appliedSheets=new Set();
const message=(t,error=false)=>{$('#message').hidden=false;$('#message').textContent=t;$('#message').dataset.kind=error?'error':'info';};
function updateWorkflow(){
  const ready=readiness(project),index=['import','context','results'].indexOf(activeTab);
  $('#workflow-count').textContent=`Step ${index+1} of 3`;
  $('#workflow-title').textContent=activeTab==='import'?'Start with your data.':activeTab==='context'?'Make the basis explicit.':'Understand your results.';
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
}
function showTab(name,scroll=true){if(pendingJSON&&name!=='import'){message('Apply or discard the pending JSON edits in step 1 first.',true);return;}if(name==='results'&&!report){message('Review the basis in step 2, then calculate to unlock results.');return;}activeTab=name;for(const b of document.querySelectorAll('[data-tab]')){const on=b.dataset.tab===name;b.setAttribute('aria-pressed',String(on));if(on)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');$('#tab-'+b.dataset.tab).hidden=!on;}updateWorkflow();if(scroll){$('#workflow-title').scrollIntoView({block:'start',behavior:'instant'});$('#workflow-title').focus({preventScroll:true});}}
function invalidate(){report=null;ranking=null;for(const id of ['balance-body','impact-results','rank-results','results-summary','result-error-list','energy-chart','energy-kpis','balance-status','flow-body'])$('#'+id).innerHTML='';if(activeTab==='results')showTab('context',false);else updateWorkflow();}
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
  const p=adaptAspen(data);if(!p.meta||Object.keys(TABLES).some(k=>!Array.isArray(p[k])))throw new Error('Invalid normalized project: meta and five tables required');
  project=p;sheets=[];matrix=[];appliedSheets.clear();$('#mapping-panel').hidden=true;$('#files').value='';sync();showTab('context');message(`Loaded ${project.meta.name||'project'}. Next: review the basis below, then calculate.`);
}
function download(name,data){const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function guarded(fn){return async(...args)=>{try{await fn(...args);}catch(e){message(e.message,true);$('#message').scrollIntoView({block:'center'});}finally{updateWorkflow();}};}
function importing(fn){return guarded(async(...args)=>{if(busy)return;busy=true;updateWorkflow();message('Reading data locally…');try{await fn(...args);}finally{busy=false;if(args[0]?.target===$('#files'))$('#files').value='';updateWorkflow();}});}
function rowsForSheet(){
  const src=sheets[Number($('#sheet').value)];if(!src)return[];
  let rows=src.rows.slice(Number($('#header-row').value)-1);
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
      const wb=XLSX.read(bytes,{type:'array',cellFormula:true,sheetRows:10002});
      for(const name of wb.SheetNames){const sheet=wb.Sheets[name];if(sheet['!fullref'])throw new Error('Worksheet exceeds the row limit. Split it before importing; no truncated data were applied.');if(Object.values(sheet).some(c=>c&&typeof c==='object'&&c.f))throw new Error('Formula cells are not recalculated. Export a values-only workbook before import.');
        const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true,blankrows:false});if(rows.length)next.push({name:file.name+' / '+name,rows});}
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
function energyChart(blocks){
  if(!blocks.length)return'';const width=800,height=50+blocks.length*36,max=Math.max(1,...blocks.flatMap(b=>[Math.abs(b.heat),Math.abs(b.power)]));
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Signed external heat and work by block"><text x="15" y="18" fill="#222" font-size="13">Heat (solid) and shaft work (outline) · kW · positive into block</text><line x1="430" y1="30" x2="430" y2="${height}" stroke="#777"/>${blocks.map((b,i)=>{const y=48+i*36;return `<text x="15" y="${y+8}" fill="#222" font-size="13">${esc(b.id)}</text>`+['heat','power'].map((k,j)=>{const length=Math.abs(b[k])/max*260;return `<rect x="${b[k]<0?430-length:430}" y="${y+j*12}" width="${length}" height="8" fill="${j?'white':'#333'}" stroke="#333"/><text x="710" y="${y+j*12+8}" fill="#222" font-size="11">${fmt(b[k],3)}</text>`;}).join('');}).join('')}</svg>`;
}
function render(){
  const r=report.results.find(x=>x.id===$('#result-case').value);if(!r)return;const b=r.balance;
  const guidance=resultGuidance(r),impact=r.impacts[0];
  const kpi=(label,value,unit,note)=>`<article class="overview-kpi"><div class="overview-kpi-label">${esc(label)}</div><div class="overview-kpi-value">${typeof value==='number'?fmt(value,3):esc(value)} <span class="overview-kpi-unit">${esc(unit)}</span></div><p class="panel-foot">${esc(note)}</p></article>`;
  $('#results-summary').innerHTML=kpi('Balance check',b.within_tolerance?'Closed':b.complete?'Review':'Incomplete','',b.within_tolerance?'Numerical tolerance met; not physical validation.':'Open the issues below before comparing.')+kpi('Purchased energy',r.energy?.at(-1).range[0]??'Unavailable','kWh/kg','Nominal value · allocated target-product basis')+kpi(impact?.category||'Environmental impact',impact?.complete?impact.nominal_subtotal:'Unavailable',impact?.complete?`${impact.unit}/kg`:'',impact?.complete?'Nominal value · declared inventory only':'Complete factors and inventory scope first.')+kpi('Target / feed yield',r.yield?r.yield[1]*100:'Unavailable',r.yield?'%':'','Nominal mass yield · declared reference feed');
  $('#result-error-list').innerHTML=guidance.errors.length?`<div class="audit-issues"><h3>${guidance.errors.length} item${guidance.errors.length===1?'':'s'} to review</h3><ul>${guidance.errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul></div>`:'<p class="result-clear">✓ No missing-data or balance issues reported for this case. Review the declared scope before interpreting its impact.</p>';
  $('#results-next').textContent=guidance.errors.length?'Next: edit the inputs or review the basis, then calculate again. Any available figures below retain their declared scope.':project.cases.length<2?'Next: inspect the energy flows and factor contributions, then export your audit. Add another comparable case to enable ranking.':'Next: inspect energy and impact details, then compare the eligible cases below.';
  $('#fix-inputs').hidden=!guidance.errors.length;
  $('#impact-scope').textContent=`Declared boundary: ${project.meta.boundary}.${project.meta.native_warnings?' Native report: '+project.meta.native_warnings:''}`;
  $('#balance-status').innerHTML=`<p>${b.complete?(b.within_tolerance?'Declared balances meet the numerical tolerance. Physical validation is separate.':'Balances computed, but numerical tolerance exceeded. This case is excluded from ranking.'):'Balance incomplete — totals withheld.'}</p><p class="panel-foot">${esc(b.tolerance)}</p>`+issues([...b.errors,...r.issues]);
  $('#energy-kpis').innerHTML=b.total?metric('External heating',b.total.external_heat_in_kW,'kW')+metric('External cooling',b.total.external_heat_out_kW,'kW')+metric('Boundary energy residual',b.total.energy_residual_kW,'kW'):'';
  $('#energy-chart').innerHTML=energyChart(b.blocks);
  $('#balance-body').innerHTML=b.blocks.map(x=>`<tr><td>${esc(x.id)}</td><td>${fmt(x.heat)}</td><td>${fmt(x.power)}</td><td>${fmt(x.mass_residual_kg_h,7)}</td><td>${fmt(x.energy_residual_kW,7)}</td></tr>`).join('');
  $('#flow-body').innerHTML=b.streams.map(s=>`<tr><td>${esc(s.id)}</td><td>${esc(s.from)} → ${esc(s.to)}</td><td>${fmt(s.mass)}</td><td>${fmt(s.enthalpy)}</td></tr>`).join('');
  $('#impact-results').innerHTML=(r.energy?`<p>Purchased-energy intensity, α = 0 support: <strong>${r.energy[0].range.map(v=>fmt(v,4)).join('–')} kWh/kg product</strong>.</p>`:'')+(r.impacts.length?r.impacts.map(i=>`<div class="impact-card"><h3>${esc(i.category)} · ${esc(i.unit)}/kg product</h3><p>${i.complete?'Declared inventory fully characterized':'INCOMPLETE — partial subtotal only'} · ${i.covered}/${i.total} inventory rows · ${esc(i.method)}</p>${issues(i.errors)}${i.complete?`<div class="table-scroll"><table><thead><tr><th>α level</th><th>Lower bound</th><th>Upper bound</th></tr></thead><tbody>${i.cuts.map(c=>`<tr><td>${c.alpha}</td><td>${fmt(c.range[0],6)}</td><td>${fmt(c.range[1],6)}</td></tr>`).join('')}</tbody></table></div>`:`<p>Covered-row nominal subtotal: ${fmt(i.nominal_subtotal,6)}. This is not a complete footprint.</p>`}<details><summary>Contribution and factor lineage</summary><div class="table-scroll"><table><thead><tr><th>Inventory</th><th>Nominal contribution</th><th>Factor</th><th>Source</th></tr></thead><tbody>${i.contributions.map(c=>`<tr><td>${esc(c.name)}</td><td>${fmt(c.nominal)}</td><td>${esc(c.factor_id)}</td><td>${esc(c.source)}</td></tr>`).join('')}</tbody></table></div></details></div>`).join(''):'<p>Impact totals are unavailable. Review the reference-product inputs and factor coverage.</p>');
  for(const [index,card] of [...$('#impact-results').querySelectorAll('.impact-card')].entries()){
    const i=r.impacts[index];if(!i.complete)continue;const table=card.querySelector('.table-scroll'),details=document.createElement('details');details.innerHTML='<summary>Inspect all five possibility levels</summary>';table.before(details);details.append(table);
    const summary=document.createElement('div');summary.className='impact-values';summary.innerHTML=`<div><span>Lower support · α = 0</span><strong>${fmt(i.cuts[0].range[0],4)}</strong></div><div><span>Nominal · α = 1</span><strong>${fmt(i.nominal_subtotal,4)}</strong></div><div><span>Upper support · α = 0</span><strong>${fmt(i.cuts[0].range[1],4)}</strong></div>`;details.before(summary);
  }
  updateWorkflow();
}
$('#calculate').addEventListener('click',guarded(()=>{if(pendingJSON)throw new Error('Apply the pending JSON edits first');context();invalidate();const next=assess(project);if(!next.results.length)throw new Error('Import at least one case');report=next;ranking=null;$('#rank-results').innerHTML='';$('#result-case').innerHTML=report.results.map(r=>`<option>${esc(r.id)}</option>`).join('');$('#rank-category').innerHTML=report.categories.map(c=>`<option>${esc(c)}</option>`).join('');render();showTab('results');message('Analysis updated. Start with the summary; review any issues before using the comparison.');}));
$('#result-case').addEventListener('change',render);
$('#rank').addEventListener('click',guarded(()=>{
  ranking=null;$('#rank-results').innerHTML='';if(!report)throw new Error('Calculate first');ranking=rank(report,$('#rank-category').value,['energy','impact','yield'].map(k=>$('#weight-'+k).value),project.meta.comparable_cases);
  $('#rank-results').innerHTML=`<p>Weights normalized to ${ranking.weights.map(v=>fmt(v,3)).join(' / ')}. Excluded incomplete cases: ${esc(ranking.excluded.join(', ')||'none')}.</p><div class="table-scroll" tabindex="0"><table><thead><tr><th>Case</th><th>Nominal score</th><th>Low / medium / high membership</th><th>Score support</th><th>Possible rank range</th></tr></thead><tbody>${ranking.rows.map(r=>`<tr><td>${esc(r.id)}</td><td>${fmt(r.score)}</td><td>${r.membership.map(v=>fmt(v,3)).join(' / ')}</td><td>${r.score_support.map(v=>fmt(v,3)).join('–')}</td><td>${r.possible_rank.join('–')}</td></tr>`).join('')}</tbody></table></div>`;
}));
for(const input of document.querySelectorAll('#rank-category,[id^="weight-"]'))input.addEventListener('input',()=>{ranking=null;$('#rank-results').innerHTML='<p>Weights or category changed. Evaluate ranking again.</p>';updateWorkflow();});
$('#export-results').addEventListener('click',()=>{if(!report)return;download('process-analysis.json',{project,report,ranking,created_at:new Date().toISOString()});message('Analysis and audit saved, including your inputs, assumptions and available ranking.');});
sync();
$('#message').hidden=true;
