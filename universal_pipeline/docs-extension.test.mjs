import test from 'node:test';
import assert from 'node:assert/strict';
import {extensionSections} from '../analysis_web/docs-extension.mjs';

function fixture(){
  const definitions=[['purchased_energy_kWh_kg','kWh/kg',.01,.020050579607058316],['yield_fraction','1',.001,.013478220523189961],['impact:Climate change','kg CO2-eq/kg',.01,.018500884324931795]];
  const cohorts={};
  for(const [name,count] of [['legacy_holdout_3',3],['legacy_verification_2',2],['local_verification_8',8],['prospective_verification_4',4]]){
    cohorts[name]={expected:count,prospectively_reserved_for_v2:name==='prospective_verification_4',metrics:{}};
    for(const [key,unit,floor] of definitions)cohorts[name].metrics[key]={unit,expected:count,criterion:.05,relative_floor:floor,complete:true,mae:.01,rmse:.02,max_relative_error:.06,passed:false};
  }
  return {
    summary:{version:'v2-extension',unique_native_cases:37,accepted_unique_cases:37,native_runs_retained:38,counts:{training:20,holdout:3,verification:14},prediction_enabled:false,validation_passed:false,exploratory:true,fit_attempts:1,criteria_changed:false,original_splits_changed:false,old_files_unchanged:true,physical_validation:false,model_sha256:'test-only',baseline_model_sha256:'v1-test-only'},
    cohort_evaluation:{model_sha256:'test-only',prediction_enabled:false,cohorts},
    local_comparison:{model_sha256:'v1-test-only',new_eight:{expected:8,valid_pairs:8,complete:true,metrics:Object.fromEntries(definitions.map(([key,unit,,error])=>[key,{unit,max_relative_error:error}]))},model_refitted:false,model_qualification_changed:false,center_repeat:{original_point_id:'case-008',metrics:Object.fromEntries(definitions.map(([key])=>[key,{original:1,repeated:1,absolute_difference:0}]))}}
  };
}

test('no unreviewed v2 content or pending placeholder is emitted',()=>{
  assert.equal(extensionSections(null),'');assert.equal(extensionSections(undefined,true),'');
});

test('both languages retain local-v1 and separate v2 cohort scopes',()=>{
  const evidence=fixture();const en=extensionSections(evidence);const zh=extensionSections(evidence,true);
  assert.deepEqual([...en.matchAll(/<h2 id="([^"]+)"/g)].map(m=>m[1]),['pilot-local','pilot-v2']);
  assert.deepEqual([...zh.matchAll(/<h2 id="([^"]+)"/g)].map(m=>m[1]),['pilot-local','pilot-v2']);
  for(const html of [en,zh]){
    assert.equal((html.match(/<tbody>(.*?)<\/tbody>/s)[1].match(/<tr>/g)||[]).length,12);
    for(const value of ['2.005058%','1.347822%','1.850088%','6.000000%'])assert.ok(html.includes(value));
    assert.match(html,/<details><summary>/);assert.match(html,/data\/generic-htl-extension\/index.json/);
  }
  assert.match(en,/38 execution records/);assert.match(en,/Ordinary prediction remains disabled/);
  assert.match(en,/not fresh independent tests/);assert.match(en,/not operating-performance thresholds/);
  assert.match(zh,/4 个全新前瞻复核点/);assert.match(zh,/复核针对冻结 v1/);
});

test('invalid counts, model identity, floors or scope cannot produce publishable copy',()=>{
  const mutations=[e=>e.summary.accepted_unique_cases=36,e=>e.cohort_evaluation.model_sha256='other',
    e=>e.summary.physical_validation=true,e=>e.summary.prediction_enabled=true,
    e=>e.cohort_evaluation.cohorts.local_verification_8.prospectively_reserved_for_v2=true,
    e=>e.cohort_evaluation.cohorts.prospective_verification_4.metrics.yield_fraction.relative_floor=.01];
  for(const mutate of mutations){const evidence=fixture();mutate(evidence);assert.throws(()=>extensionSections(evidence),/Extension documentation/);}
});

test('incomplete response remains visibly incomplete instead of a numeric success',()=>{
  const evidence=fixture();const metric=evidence.cohort_evaluation.cohorts.prospective_verification_4.metrics.yield_fraction;
  Object.assign(metric,{complete:false,mae:null,rmse:null,max_relative_error:null,passed:false});
  assert.match(extensionSections(evidence),/<td>—<\/td><td>—<\/td><td>—<\/td><td>Incomplete<\/td>/);
  assert.match(extensionSections(evidence,true),/<td>不完整<\/td>/);
});
