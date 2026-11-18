import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectArtifact,artifactSeries,finiteDomain,domainFraction,domainTick,recordPage} from '../analysis_web/model-artifact-data.mjs';
import {artifactScatter,artifactViewHTML,mountModelArtifacts} from '../analysis_web/model-artifacts.mjs';

const copy=value=>structuredClone(value);
function fixture(){
  const inputs=[{id:'fraction',unit:''}],responses=[{id:'heat',unit:'kW'}];
  return {kind:'process_surrogate',bundle_version:1,model_sha256:'a'.repeat(64),profile_id:'fixture',evidence_type:'offline_fixture',prediction_enabled:true,
    dataset_metadata:{inputs,responses},observations:[{id:'train-0',split:'training',accepted:true,inputs:{fraction:0},outputs:{heat:0},errors:[]}],
    validation:{splits:{holdout:{expected:1,valid:1,metrics:{heat:{mae:0,rmse:0,unit:'kW',passed:true}}}},reasons:[],records:[{id:'held-0',split:'holdout',constraints_passed:true,actual:{heat:-2},predicted:{heat:-2},errors:[]}]}};
}

test('real offline bundle and predictions remain displayable without becoming verified native evidence',async()=>{
  const directory=new URL('./fixtures/',import.meta.url);
  const bundle=inspectArtifact(JSON.parse(await readFile(new URL('surrogate-demo.bundle.json',directory),'utf8')));
  const predictions=inspectArtifact(JSON.parse(await readFile(new URL('surrogate-demo.predictions.json',directory),'utf8')));
  assert.equal(bundle.independentlyVerified,false);assert.equal(bundle.evidence,'offline_fixture');assert.equal(bundle.declaredEnabled,false);
  const actualHTML=artifactViewHTML(bundle,{});assert.match(actualHTML,/Synthetic arithmetic fixture; no Aspen run/);assert.match(actualHTML,/Fit warnings/);
  assert.equal(predictions.rows.length,3);assert.equal(predictions.failedCount,1);
  const series=artifactSeries(bundle,'x','signed_heat');assert.ok(series.observations.some(point=>point.y<0));
  assert.ok(series.pairs.every(point=>['holdout','verification'].includes(point.split)));
  const zero=artifactSeries(bundle,'x','zero_impact');assert.ok(zero.observations.every(point=>point.y===0));
  const unverified=inspectArtifact(fixture());assert.equal(unverified.declaredEnabled,true);assert.equal(unverified.independentlyVerified,false);
  assert.match(artifactViewHTML(unverified,{}),/Producer declares prediction enabled \(unverified\)/);
});

test('training, unknown and failed validation records are retained but never plotted as held-out evidence',()=>{
  const raw=fixture();
  raw.validation.records.push({id:'training-leak',split:'training',constraints_passed:true,actual:{heat:3},predicted:{heat:3}},
    {id:'failed',split:'verification',constraints_passed:false,actual:{heat:-1},predicted:null,errors:['<solver failed>']},
    {id:'unknown',split:'mystery',constraints_passed:true,actual:{heat:5},predicted:{heat:5}});
  const artifact=inspectArtifact(raw),series=artifactSeries(artifact,'fraction','heat');
  assert.deepEqual(series.pairs.map(row=>row.id),['held-0']);assert.equal(artifact.pairs.length,4);assert.equal(artifact.failedPairCount,3);
  const html=artifactViewHTML(artifact,{});assert.match(html,/training-leak/);assert.match(html,/&lt;solver failed&gt;/);assert.ok(!html.includes('<solver failed>'));
  assert.match(html,/This group is not held-out or verification evidence/);
});

test('accounting basis is declared text only, escaped without guessing a product or boundary',()=>{
  const raw=fixture();raw.dataset_metadata.basis={functional_unit:'1 kg <declared product>',boundary:'Supplied boundary',allocation_method:null,enthalpy_basis:'Common reference',calorie_J:4.1868};
  const html=artifactViewHTML(inspectArtifact(raw),{});
  assert.match(html,/Accounting basis/);assert.match(html,/1 kg &lt;declared product&gt;/);assert.match(html,/Supplied boundary/);assert.match(html,/Not declared/);
  for(const basis of [[],42,{functional_unit:{}},{boundary:[]},{allocation_method:true},{enthalpy_basis:3},{calorie_J:Infinity}]){
    const invalid=fixture();invalid.dataset_metadata.basis=basis;assert.throws(()=>inspectArtifact(invalid),/Accounting basis/);
  }
  const empty=fixture();empty.dataset_metadata.basis=null;assert.match(artifactViewHTML(inspectArtifact(empty),{}),/inspect the matching profile or dataset/);
});

test('validation shows exported relative errors and unit-bound criteria without assuming an absent limit',()=>{
  const raw=fixture();raw.validation.splits.holdout.metrics.heat.max_relative_error=.057618388252806234;
  raw.validation.criteria={heat:{unit:'kW',max_relative_error:.05,relative_floor:.01}};
  const html=artifactViewHTML(inspectArtifact(raw),{});
  assert.match(html,/Maximum relative error/);assert.match(html,/Declared relative-error limit/);assert.match(html,/5\.761839%/);assert.match(html,/>5%</);assert.match(html,/0\.01 kW/);
  const missing=fixture();assert.ok(!artifactViewHTML(inspectArtifact(missing),{}).includes('>5%</'));
  const fallback=fixture();fallback.validation_policy=raw.validation.criteria;assert.equal(inspectArtifact(fallback).criteria.heat.relative_floor,.01);
  for(const criteria of [[],{heat:null},{heat:{unit:'MW',max_relative_error:.05,relative_floor:.01}},{heat:{unit:'kW',max_relative_error:Infinity,relative_floor:.01}},{heat:{unit:'kW',max_relative_error:.05}},{heat:{unit:'kW',relative_floor:0}}]){
    const invalid=fixture();invalid.validation.criteria=criteria;assert.throws(()=>inspectArtifact(invalid),/criteri|floor/i);
  }
});

test('malformed message arrays, summary shapes, unit mismatches and duplicate record IDs fail display validation',()=>{
  const cases=[raw=>raw.validation.splits.holdout=null,raw=>raw.validation.reasons={},raw=>raw.validation.records[0].errors={},
    raw=>raw.observations[0].source={url:'bad'},raw=>raw.observations[0].inputs=[],raw=>raw.dataset_metadata.responses=[null],
    raw=>raw.validation.splits.holdout.metrics.heat.unit='MW',raw=>raw.validation.splits.holdout.valid=2,
    raw=>raw.observations.push(copy(raw.observations[0])),raw=>raw.validation.records.push(copy(raw.validation.records[0]))];
  for(const change of cases){const raw=fixture();change(raw);assert.throws(()=>inspectArtifact(raw),error=>error instanceof Error&&!(error instanceof TypeError));}
  const inconsistent=fixture();inconsistent.observations[0].gates={control_succeeded:false};
  assert.equal(inspectArtifact(inconsistent).failedCount,1);
  const malformedNumber=fixture();malformedNumber.observations[0].outputs.heat={toString:{},valueOf:{}};
  assert.doesNotThrow(()=>artifactViewHTML(inspectArtifact(malformedNumber),{}));
  const malformedDigest=fixture();malformedDigest.model_sha256={toString:{}};
  assert.throws(()=>inspectArtifact(malformedDigest),/SHA-256/);
});

test('signed, zero, subnormal and huge finite data use finite SVG coordinates and preserve axis order',()=>{
  for(const values of [[0],[-5,-2,0,4],[-1e308,1e308],[Number.MAX_VALUE],[-Number.MAX_VALUE,Number.MAX_VALUE],[Number.MIN_VALUE],[-Number.MIN_VALUE,Number.MIN_VALUE]]){
    const domain=finiteDomain(values);assert.ok(domain.every(Number.isFinite));assert.ok(domain[0]<domain[1]);
    const fractions=values.map(value=>domainFraction(value,domain));assert.ok(fractions.every(value=>Number.isFinite(value)&&value>=0&&value<=1));
    for(const fraction of [0,.25,.5,.75,1])assert.ok(Number.isFinite(domainTick(domain,fraction)));
    const points=values.map((value,index)=>({id:String(index),split:'holdout',x:value,y:-value}));
    for(const parity of [true,false]){
      const html=artifactScatter(points,'Input','Heat / kW','Finite',parity);assert.ok(!/NaN|Infinity/.test(html));
      for(const match of html.matchAll(/(?:cx|cy)="([^"]+)"/g))assert.ok(Number.isFinite(Number(match[1])));
    }
  }
  assert.ok(domainFraction(-2,finiteDomain([-2,0,2]))<domainFraction(0,finiteDomain([-2,0,2])));
  assert.match(artifactScatter([],'x','y','Empty'),/No complete eligible records/);
});

test('both record and evaluation tables page through all retained failures, including beyond the former 100-row cutoff',()=>{
  const raw=fixture();raw.observations=Array.from({length:151},(_,index)=>({...copy(raw.observations[0]),id:`observation-${index}`}));
  raw.validation.records=Array.from({length:151},(_,index)=>({...copy(raw.validation.records[0]),id:`evaluation-${index}`,constraints_passed:index!==149,errors:index===149?['late failure']:[]}));
  const artifact=inspectArtifact(raw),state={page:2,pairPage:2},html=artifactViewHTML(artifact,state);
  assert.match(html,/evaluation-149/);assert.match(html,/late failure/);assert.match(html,/observation-149/);assert.match(html,/101–150 \/ 151/);
  assert.ok(!html.includes('<th data-no-i18n>evaluation-150'));assert.ok(!html.includes('First 100'));
  assert.equal(recordPage(artifact.pairs,99).page,3);assert.equal(recordPage(artifact.rows,-3).page,0);assert.equal(recordPage([],0).start,0);
  const visited=Array.from({length:4},(_,page)=>recordPage(artifact.pairs,page).rows).flat();assert.equal(visited.length,151);
  const container=new Container(),mounted={artifact,page:0,pairPage:0};mountModelArtifacts(container,mounted);
  const button={disabled:false,dataset:{artifactPage:'pairs',pageDirection:'1'}};
  container.listeners.get('click')({target:{closest:()=>button}});assert.equal(mounted.pairPage,1);assert.equal(mounted.page,0);assert.equal(container.details.open,true);
});

class Container {
  constructor(){this.listeners=new Map();this.message={textContent:'',hidden:true};this.view={innerHTML:'',replaceChildren(){this.innerHTML='';}};this.details={open:false};}
  querySelector(selector){return selector==='#artifact-message'?this.message:selector==='#artifact-view'?this.view:this.details;}
  addEventListener(type,listener){this.listeners.set(type,listener);}removeEventListener(type){this.listeners.delete(type);}
  change(file){return this.listeners.get('change')({target:{id:'artifact-file',files:file?[file]:[]}});}
}
const file=raw=>({size:100,text:async()=>JSON.stringify(raw)});
test('invalid or cancelled file selection clears previous results, and stale asynchronous reads cannot restore them',async()=>{
  const container=new Container(),state={artifact:inspectArtifact(fixture())},cleanup=mountModelArtifacts(container,state);
  const malformed=fixture();malformed.validation.reasons={};await container.change(file(malformed));
  assert.equal(state.artifact,null);assert.equal(container.view.innerHTML,'');assert.match(container.message.textContent,/list of text/);
  let resolveOld;const old=container.change({size:100,text:()=>new Promise(resolve=>{resolveOld=resolve;})});
  const newer=fixture();newer.profile_id='newest';await container.change(file(newer));
  resolveOld(JSON.stringify(fixture()));await old;assert.equal(state.artifact.profileId,'newest');
  await container.change(null);assert.equal(state.artifact,null);assert.equal(container.view.innerHTML,'');assert.match(container.message.textContent,/Previous results were cleared/);
  let resolveUnmounted;const pending=container.change({size:100,text:()=>new Promise(resolve=>{resolveUnmounted=resolve;})});cleanup();
  resolveUnmounted(JSON.stringify(fixture()));await pending;assert.equal(state.artifact,null);
});

test('a rendering failure also clears the artifact state and old view',async()=>{
  const container=new Container(),state={artifact:null};let html='';
  Object.defineProperty(container.view,'innerHTML',{get:()=>html,set:value=>{if(value.includes('render-failure'))throw new Error('Render failed');html=value;}});
  mountModelArtifacts(container,state);const raw=fixture();raw.profile_id='render-failure';await container.change(file(raw));
  assert.equal(state.artifact,null);assert.equal(container.view.innerHTML,'');assert.equal(container.message.textContent,'Render failed');
});
