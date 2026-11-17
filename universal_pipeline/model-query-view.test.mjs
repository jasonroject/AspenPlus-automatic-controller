import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createModelQueryState,modelQueryHTML,handleModelQueryEvent,modelQueryExport} from '../analysis_web/model-query-view.mjs';
import {inspectArtifact} from '../analysis_web/model-artifact-data.mjs';
import {setLanguage} from '../analysis_web/i18n.mjs';
const bytes=await readFile(new URL('../analysis_web/data/generic-htl-extension/model.bundle.json',import.meta.url));
const bundle=JSON.parse(bytes),trust={trustedV2:true,sourcePath:'data/generic-htl-extension/model.bundle.json',sourceSha256:createHash('sha256').update(bytes).digest('hex')};
const create=()=>createModelQueryState(bundle,trust);
function panel(){
  const status={textContent:'',setAttribute(key,value){this[key]=value;}},results={innerHTML:''},save={disabled:true};
  return {isConnected:true,status,results,save,querySelector(selector){return {'[data-model-query-status]':status,'[data-model-query-results]':results,'[data-model-query-action="save"]':save}[selector];}};
}
function action(state,root,kind,options={}){
  const button={disabled:false,dataset:{modelQueryAction:kind}};
  return handleModelQueryEvent({type:'click',target:{closest:selector=>selector==='[data-model-query]'?root:selector==='[data-model-query-action]'?button:null}},state,options);
}
function edit(state,root,id,value){return handleModelQueryEvent({type:'input',target:{dataset:{modelQueryInput:id},value,closest:selector=>selector==='[data-model-query]'?root:null}},state);}

test('query UI is absent for uploads, non-v2 paths and missing explicit byte trust',()=>{
  for(const credentials of [{},{...trust,trustedV2:false},{...trust,sourcePath:'local-model.bundle.json'},{...trust,sourcePath:'data/generic-htl-pilot/model.bundle.json'},{...trust,sourceSha256:''}]){
    const state=createModelQueryState(bundle,credentials);assert.equal(state,null);assert.equal(modelQueryHTML(state),'');
  }
  assert.equal(handleModelQueryEvent({},null),false);
});

test('the public v2 query starts at readable training means with explicit native units and no fabricated output',()=>{
  const state=create();
  assert.deepEqual(state.values,{reactor_temperature_K:'604.95',tube_length_m:'12.4'});
  state.model.inputs.forEach((input,index)=>assert.ok(Math.abs(Number(state.values[input.id])-bundle.model.input_scaler.mean[index])<1e-10));
  assert.deepEqual(state.model.inputs.map(input=>input.unit),['K','meter']);assert.equal(state.result,null);
  const html=modelQueryHTML(state);assert.match(html,/data-artifact-query/);assert.match(html,/temperature is kelvin/);assert.match(html,/data-model-query-action="save" disabled/);
  assert.doesNotMatch(html,/<dl class="model-query-metrics">/);assert.throws(()=>modelQueryExport(state));
});

test('an input edit immediately clears a computed estimate and disables export without changing the entered value',()=>{
  const state=create(),root=panel();assert.equal(action(state,root,'calculate'),true);assert.ok(state.result);assert.equal(root.save.disabled,false);
  assert.match(root.results.innerHTML,/Purchased energy/);assert.match(root.results.innerHTML,/kg CO2-eq\/kg/);
  edit(state,root,'reactor_temperature_K','601.2500');assert.equal(state.values.reactor_temperature_K,'601.2500');assert.equal(state.result,null);
  assert.equal(root.results.innerHTML,'');assert.equal(root.save.disabled,true);assert.match(root.status.textContent,/Inputs changed/);assert.throws(()=>modelQueryExport(state));
  action(state,root,'calculate');assert.equal(state.result.inputs.reactor_temperature_K,601.25);
});

test('invalid and unsupported conditions retain input text and never expose a previous estimate',()=>{
  const state=create(),root=panel();action(state,root,'calculate');
  for(const value of ['', 'not-a-number','700']){
    edit(state,root,'reactor_temperature_K',value);action(state,root,'calculate');
    assert.equal(state.values.reactor_temperature_K,value);assert.equal(state.result,null);assert.equal(root.results.innerHTML,'');assert.equal(root.save.disabled,true);assert.equal(root.status.role,'alert');
  }
  edit(state,root,'reactor_temperature_K','600');const model=state.model;
  state.model={...model,predict(){const error=new Error('Outside a nonrectangular training support');error.code='outside_hull';throw error;}};
  action(state,root,'calculate');assert.equal(state.values.reactor_temperature_K,'600');assert.equal(state.result,null);assert.match(root.status.textContent,/outside the actual training domain/);
});

test('language rendering keeps input precision and result values while exposing the parent-preserved disclosure key',()=>{
  const state=create(),root=panel();edit(state,root,'tube_length_m','12.5000');action(state,root,'calculate');const before=structuredClone(state.result);
  try{
    setLanguage('zh');const zh=modelQueryHTML(state);assert.match(zh,/试算一个工况/);assert.match(zh,/value="12.5000"/);assert.match(zh,/data-artifact-query/);assert.match(zh,/购入能量/);
    setLanguage('en');const en=modelQueryHTML(state);assert.match(en,/Try a condition/);assert.deepEqual(state.result,before);assert.equal(state.values.tube_length_m,'12.5000');
  }finally{setLanguage('en');}
});

test('saved JSON roundtrips through the viewer with exact means, units and model/source identity, without a native-run claim',()=>{
  const state=create(),root=panel();action(state,root,'calculate');const result=structuredClone(state.result);let saved;
  action(state,root,'save',{download:(name,text,mime)=>{saved={name,mime,value:JSON.parse(text)};}});
  assert.equal(saved.mime,'application/json;charset=utf-8');assert.match(saved.name,/\.json$/);
  assert.deepEqual(saved.value.records[0].inputs,result.inputs);assert.deepEqual(saved.value.records[0].outputs,result.outputs);
  assert.deepEqual(saved.value.records[0].units,result.units);assert.deepEqual(saved.value.records[0].input_units,{reactor_temperature_K:'K',tube_length_m:'meter'});
  assert.deepEqual(saved.value.dataset_metadata,bundle.dataset_metadata);assert.equal(saved.value.exploratory,false);
  assert.equal(saved.value.source_file.sha256,trust.sourceSha256);assert.equal(saved.value.model_sha256,bundle.model_sha256);assert.equal(saved.value.bundle_sha256,bundle.bundle_sha256);
  assert.equal(saved.value.native_execution_performed,false);assert.equal(saved.value.physical_validation,false);
  const imported=inspectArtifact(saved.value);assert.equal(imported.validCount,1);assert.equal(imported.evidence,'browser_surrogate_prediction');assert.equal(imported.independentlyVerified,false);
  assert.equal(createModelQueryState(saved.value,{}),null);
  state.values.tube_length_m='13';assert.throws(()=>modelQueryExport(state),/Inputs changed/);
});

test('detached or unrelated controls cannot calculate or download an old query',()=>{
  const state=create(),root=panel();root.isConnected=false;assert.equal(action(state,root,'calculate'),true);assert.equal(state.result,null);
  assert.equal(handleModelQueryEvent({type:'click',target:{closest:()=>null}},state),false);
});
