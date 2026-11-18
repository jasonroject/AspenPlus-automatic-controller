import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assess,blankProject,rank} from '../analysis_web/universal-core.mjs';
import {readiness,eligibleCases,resultGuidance} from '../analysis_web/workspace-state.mjs';

const fixture=()=>JSON.parse(readFileSync(new URL('../analysis_web/data/universal-example.json',import.meta.url),'utf8'));
const climate='Illustrative climate',acidification='Illustrative acidification';

test('preflight distinguishes an empty valid schema from a ready input set',()=>{
  const empty=readiness(blankProject());
  assert.equal(empty.schemaError,'');
  assert.equal(empty.hasCases,false);
  assert.equal(empty.complete,false);
  assert.ok(empty.checks.some(check=>!check.ok));
  const complete=readiness(fixture());
  assert.equal(complete.complete,true);
  assert.equal(complete.schemaError,'');
});

test('preflight detects invalid structure but does not certify physical closure',()=>{
  const duplicate=fixture();duplicate.cases.push({...duplicate.cases[0]});
  assert.match(readiness(duplicate).schemaError,/duplicate ID/);
  assert.equal(readiness(duplicate).complete,false);
  const unclosed=fixture();unclosed.streams[1].enthalpy_flow=20;
  assert.equal(readiness(unclosed).complete,true);
  const report=assess(unclosed),a=report.results.find(row=>row.id==='A');
  assert.equal(a.balance.complete,true);
  assert.equal(a.balance.within_tolerance,false);
  assert.deepEqual(eligibleCases(report,climate).map(row=>row.id),['B']);
  const guide=resultGuidance(a);
  assert.equal(guide.balanced,false);
  assert.equal(guide.completeImpact,true);
  assert.ok(guide.errors.some(error=>/numerical tolerance/.test(error)));
});

test('category coverage determines ranking eligibility independently per impact',()=>{
  const project=fixture();
  project.factors=project.factors.filter(factor=>!(factor.id==='feed'&&factor.category===climate));
  // Presence checks deliberately allow calculation to reveal missing category factors.
  assert.equal(readiness(project).complete,true);
  const report=assess(project);
  assert.deepEqual(eligibleCases(report,climate),[]);
  assert.deepEqual(eligibleCases(report,acidification).map(row=>row.id),['A','B']);
  assert.throws(()=>rank(report,climate,[1,1,1],true),/At least two/);
  assert.equal(rank(report,acidification,[1,1,1],true).rows.length,2);
  const guide=resultGuidance(report.results[0]);
  assert.equal(guide.balanced,true);
  assert.equal(guide.completeImpact,true);
  assert.ok(guide.errors.some(error=>error.includes(climate)&&error.includes('Missing')));
});

test('a missing feed rate keeps computable impacts but excludes the case from comparison',()=>{
  const project=fixture();delete project.cases[0].feed_rate;
  const report=assess(project),a=report.results[0];
  assert.equal(a.yield,null);
  assert.equal(a.impacts.find(impact=>impact.category===climate).complete,true);
  assert.deepEqual(eligibleCases(report,climate).map(row=>row.id),['B']);
  assert.throws(()=>rank(report,climate,[1,1,1],true),/At least two/);
});

test('scope review is separate from inventory presence and blocks complete-impact claims',()=>{
  const project=fixture();project.meta.inventory_complete=false;
  assert.equal(readiness(project).complete,false);
  const report=assess(project),guide=resultGuidance(report.results[0]);
  assert.equal(guide.balanced,true);
  assert.equal(guide.completeImpact,false);
  assert.ok(guide.errors.some(error=>/scope\/completeness/.test(error)));
  assert.deepEqual(eligibleCases(report,climate),[]);
});

test('invalid product information has no headline impact even when factors are present',()=>{
  const project=fixture();project.cases[0].product_rate='';
  const report=assess(project),a=report.results[0];
  assert.ok(project.factors.length>0);
  assert.equal(a.impacts.length,0);
  assert.equal(resultGuidance(a).completeImpact,false);
  assert.ok(resultGuidance(a).errors.some(error=>/Product/.test(error)));
  assert.deepEqual(eligibleCases(report,climate).map(row=>row.id),['B']);
  assert.deepEqual(eligibleCases(null,climate),[]);
});
