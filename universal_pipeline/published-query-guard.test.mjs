import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {inspectArtifactExampleIndex,verifyPublishedQueryBundle,mountModelArtifacts} from '../analysis_web/model-artifacts.mjs';

const raw=new Uint8Array(await readFile(new URL('../analysis_web/data/generic-htl-extension/model.bundle.json',import.meta.url)));
const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
const v2Manifest=JSON.parse(await readFile(new URL('../analysis_web/data/generic-htl-extension/index.json',import.meta.url),'utf8'));
const v1Manifest=JSON.parse(await readFile(new URL('../analysis_web/data/generic-htl-pilot/index.json',import.meta.url),'utf8'));
const source={version:'v2',file:'model.bundle.json'};
const indexes=()=>({v1:inspectArtifactExampleIndex(v1Manifest,'v1'),v2:inspectArtifactExampleIndex(v2Manifest,'v2')});
const encode=value=>new TextEncoder().encode(value);
const exactDigest=await webcrypto.subtle.digest('SHA-256',raw);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

class Container{
  constructor(){this.listeners=new Map();this.controls={innerHTML:''};this.select={tagName:'SELECT'};this.message={hidden:true,textContent:''};this.view={innerHTML:'',replaceChildren(){this.innerHTML='';}};}
  querySelector(selector){return {'#artifact-example-controls':this.controls,'#artifact-example-version':this.select,'#artifact-message':this.message,'#artifact-view':this.view}[selector]||null;}
  addEventListener(type,fn){this.listeners.set(type,fn);}removeEventListener(type){this.listeners.delete(type);}
  changeVersion(value){return this.listeners.get('change')({target:{id:'artifact-example-version',value}});}
  loadLocal(){return this.listeners.get('change')({target:{id:'artifact-file',files:[{name:'model.bundle.json',size:raw.byteLength,text:async()=>text}]}});}
  click(){const button={disabled:false,dataset:{artifactExample:'data/generic-htl-extension/model.bundle.json'}};return this.listeners.get('click')({target:{closest:selector=>selector==='[data-artifact-example]'?button:null}});}
}

test('only exact published v2 byte content passes its manifest identity',async()=>{
  const expected=v2Manifest.files['model.bundle.json'],index=indexes();
  assert.equal(index.v2.modelBundleBytes,raw.byteLength);
  assert.equal(index.v2.modelBundleSha256,expected.sha256.toLowerCase());
  assert.equal(await verifyPublishedQueryBundle(raw,source,index,webcrypto.subtle),true);
  // The digest must use the view, not unrelated bytes in its backing buffer.
  const padded=new Uint8Array(raw.byteLength+4);padded.set(raw,2);
  assert.equal(await verifyPublishedQueryBundle(padded.subarray(2,-2),source,index,webcrypto.subtle),true);
  assert.equal(await verifyPublishedQueryBundle(raw.buffer,source,index,webcrypto.subtle),false);
  assert.equal(await verifyPublishedQueryBundle(text,source,index,webcrypto.subtle),false);
});

test('format changes, same-length numeric edits and wrong manifest size or digest fail closed',async()=>{
  assert.ok(text.includes('\r\n'));
  const numerical=text.replace('583.15','583.16');assert.notEqual(numerical,text);assert.equal(encode(numerical).byteLength,raw.byteLength);
  for(const changed of [encode(text.replaceAll('\r\n','\n')),encode(JSON.stringify(JSON.parse(text))),encode(numerical),encode(text+' ')]){
    assert.equal(await verifyPublishedQueryBundle(changed,source,indexes(),webcrypto.subtle),false);
  }
  for(const patch of [{modelBundleBytes:raw.byteLength+1},{modelBundleSha256:'0'.repeat(64)}]){
    const index=indexes();Object.assign(index.v2,patch);
    assert.equal(await verifyPublishedQueryBundle(raw,source,index,webcrypto.subtle),false);
  }
});

test('a stripped UTF-8 BOM cannot make altered network bytes pass',async()=>{
  const bom=new Uint8Array(raw.byteLength+3);bom.set([0xef,0xbb,0xbf]);bom.set(raw,3);
  // This demonstrates why Response.text() followed by TextEncoder is insufficient.
  assert.equal(await new Response(bom).text(),text);
  assert.equal(await verifyPublishedQueryBundle(bom,source,indexes(),webcrypto.subtle),false);
  const sizeAdjusted=indexes();sizeAdjusted.v2.modelBundleBytes=bom.byteLength;
  assert.equal(await verifyPublishedQueryBundle(bom,source,sizeAdjusted,webcrypto.subtle),false);
});

test('local files, v1 and non-bundle artifacts cannot gain query permission from matching bytes',async()=>{
  for(const origin of [undefined,{name:'model.bundle.json'},{name:'v2 model.bundle.json'},
    {version:'v1',file:'model.bundle.json'},{version:'v2',file:'predictions.json'},
    {version:'v2',file:'robustness.json'},{version:'v2',file:'../model.bundle.json'}]){
    assert.equal(await verifyPublishedQueryBundle(raw,origin,indexes(),webcrypto.subtle),false);
  }
});

test('missing qualification or unavailable/rejected Web Crypto never falls back to unverified execution',async()=>{
  for(const patch of [{predictionEnabled:false,exploratory:true},{predictionEnabled:true,exploratory:true}]){
    const index=indexes();Object.assign(index.v2,patch);
    assert.equal(await verifyPublishedQueryBundle(raw,source,index,webcrypto.subtle),false);
  }
  assert.equal(await verifyPublishedQueryBundle(raw,source,{},webcrypto.subtle),false);
  assert.equal(await verifyPublishedQueryBundle(raw,source,indexes(),null),false);
  assert.equal(await verifyPublishedQueryBundle(raw,source,indexes(),{digest:async()=>{throw new Error('Unavailable test provider');}}),false);
  assert.equal(await verifyPublishedQueryBundle(raw,source,indexes(),{digest:async()=>new ArrayBuffer(0)}),false);
});

test('public loader verifies original bytes, while an identical local file stays view-only',async()=>{
  const oldFetch=globalThis.fetch,cryptoDescriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  const container=new Container(),state={exampleVersion:'v2',exampleIndexes:indexes()};let cleanup;
  try{
    Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto});
    globalThis.fetch=async()=>new Response(raw);
    cleanup=mountModelArtifacts(container,state);await container.click();
    assert.equal(state.verifiedExampleBytes,true);assert.ok(state.artifact);
    await container.loadLocal();assert.equal(state.verifiedExampleBytes,false);assert.ok(state.artifact);
    assert.deepEqual(state.artifactSource,{name:'model.bundle.json'});
    const bom=new Uint8Array(raw.byteLength+3);bom.set([0xef,0xbb,0xbf]);bom.set(raw,3);
    globalThis.fetch=async()=>new Response(bom);await container.click();
    assert.equal(state.verifiedExampleBytes,false);
  }finally{cleanup?.();globalThis.fetch=oldFetch;if(cryptoDescriptor)Object.defineProperty(globalThis,'crypto',cryptoDescriptor);else delete globalThis.crypto;}
});

test('late digest completion cannot restore permission after version/local/index/lifecycle changes',async t=>{
  for(const mutation of ['version','local','index','unmount'])await t.test(mutation,async()=>{
    const oldFetch=globalThis.fetch,cryptoDescriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
    const container=new Container(),state={exampleVersion:'v2',exampleIndexes:indexes()},started=deferred(),finish=deferred();let cleanup,pending;
    try{
      Object.defineProperty(globalThis,'crypto',{configurable:true,value:{subtle:{digest:()=>{started.resolve();return finish.promise;}}}});
      globalThis.fetch=async()=>new Response(raw);
      cleanup=mountModelArtifacts(container,state);pending=container.click();await started.promise;
      assert.equal(state.verifiedExampleBytes,false);assert.equal(state.artifact,null);
      if(mutation==='version')await container.changeVersion('v1');
      if(mutation==='local')await container.loadLocal();
      if(mutation==='index')state.exampleIndexes.v2={...state.exampleIndexes.v2};
      if(mutation==='unmount')cleanup();
      finish.resolve(exactDigest);await pending;
      assert.equal(state.verifiedExampleBytes,false);
      if(mutation==='version'||mutation==='unmount')assert.equal(state.artifact,null);
      if(mutation==='local')assert.deepEqual(state.artifactSource,{name:'model.bundle.json'});
    }finally{finish.resolve(exactDigest);await pending;cleanup?.();globalThis.fetch=oldFetch;if(cryptoDescriptor)Object.defineProperty(globalThis,'crypto',cryptoDescriptor);else delete globalThis.crypto;}
  });
});
