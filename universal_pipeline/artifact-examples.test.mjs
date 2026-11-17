import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {artifactExamplePath,inspectArtifactExampleIndex,modelArtifactPanel,mountModelArtifacts} from '../analysis_web/model-artifacts.mjs';
import {setLanguage} from '../analysis_web/i18n.mjs';
const original=JSON.parse(await readFile(new URL('./fixtures/surrogate-demo.predictions.json',import.meta.url),'utf8'));
const v1=JSON.parse(await readFile(new URL('../analysis_web/data/generic-htl-pilot/index.json',import.meta.url),'utf8'));
// This is only a display-contract fixture, not a claim about the pending v2 run.
const v2={...structuredClone(v1),native_case_count:37,accepted_case_count:37,training_count:20,holdout_count:3,verification_count:14,prediction_enabled:true,exploratory:false};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const reply=data=>({ok:true,text:async()=>JSON.stringify(data)});
class Container{
  constructor(){this.listeners=new Map();this.controls={innerHTML:''};this.select={tagName:'SELECT'};this.message={hidden:true,textContent:''};this.view={innerHTML:'',replaceChildren(){this.innerHTML='';}};let filename='';this.file={id:'artifact-file',files:[],get value(){return filename;},set value(value){filename=value;if(!value)this.files=[];}};}
  querySelector(selector){return {'#artifact-example-controls':this.controls,'#artifact-example-version':this.select,'#artifact-message':this.message,'#artifact-view':this.view,'#artifact-file':this.file}[selector]||null;}
  addEventListener(type,fn){this.listeners.set(type,fn);}removeEventListener(type){this.listeners.delete(type);}
  change(value){return this.listeners.get('change')({target:{id:'artifact-example-version',value}});}
  click(version,file='predictions.json'){const button={disabled:false,dataset:{artifactExample:`data/generic-htl-${version==='v2'?'extension':'pilot'}/${file}`}};return this.listeners.get('click')({target:{closest:selector=>selector==='[data-artifact-example]'?button:null}});}
}

test('example URLs allow only the two fixed packages and four result/index filenames',()=>{
  for(const directory of ['pilot','extension'])for(const file of ['index.json','model.bundle.json','predictions.json','robustness.json'])assert.equal(artifactExamplePath(`data/generic-htl-${directory}/${file}`),`data/generic-htl-${directory}/${file}`);
  for(const path of ['data/generic-htl-extension/../generic-htl-pilot/model.bundle.json','data/generic-htl-extension/project.json','data/generic-htl-other/model.bundle.json','data/generic-htl-extension/%6dodel.bundle.json','data/generic-htl-extension/model.bundle.json#result','https://example.com/data/generic-htl-extension/model.bundle.json'])assert.throws(()=>artifactExamplePath(path));
});

test('qualification comes from a complete matching index, never the v2 version name',()=>{
  assert.equal(inspectArtifactExampleIndex(v1,'v1').predictionEnabled,false);
  assert.equal(inspectArtifactExampleIndex(v2,'v2').predictionEnabled,true);
  assert.equal(inspectArtifactExampleIndex({...v2,prediction_enabled:false,exploratory:true},'v2').predictionEnabled,false);
  for(const edit of [p=>p.accepted_case_count=36,p=>p.training_count=21,p=>p.holdout_count=2,p=>delete p.prediction_enabled,p=>p.exploratory=true,p=>p.physical_validation=true,p=>delete p.files['predictions.json'],p=>p.files['robustness.json'].bytes=Infinity,p=>p.files['model.bundle.json'].sha256='not-a-digest']){
    const index=structuredClone(v2);edit(index);assert.throws(()=>inspectArtifactExampleIndex(index,'v2'));
  }
  for(const version of ['v3','toString','__proto__'])assert.throws(()=>inspectArtifactExampleIndex(v2,version),error=>error instanceof Error&&!(error instanceof TypeError));
  const initial=modelArtifactPanel();assert.match(initial,/value="v2"[^>]*disabled/);assert.doesNotMatch(initial,/checks passed/);
});

test('unavailable extension index leaves v1 usable and never displays a passed qualification',async()=>{
  const old=globalThis.fetch,container=new Container(),state={};let cleanup;
  try{
    globalThis.fetch=async path=>path.includes('/generic-htl-pilot/')?reply(v1):{ok:false};
    cleanup=mountModelArtifacts(container,state);assert.match(container.controls.innerHTML,/No qualification status is established yet/);
    await flush();assert.equal(state.exampleVersion,'v1');assert.equal(state.exampleAvailability.v2,'unavailable');
    assert.match(container.controls.innerHTML,/Exploratory model/);assert.match(container.controls.innerHTML,/value="v2"[^>]*disabled/);
    assert.doesNotMatch(container.controls.innerHTML,/checks passed/);
    await container.change('v2');assert.equal(state.exampleVersion,'v1');
  }finally{cleanup?.();globalThis.fetch=old;}
});

test('available v2 becomes the initial default; explicit choices and language rerenders retain their version',async()=>{
  const oldFetch=globalThis.fetch,oldWindow=globalThis.window,listeners=new Map(),container=new Container(),state={};let cleanup;
  globalThis.window={addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)};
  try{
    globalThis.fetch=async path=>reply(path.includes('/generic-htl-extension/')?v2:v1);
    cleanup=mountModelArtifacts(container,state);await flush();assert.equal(state.exampleVersion,'v2');
    assert.match(container.controls.innerHTML,/Package declares.*checks passed/);
    await container.change('v1');setLanguage('zh');listeners.get('languagechange')();
    assert.equal(state.exampleVersion,'v1');assert.match(container.controls.innerHTML,/value="v1" selected/);assert.match(container.controls.innerHTML,/探索性模型/);
    cleanup();cleanup=mountModelArtifacts(container,state);assert.equal(state.exampleVersion,'v1');
  }finally{cleanup?.();setLanguage('en');globalThis.fetch=oldFetch;if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
});

test('switching versions aborts and clears the previous artifact; late responses cannot replace the named current result',async()=>{
  const old=globalThis.fetch,container=new Container(),state={exampleIndexes:{v1:inspectArtifactExampleIndex(v1,'v1'),v2:inspectArtifactExampleIndex(v2,'v2')}};let cleanup;
  try{
    cleanup=mountModelArtifacts(container,state);
    let resolveOld,oldSignal;globalThis.fetch=(_,options)=>{oldSignal=options.signal;return new Promise(resolve=>{resolveOld=resolve;});};
    const pending=container.click('v1');await container.change('v2');assert.equal(oldSignal.aborted,true);assert.equal(state.artifact,null);assert.equal(container.view.innerHTML,'');
    const newer=structuredClone(original);newer.profile_id='current-v2';globalThis.fetch=async()=>reply(newer);
    await container.click('v2');assert.equal(state.artifact.profileId,'current-v2');assert.match(container.view.innerHTML,/Loaded artifact.*v2 · 37 cases · Mean predictions/);
    resolveOld(reply(original));await pending;assert.equal(state.artifact.profileId,'current-v2');
    await container.change('v1');assert.equal(state.artifact,null);assert.equal(state.artifactSource,null);assert.equal(container.view.innerHTML,'');
    globalThis.fetch=async()=>({ok:false});await container.click('v1');assert.equal(state.artifact,null);assert.match(container.message.textContent,/unavailable/);
  }finally{cleanup?.();globalThis.fetch=old;}
});

test('late index discovery cannot switch a user-selected local result, and unmounted requests are cancelled',async()=>{
  const old=globalThis.fetch,container=new Container(),state={};let cleanup;
  try{
    const pending=[];globalThis.fetch=(path,options)=>new Promise(resolve=>pending.push({path,signal:options.signal,resolve}));
    cleanup=mountModelArtifacts(container,state);
    await container.listeners.get('change')({target:{id:'artifact-file',files:[{name:'my-local-result.json',size:1,text:async()=>JSON.stringify(original)}]}});
    pending.forEach(request=>request.resolve(reply(request.path.includes('/generic-htl-extension/')?v2:v1)));await flush();
    assert.equal(state.exampleVersion,'v1');assert.equal(state.artifact.profileId,original.profile_id);assert.match(container.view.innerHTML,/my-local-result.json/);
    cleanup();const abandoned=new Container(),next={};pending.length=0;cleanup=mountModelArtifacts(abandoned,next);cleanup();
    assert.ok(pending.every(request=>request.signal.aborted));pending.forEach(request=>request.resolve(reply(v2)));await flush();assert.equal(next.exampleIndexes.v2,undefined);
  }finally{cleanup?.();globalThis.fetch=old;}
});

test('accepted example navigation clears a stale upload name without clearing a local read or a language change',async()=>{
  const oldFetch=globalThis.fetch,oldWindow=globalThis.window,listeners=new Map(),container=new Container(),state={exampleIndexes:{v1:inspectArtifactExampleIndex(v1,'v1'),v2:inspectArtifactExampleIndex(v2,'v2')}};let cleanup;
  globalThis.window={addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)};
  try{
    cleanup=mountModelArtifacts(container,state);
    const select=read=>{container.file.value='C:\\fakepath\\local-result.json';container.file.files=[{name:'local-result.json',size:1,text:read}];return container.listeners.get('change')({type:'change',target:container.file});};
    let resolve;const pending=select(()=>new Promise(done=>{resolve=done;}));
    assert.equal(typeof resolve,'function');assert.match(container.file.value,/local-result.json$/);
    setLanguage('zh');listeners.get('languagechange')();assert.match(container.file.value,/local-result.json$/);
    resolve(JSON.stringify(original));await pending;assert.equal(state.artifactSource.name,'local-result.json');assert.match(container.file.value,/local-result.json$/);
    await container.change('v3');await container.change('v1');assert.match(container.file.value,/local-result.json$/);
    await container.change('v2');assert.equal(container.file.value,'');assert.equal(state.artifact,null);
    await select(async()=>JSON.stringify(original));assert.match(container.file.value,/local-result.json$/);
    globalThis.fetch=async()=>reply(original);await container.click('v2');assert.equal(container.file.value,'');assert.equal(state.artifactSource.version,'v2');
  }finally{cleanup?.();setLanguage('en');globalThis.fetch=oldFetch;if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
});
