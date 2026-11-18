import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assess} from '../analysis_web/universal-core.mjs';
import {resultVisualData} from '../analysis_web/result-visuals.mjs';
import {buildResultExport} from '../analysis_web/result-exports.mjs';
const fixture=()=>JSON.parse(fs.readFileSync(new URL('../analysis_web/data/universal-example.json',import.meta.url),'utf8'));
const climate=project=>assess(project).results[0].impacts.find(row=>row.category==='Illustrative climate');

for(const field of ['impact_unit','method'])test(`mixed category ${field} retains individual evidence but never adds unlike contributions`,()=>{
  const project=fixture();project.factors.find(row=>row.id==='feed'&&row.category==='Illustrative climate')[field]='different-context';
  const result=climate(project);assert.equal(result.complete,false);assert.equal(result.nominal_subtotal,null);assert.deepEqual(result.cuts,[]);
  assert.equal(result.contributions.length,project.inventory.filter(row=>row.case_id==='A').length);
  assert.ok(result.errors.includes('Category factors must use one declared method and impact unit'));
  const changed=result.contributions.find(row=>row.factor_id==='feed');assert.equal(changed[field==='impact_unit'?'unit':'method'],'different-context');
  const data=resultVisualData(project,assess(project),'A','Illustrative climate'),chart=buildResultExport(data,'contributions');
  assert.equal(data.impact.contextConsistent,false);assert.equal(data.impact.subtotal,null);assert.equal(chart.svg,null);
  assert.ok(chart.rows.every(row=>row.status==='characterized_but_category_context_inconsistent'));
  assert.match(chart.description,/No common chart or subtotal/);
  const exported=chart.rows.find(row=>row.factor_id==='feed');assert.equal(exported[field==='impact_unit'?'unit':'method'],field==='impact_unit'?'different-context/kg':'different-context');
});

test('missing factors within one method and unit retain an explicitly partial subtotal',()=>{
  const project=fixture();project.factors=project.factors.filter(row=>!(row.id==='feed'&&row.category==='Illustrative climate'));
  const result=climate(project);assert.equal(result.complete,false);assert.ok(result.nominal_subtotal>0);assert.equal(result.cuts.length,5);
  assert.equal(result.nominal_subtotal,result.contributions.reduce((sum,row)=>sum+row.nominal,0));
  const data=resultVisualData(project,assess(project),'A','Illustrative climate');assert.equal(data.impact.contextConsistent,true);assert.equal(data.impact.subtotal,result.nominal_subtotal);assert.ok(buildResultExport(data,'contributions').svg);
  const full=climate(fixture());assert.equal(full.complete,true);assert.equal(full.nominal_subtotal,3);assert.equal(full.cuts.at(-1).range[0],3);
});
