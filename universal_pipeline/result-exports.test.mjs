import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assess} from '../analysis_web/universal-core.mjs';
import {resultVisualData,renderResultVisuals,clearResultVisuals} from '../analysis_web/result-visuals.mjs';
import {buildResultExport,supportDomain} from '../analysis_web/result-exports.mjs';
import {buildCSV,standaloneSVG} from '../analysis_web/chart-export.mjs';
import {setLanguage} from '../analysis_web/i18n.mjs';
import {applyProjectEdit} from '../analysis_web/workspace-provenance.mjs';

const fixture=name=>JSON.parse(fs.readFileSync(new URL(`../analysis_web/data/${name}.json`,import.meta.url),'utf8'));
const view=(project,category)=>resultVisualData(project,assess(project),project.cases[0].id,category);

test('exports distinguish locally modified accounting from its preserved native source',()=>{
  const source=fixture('universal-htl'),draft=structuredClone(source);draft.cases[0].product_rate+=1;
  const changed=applyProjectEdit(source,draft),data=view(changed);
  for(const kind of ['supports','contributions','equipment','cases']){
    const chart=buildResultExport(data,kind);
    assert.equal(chart.metadata.declared_evidence,'locally_modified');
    assert.equal(chart.metadata.source_model_sha256,'');
    assert.equal(chart.metadata.origin_model_sha256,source.meta.source_sha256);
    assert.match(chart.metadata.origin_scope,/checks do not cover/);
    assert.ok(chart.rows.every(row=>row.locally_modified===true&&row.origin_model_sha256===source.meta.source_sha256&&row.source_model_sha256===''));
    assert.match(buildCSV(chart.columns,chart.rows),/Historical origin model SHA256/);
  }
});

test('native support export preserves every alpha bound, provenance and possibility interpretation',()=>{
  const project=fixture('universal-htl'),data=view(project),before=JSON.stringify(data),chart=buildResultExport(data,'supports');
  assert.deepEqual(chart.rows.map(row=>[row.alpha,row.lower,row.upper]),data.impact.cuts.map(cut=>[cut.alpha,...cut.range]));
  assert.equal(chart.metadata.case_id,project.cases[0].id);
  assert.equal(chart.metadata.source_model_sha256,project.meta.source_sha256);
  assert.equal(chart.metadata.boundary,project.meta.boundary);
  assert.ok(chart.rows.every(row=>row.unit==='kg CO2-eq/kg'&&row.status==='available'));
  assert.match(chart.description,/not probabilities, confidence intervals/);
  const csv=buildCSV(chart.columns,chart.rows),standalone=standaloneSVG(chart.svg,chart);
  assert.ok(csv.includes(String(data.impact.cuts[0].range[0])));
  assert.ok(standalone.includes(project.meta.source_sha256));
  assert.match(standalone,/<metadata>/);assert.match(standalone,/<line/);
  assert.doesNotMatch(standalone,/<(?:image|foreignObject)\b/);
  assert.equal(JSON.stringify(data),before);
});

test('incomplete category export withholds supports and retains the uncharacterized row with a null value',()=>{
  const project=fixture('universal-example');
  project.factors=project.factors.filter(row=>!(row.id==='feed'&&row.category==='Illustrative climate'));
  const data=view(project,'Illustrative climate'),support=buildResultExport(data,'supports'),contributions=buildResultExport(data,'contributions');
  assert.equal(support.svg,null);assert.equal(support.rows.length,1);
  assert.equal(support.rows[0].status,'unavailable_incomplete_category');assert.equal(support.rows[0].lower,null);assert.equal(support.rows[0].upper,null);
  assert.equal(contributions.rows.length,project.inventory.filter(row=>row.case_id==='A').length);
  const missing=contributions.rows.find(row=>row.status==='uncharacterized');
  assert.equal(missing.factor_id,'feed');assert.equal(missing.value,null);assert.equal(missing.factor_source,null);
  assert.ok(contributions.rows.every(row=>row.category_status==='incomplete_declared_inventory'));
  assert.match(contributions.svg,/Covered-row subtotal only/);
  assert.doesNotMatch(contributions.svg,/Nominal total/);
  assert.match(contributions.description,/Missing values are not zero/);
  const acid=buildResultExport(view(project,'Illustrative acidification'),'supports');
  assert.ok(acid.svg);assert.equal(acid.rows[0].unit,'mol H+-eq/kg');
});

test('equipment export keeps negative heat, true zero shaft work and missing blocks distinct',()=>{
  const project=fixture('universal-htl');
  project.blocks.find(row=>row.id==='PUMP').power='';
  const data=view(project),chart=buildResultExport(data,'equipment');
  const cooler=chart.rows.find(row=>row.id==='COOLER'),pump=chart.rows.find(row=>row.id==='PUMP');
  assert.ok(cooler.heat<0);assert.equal(cooler.power,0);assert.equal(cooler.unit,'kW');
  assert.equal(pump.heat,null);assert.equal(pump.power,null);assert.equal(pump.status,'incomplete_balance_inputs');
  assert.equal(pump.source,project.blocks.find(row=>row.id==='PUMP').source);
  assert.ok(chart.rows.some(row=>typeof row.energy_residual==='number'));
  assert.match(chart.description,/no recovery credit is inferred/);
  assert.ok(buildCSV(chart.columns,chart.rows).includes(String(cooler.heat)));
});

test('SVG display caps do not truncate CSV and case metrics remain separate with explicit units',()=>{
  const data=view(fixture('universal-example'),'Illustrative climate');
  data.impact.contributions=Array.from({length:17},(_,i)=>({...data.impact.contributions[0],id:`row-${i}`,name:`row-${i}`,nominal:17-i}));
  const contribution=buildResultExport(data,'contributions');
  assert.equal(contribution.rows.length,17);assert.ok(contribution.svg.includes('row-11'));assert.ok(!contribution.svg.includes('row-12'));
  data.blocks=Array.from({length:24},(_,i)=>({...data.blocks[0],id:`block-${i}`}));
  const equipment=buildResultExport(data,'equipment');assert.equal(equipment.rows.length,24);assert.ok(!equipment.svg.includes('block-20'));
  data.comparable=false;data.cases[1].impact=null;data.cases[1].impactComplete=false;
  const cases=buildResultExport(data,'cases');assert.equal(cases.svg,null);assert.equal(cases.rows.length,data.cases.length*3);
  assert.deepEqual(cases.rows.slice(0,3).map(row=>row.unit),['kWh/kg','kg CO2-eq/kg','%']);
  assert.ok(cases.rows.every(row=>row.comparability_confirmed===false));
  assert.equal(cases.rows.find(row=>row.case_id===data.cases[1].id&&row.metric==='impact').status,'unavailable');
});

test('tiny and huge finite support values produce finite editable geometry; language changes labels, not numbers',()=>{
  const data=view(fixture('universal-htl'));
  for(const value of [0,Number.MIN_VALUE,1e-20,1e308,Number.MAX_VALUE]){
    data.impact.cuts=[{alpha:0,range:[value,value]},{alpha:1,range:[value,value]}];
    const domain=supportDomain(data.impact.cuts);assert.ok(domain.every(Number.isFinite));assert.ok(domain[1]>domain[0]);
    const chart=buildResultExport(data,'supports');assert.doesNotMatch(chart.svg,/NaN|Infinity/);assert.doesNotThrow(()=>standaloneSVG(chart.svg,chart));
    assert.equal(chart.rows[0].lower,value);assert.equal(chart.rows[0].upper,value);
  }
  const en=buildResultExport(data,'supports');
  try{setLanguage('zh');const zh=buildResultExport(data,'supports');assert.equal(zh.metadata.language,'zh');assert.equal(zh.title,'影响可能性支持区间');assert.equal(zh.rows[0].lower,en.rows[0].lower);assert.equal(zh.rows[0].unit,en.rows[0].unit);}finally{setLanguage('en');}
});

test('cleared or superseded chart buttons cannot export an earlier calculation',()=>{
  // The narrow DOM stub captures click listeners; invoking them after a clear
  // would reach browser-only downloads without the mount revision check.
  const category={addEventListener(){}},message={textContent:'',hidden:true};let buttons=[];
  const container={isConnected:true,classList:{add(){}},set innerHTML(value){buttons=[...value.matchAll(/data-rv-export="([^"]+)" data-rv-format="([^"]+)"/g)].map(match=>({dataset:{rvExport:match[1],rvFormat:match[2]},disabled:false,addEventListener(_,fn){this.click=fn;}}));},querySelector(selector){return selector==='[data-rv-category]'?category:message;},querySelectorAll(selector){return selector==='[data-rv-export]'?buttons:[];}};
  const project=fixture('universal-htl'),options={project,report:assess(project),caseId:project.cases[0].id};
  renderResultVisuals(container,options);const stale=[...buttons];assert.ok(stale.length>0);
  clearResultVisuals(container);for(const button of stale)button.click();assert.equal(message.textContent,'');
  renderResultVisuals(container,options);const previous=[...buttons];renderResultVisuals(container,options);
  for(const button of previous)button.click();assert.equal(message.textContent,'');
  container.isConnected=false;for(const button of buttons)button.click();assert.equal(message.textContent,'');
  clearResultVisuals(container);
});
