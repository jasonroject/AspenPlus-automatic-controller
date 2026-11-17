import test from 'node:test';import assert from 'node:assert/strict';
import {inspectProfile,buildPlan} from '../analysis_web/model-plan.mjs';
const profile={profile_version:1,id:'closed-loop-demo',model:{sha256:'a'.repeat(64)},variables:[{id:'T',path:'\\Data\\Blocks\\R\\Input\\TEMP',native_unit:'K',min:300,max:400},{id:'P',path:'\\Data\\Blocks\\R\\Input\\PRES',native_unit:'bar',min:10,max:20}],solver_checks:[{path:'status',accepted_values:[0]}],mapping:{product:{},streams:[{}],blocks:[{}]},limits:{max_cases:100}};
test('scan design preserves exact endpoints, names, native units and declared splits',()=>{const p=buildPlan(profile,{T:{min:310,max:350,count:5},P:{min:10,max:20,count:5}},'frozen');assert.equal(p.points.length,25);assert.deepEqual(p.points[0].parameters,{T:310,P:10});assert.deepEqual(p.points.at(-1).parameters,{T:350,P:20});assert.equal(p.points.filter(r=>r.split==='holdout').length,5);assert.equal(new Set(p.points.map(r=>JSON.stringify(r.parameters))).size,25);assert.equal(p.model_sha256,profile.model.sha256);});
test('native planning refuses unsupported writes, out-of-bound and excessive scans',()=>{assert.throws(()=>buildPlan(profile,{T:{min:299,max:350,count:5},P:{min:10,max:20,count:5}}),/reviewed bounds/);assert.throws(()=>buildPlan(profile,{T:{min:300,max:400,count:11},P:{min:10,max:20,count:10}}),/limit/);const bad=structuredClone(profile);bad.variables[0].path='\\Data\\Blocks\\R\\Output\\TEMP';assert.equal(inspectProfile(bad).ready,false);assert.throws(()=>buildPlan(profile,{T:{min:300,max:300,count:2},P:{min:10,max:20,count:5}}),/identical/);});

test('frozen grid keeps the full training convex hull and spreads holdouts across coordinates',()=>{
  const settings={T:{min:310,max:350,count:5},P:{min:10,max:20,count:5}},p=buildPlan(profile,settings,'frozen');
  const training=p.points.filter(r=>r.split==='training'),holdouts=p.points.filter(r=>r.split==='holdout');
  for(const T of [310,350])for(const P of [10,20])assert.ok(training.some(r=>r.parameters.T===T&&r.parameters.P===P));
  // Retaining every rectangle corner retains its convex hull, not just marginal bounds.
  for(const point of holdouts)for(const variable of profile.variables){const values=training.map(r=>r.parameters[variable.id]);assert.ok(point.parameters[variable.id]>=Math.min(...values)&&point.parameters[variable.id]<=Math.max(...values));}
  assert.ok(new Set(holdouts.map(r=>r.parameters.P)).size>1);assert.deepEqual(buildPlan(profile,settings,'frozen'),p);assert.equal(p.split_design.training_count,20);
});

test('malformed profiles cannot bypass the bounded case limit or throw from inspection',()=>{
  for(const bad of [null,[],{...profile,variables:{}},{...profile,variables:[null]},{...profile,limits:{max_cases:'bad'}},{...profile,limits:{max_cases:0}},{...profile,limits:{max_cases:101}},{...profile,limits:{max_cases:2.5}}]){
    const inspection=inspectProfile(bad);assert.equal(inspection.ready,false);assert.ok(inspection.errors.length);assert.throws(()=>buildPlan(bad,{}));
  }
  const duplicate=structuredClone(profile);duplicate.variables[1].path=duplicate.variables[0].path;assert.equal(inspectProfile(duplicate).ready,false);
  for(const path of ['prefix\\Data\\Blocks\\R\\Input\\TEMP','\\Data\\Blocks\\R\\Input\\..\\TEMP','\\Data\\Anything\\R\\Input\\TEMP']){const bad=structuredClone(profile);bad.variables[0].path=path;assert.equal(inspectProfile(bad).ready,false);}
});

test('decimal endpoints are exact and finite extreme ranges use stable interpolation',()=>{
  const p=structuredClone(profile);p.variables=p.variables.slice(0,1);p.variables[0].min=.123456789012345;p.variables[0].max=.123456789012349;
  const plan=buildPlan(p,{T:{min:p.variables[0].min,max:p.variables[0].max,count:3}});
  assert.equal(plan.points[0].parameters.T,p.variables[0].min);assert.equal(plan.points.at(-1).parameters.T,p.variables[0].max);
  p.variables[0].min=-1e308;p.variables[0].max=1e308;
  assert.deepEqual(buildPlan(p,{T:{min:-1e308,max:1e308,count:3}}).points.map(r=>r.parameters.T),[-1e308,0,1e308]);
  p.variables[0].min=1;p.variables[0].max=1+Number.EPSILON;
  assert.throws(()=>buildPlan(p,{T:{min:1,max:1+Number.EPSILON,count:3}}),/distinct/);
});

test('frozen readiness rejects corner-only, too-small or fixed-feature designs',()=>{
  assert.throws(()=>buildPlan(profile,{T:{min:310,max:350,count:2},P:{min:10,max:20,count:2}},'frozen'),/denser grid|training cases/);
  assert.throws(()=>buildPlan(profile,{T:{min:310,max:350,count:9},P:{min:15,max:15,count:1}},'frozen'),/must vary/);
  assert.throws(()=>buildPlan(profile,{T:{min:310,max:350,count:1},P:{min:15,max:15,count:1}}),/equal min/);
  const verified=buildPlan(profile,{T:{min:310,max:310,count:1},P:{min:15,max:15,count:1}});assert.equal(verified.points[0].split,'verification');
  const ready=buildPlan(profile,{T:{min:310,max:350,count:3},P:{min:10,max:20,count:3}},'frozen');assert.equal(ready.split_design.holdout_count,2);assert.equal(ready.split_design.training_count,7);
});

test('unitless inputs are explicit while degenerate bounds and unsafe IDs are rejected',()=>{
  const p=structuredClone(profile);p.variables[0].native_unit='';assert.equal(inspectProfile(p).ready,true);
  p.variables[0].min=p.variables[0].max;assert.equal(inspectProfile(p).ready,false);
  p.variables[0].min=300;p.variables[0].id='../T';assert.equal(inspectProfile(p).ready,false);
});

test('explicit profile review states must be completed before a scan can be planned',()=>{
  for(const review of [{state:'incomplete_draft'},{state:'pending'},{},null]){
    const p={...profile,review};assert.equal(inspectProfile(p).ready,false);assert.throws(()=>buildPlan(p,{T:{min:310,max:310,count:1},P:{min:15,max:15,count:1}}),/review is incomplete/);
  }
  assert.equal(inspectProfile({...profile,review:{state:'reviewed'}}).ready,true);
  assert.equal(inspectProfile(profile).ready,true);
});

test('malformed JSON objects never coerce into diagnostics and explicit null limits are rejected',()=>{
  const changes=[p=>p.name={toString:{}},p=>p.model.sha256={toString:{}},p=>{p.variables[0].id={toString:{}};p.variables[0].path=null;},p=>p.limits.max_cases=null];
  for(const change of changes){const p=structuredClone(profile);change(p);let result;assert.doesNotThrow(()=>result=inspectProfile(p));assert.equal(result.ready,false);assert.ok(result.errors.length);}
});

test('reviewed fixed and linked controls are safe to display and never become independent scan axes',()=>{
  const p=structuredClone(profile);p.linked_inputs=[{id:'P_link',path:'\\Data\\Blocks\\V\\Input\\PRES',native_unit:'bar',source_id:'P'}];p.fixed_inputs=[{id:'Flash',path:'\\Data\\Blocks\\V\\Input\\OPT',native_unit:'',value:1}];
  assert.equal(inspectProfile(p).ready,true);
  const plan=buildPlan(p,{T:{min:310,max:310,count:1},P:{min:15,max:15,count:1}});assert.deepEqual(plan.points[0].parameters,{T:310,P:15});
  for(const change of [q=>q.linked_inputs[0].source_id={toString:{}},q=>q.fixed_inputs[0].value={},q=>q.fixed_inputs[0].id='T',q=>q.linked_inputs[0].native_unit='kPa',q=>q.fixed_inputs[0].expression='run()']){
    const bad=structuredClone(p);change(bad);assert.equal(inspectProfile(bad).ready,false);
  }
});
