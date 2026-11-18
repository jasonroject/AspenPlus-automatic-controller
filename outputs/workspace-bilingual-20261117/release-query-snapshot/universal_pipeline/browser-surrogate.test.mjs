import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BrowserSurrogateError,prepareBrowserSurrogate} from '../analysis_web/browser-surrogate.mjs';

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const published=read('../analysis_web/data/generic-htl-extension/model.bundle.json');
const reference=read('./fixtures/browser-surrogate-v2-reference.json');
const clone=value=>structuredClone(value);
const code=expected=>error=>error instanceof BrowserSurrogateError&&error.code===expected;

function synthetic(points,options={}){
  const n=points.length,d=points[0].length;
  const inputs=Array.from({length:d},(_,i)=>({id:['x','y','z'][i],unit:i===0?'':'meter',min:-2,max:2}));
  const responses=[{id:'response',unit:'kg',direction:'min',value_domain:options.domain??'signed'}];
  const mean=inputs.map((_,i)=>points.reduce((s,p)=>s+p[i],0)/n);
  const scale=inputs.map((_,i)=>Math.sqrt(points.reduce((s,p)=>s+(p[i]-mean[i])**2,0)/n));
  const b={kind:'process_surrogate',bundle_version:1,prediction_enabled:true,status:'declared_simulator_error_checks_passed',evidence_type:'native_simulation',validation:{passed:true},profile_id:'synthetic-test-only',dataset_metadata:{inputs:clone(inputs),responses:clone(responses)},model:{family:'constant_times_matern52_plus_fixed_white',inputs,responses,training_inputs_raw:clone(points),training_inputs_scaled:points.map(p=>p.map((x,i)=>(x-mean[i])/scale[i])),training_case_ids:points.map((_,i)=>`train-${i}`),input_scaler:{mean,scale},regressors:{response:{length_scale:Array(d).fill(1),dual_coefficients:Array(n).fill(0),constant_value:1,output_mean:options.output??0,output_scale:1,white_noise_level:.25,alpha:1e-10}}}};
  for(const key of ['model_sha256','bundle_sha256','dataset_sha256','profile_sha256','native_model_sha256'])b[key]='a'.repeat(64);
  return b;
}
const units=model=>Object.fromEntries(model.inputs.map(s=>[s.id,s.unit]));

test('all 37 native coordinates, 3 saved queries and 81 scenarios match frozen Python means',t=>{
  const m=prepareBrowserSurrogate(published);
  assert.equal(m.trace.model_sha256,reference.model_sha256);
  assert.equal(m.trace.bundle_sha256,reference.bundle_sha256);
  assert.equal(reference.records.length,121);
  assert.equal(reference.records.filter(r=>r.group==='training').length,20);
  assert.equal(reference.records.filter(r=>r.group==='holdout').length,3);
  assert.equal(reference.records.filter(r=>r.group==='verification').length,14);
  let maxAbsolute=0,maxRelative=0;
  for(const row of reference.records){
    const result=m.predict(row.inputs,reference.units);
    for(const [id,expected] of Object.entries(row.outputs)){
      const difference=Math.abs(result.outputs[id]-expected);
      maxAbsolute=Math.max(maxAbsolute,difference);maxRelative=Math.max(maxRelative,difference/Math.abs(expected));
      assert.ok(difference<=1e-9+1e-10*Math.abs(expected),`${row.group}/${row.id}/${id}: ${result.outputs[id]} vs ${expected}`);
    }
    assert.equal(result.native_execution_performed,false);
    assert.equal(result.model_refitted,false);
    assert.equal(result.uncertainty_estimated,false);
    assert.equal(result.independently_authenticated,false);
    assert.equal(result.physical_validation,false);
  }
  t.diagnostic(`363 scalar means: maximum absolute difference ${maxAbsolute}; relative ${maxRelative}`);
});

test('one-dimensional support, exact native units and white kernel excluded at training coordinates',()=>{
  const b=synthetic([[0],[1]],{output:2});
  b.model.regressors.response.dual_coefficients=[1,0];
  const m=prepareBrowserSurrogate(b),u=units(m);
  assert.equal(m.defaults.x,.5);
  assert.equal(m.predict({x:0},u).outputs.response,3);
  const expected=2+(1+Math.sqrt(5)+5/3)*Math.exp(-Math.sqrt(5));
  assert.ok(Math.abs(m.predict({x:.5},u).outputs.response-expected)<1e-14);
  assert.throws(()=>m.predict({x:-.1},u),code('outside_hull'));
  assert.throws(()=>m.predict({x:3},u),code('outside_bounds'));
  assert.throws(()=>m.predict({x:.5},{x:'1'}),code('unit_mismatch'));
  assert.throws(()=>m.predict({x:.5}),code('unit_mismatch'));
  assert.doesNotThrow(()=>m.predict({x:-2e-11},u));
  assert.throws(()=>m.predict({x:-2e-9},u),code('outside_hull'));
});

test('triangle gate rejects inside-box points outside actual hull and accepts edges/vertices',()=>{
  const m=prepareBrowserSurrogate(synthetic([[0,0],[1,0],[0,1]])),u=units(m);
  for(const values of [{x:0,y:0},{x:1,y:0},{x:0,y:1},{x:.5,y:.5},{x:.2,y:.3}])assert.equal(m.predict(values,u).outputs.response,0);
  assert.throws(()=>m.predict({x:.8,y:.8},u),code('outside_hull'));
  assert.throws(()=>m.predict({x:1.1,y:0},u),code('outside_hull'));
  assert.throws(()=>m.predict({x:3,y:0},u),code('outside_bounds'));
  assert.doesNotThrow(()=>m.predict({x:.5+1e-9,y:.5+1e-9},u));
  assert.throws(()=>m.predict({x:.5+1e-6,y:.5+1e-6},u),code('outside_hull'));
});

test('invalid query shape, nonfinite numbers and unknown units fail closed',()=>{
  const m=prepareBrowserSurrogate(synthetic([[0],[1]])),u=units(m);
  for(const value of [null,[],{}, {x:NaN},{x:Infinity},{x:'0.5'},{x:.5,extra:1}])assert.throws(()=>m.predict(value,u),code('invalid_input'));
  for(const unit of [null,[],{}, {x:'',extra:'m'},{x:1}])assert.throws(()=>m.predict({x:.5},unit),code('unit_mismatch'));
});

test('zero and signed means remain valid; disallowed negatives and overflow are never clipped',()=>{
  for(const [value,domain] of [[0,'nonnegative'],[-2,'signed']]){
    const m=prepareBrowserSurrogate(synthetic([[0],[1]],{output:value,domain}));
    assert.equal(m.predict({x:.5},units(m)).outputs.response,value);
  }
  for(const [value,domain] of [[0,'positive'],[-1,'nonnegative']]){
    const m=prepareBrowserSurrogate(synthetic([[0],[1]],{output:value,domain}));
    assert.throws(()=>m.predict({x:.5},units(m)),code('invalid_response'));
  }
  const b=synthetic([[0],[1]]);b.model.regressors.response.dual_coefficients=[1e308,1e308];b.model.regressors.response.constant_value=1e308;
  const m=prepareBrowserSurrogate(b);assert.throws(()=>m.predict({x:.5},units(m)),code('invalid_response'));
});

test('unqualified metadata, wrong family, unsupported dimensions, malformed posterior are rejected',()=>{
  for(const change of [b=>b.prediction_enabled=false,b=>b.validation.passed=false,b=>b.evidence_type='offline_fixture',b=>b.status='exploratory_only']){
    const b=clone(published);change(b);assert.throws(()=>prepareBrowserSurrogate(b),code('unqualified_bundle'));
  }
  for(const change of [b=>b.model.family='rbf',b=>b.model.inputs[0]=null,b=>b.model.regressors=null,b=>b.model.input_scaler.mean[0]=Infinity,b=>b.model.input_scaler.scale[0]*=2,b=>b.model.training_inputs_scaled[0][0]+=.1,b=>b.model.regressors[b.model.responses[0].id].dual_coefficients.pop(),b=>b.model.regressors[b.model.responses[0].id].length_scale[0]=0,b=>b.model.training_case_ids[1]=b.model.training_case_ids[0],b=>b.dataset_metadata.inputs[0].unit='C',b=>b.model_sha256='missing',b=>b.model.training_inputs_raw=Array(501).fill([0,0])]){
    const b=clone(published);change(b);assert.throws(()=>prepareBrowserSurrogate(b),code('invalid_model'));
  }
  for(const b of [null,[],{},synthetic([[0,0,0],[1,1,1]]),synthetic([[0,0],[1,1],[.5,.5]])])assert.throws(()=>prepareBrowserSurrogate(b),code('invalid_model'));
});

test('prepared posterior is independent of subsequent caller mutations',()=>{
  const b=clone(published),m=prepareBrowserSurrogate(b),expected=m.predict(m.defaults,units(m));
  b.model.training_inputs_scaled[0][0]+=100;
  b.model.regressors[b.model.responses[0].id].dual_coefficients[0]=1e100;
  b.model.inputs[0].unit='C';b.model_sha256='b'.repeat(64);
  assert.deepEqual(m.predict(m.defaults,units(m)),expected);
  assert.ok(Object.isFrozen(m.inputs[0])&&Object.isFrozen(m.responses[0])&&Object.isFrozen(m.defaults));
});
