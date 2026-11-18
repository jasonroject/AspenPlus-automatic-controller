import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readSession,writeSession,referenceLink,validateWorkspaceShape,validateScanAudit,SESSION_KEY} from '../analysis_web/workspace-session.mjs';
const native=JSON.parse(await readFile(new URL('../analysis_web/data/universal-htl.json',import.meta.url),'utf8'));
test('tab session retains applied inputs and unapplied JSON separately',()=>{
  const values=new Map(),storage={setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)};
  assert.ok(writeSession(storage,{project:native,draft:'{"unfinished":',activeTab:'import',calculated:false}));
  const restored=readSession(storage);assert.deepEqual(restored.project,native);assert.equal(restored.draft,'{"unfinished":');assert.equal(restored.calculated,false);
  values.set(SESSION_KEY,'bad');assert.equal(readSession(storage),null);
  assert.equal(writeSession({setItem(){throw new Error('quota');}},{project:native}),false);
});
test('prediction handoff recognizes full native fixture and rejects edited evidence',()=>{
  const shuffled=Object.fromEntries(Object.entries(native).reverse());
  assert.equal(referenceLink(shuffled,native).matches,true);
  assert.match(referenceLink(native,native).href,/temperature=325&length=8.5&scenario=HR/);
  for(const alter of [p=>p.inventory[0].amount++,p=>p.factors[0].value++,p=>p.meta.boundary='Changed',p=>p.blocks[0].power++]){
    const changed=structuredClone(native);alter(changed);assert.equal(referenceLink(changed,native).matches,false);
  }
  assert.equal(referenceLink(native,null).matches,false);
});

test('failed session updates discard an older snapshot instead of restoring stale results',()=>{
  const values=new Map([[SESSION_KEY,JSON.stringify({version:1,project:native,calculated:true})]]);
  const storage={getItem:key=>values.get(key),setItem(){throw new Error('Quota exceeded');},removeItem:key=>values.delete(key)};
  const changed=structuredClone(native);changed.inventory[0].amount+=1;
  assert.equal(writeSession(storage,{project:changed,calculated:false,draft:''}),false);
  assert.equal(values.has(SESSION_KEY),false);assert.equal(readSession(storage),null);
});

test('session reader rejects missing metadata and preserves an empty unapplied draft',()=>{
  const storage={getItem:()=>JSON.stringify({version:1,project:{...native,meta:null}})};
  assert.equal(readSession(storage),null);
  const values=new Map(),valid={setItem:(key,value)=>values.set(key,value),getItem:key=>values.get(key)};
  assert.equal(writeSession(valid,{project:native,calculated:false,draft:''}),true);
  const restored=readSession(valid);assert.equal(restored.draft,'');assert.equal(restored.calculated,false);
});

test('workspace imports and restore reject metadata or editable cells that could crash rendering',()=>{
  const edits=[p=>p.meta='not an object',p=>p.meta=[],p=>p.meta.name={toString:{}},p=>p.meta.calorie_J={},
    p=>p.meta.native_warnings=[{}],p=>p.cases[0]=null,p=>p.streams[0]=[],p=>p.inventory[0].amount={toString:{}}];
  for(const edit of edits){
    const project=structuredClone(native);edit(project);
    assert.throws(()=>validateWorkspaceShape(project));
    assert.equal(readSession({getItem:()=>JSON.stringify({version:1,project,calculated:true})}),null);
  }
});

test('shape validation preserves incomplete numeric rows, metadata provenance and pending drafts for correction',()=>{
  const project=structuredClone(native);project.cases[0].product_rate='unfinished';project.cases[0].id='';project.blocks.push({});
  project.meta.scan_audit={omitted_failed_cases:['failed-1'],details:{source:'retained'}};project.meta.native_warnings=['offline fixture'];
  assert.equal(validateWorkspaceShape(project),project);
  const state={version:1,project,calculated:false,draft:'{',activeTab:'import'};
  const restored=readSession({getItem:()=>JSON.stringify(state)});
  assert.equal(restored.project.cases[0].product_rate,'unfinished');assert.deepEqual(restored.project.blocks.at(-1),{});
  assert.deepEqual(restored.project.meta.scan_audit,project.meta.scan_audit);assert.equal(restored.draft,'{');
});

test('malformed staging or draft containers cannot crash session recovery or reveal stale results',()=>{
  for(const extra of [{sheets:'invalid'},{sheets:[null]},{sheets:[{name:'Cases',rows:{}}]},{sheets:[{name:'Cases',rows:[['id'],[{toString:{}}]]}]},{applied:{}},{mappings:{}},{weights:{}},{draft:{}},{header:{toString:{}}}]){
    assert.equal(readSession({getItem:()=>JSON.stringify({version:1,project:native,calculated:true,...extra})}),null);
  }
  const staged={version:1,project:native,calculated:false,draft:'',sheets:[{name:'Cases',rows:[['id','product_rate'],['case-1','unfinished']]}],applied:[],header:'0',reviewedHeader:['id','product_rate'],mappings:[{field:'id',column:'0',constant:''}],weights:['','','']};
  const restored=readSession({getItem:()=>JSON.stringify(staged)});assert.equal(restored.header,'0');assert.equal(restored.draft,'');assert.equal(restored.sheets[0].rows[1][1],'unfinished');
});

test('scan-audit display contract rejects malformed rows before import or restoration',()=>{
  for(const audit of ['invalid',[],{cases:{}},{cases:[null]},{cases:[[]]},
    {cases:[{id:{toString:{}}}]},{cases:[{error:['failed']}]},{cases:[{gates:null}]},
    {cases:[{gates:{solver_accepted:'true'}}]},{cases:[{accepted:1}]},{planned:-1}]){
    assert.throws(()=>validateScanAudit(audit),/Scan audit/);
    const project={...native,meta:{...native.meta,scan_audit:audit}};
    assert.throws(()=>validateWorkspaceShape(project),/Scan audit/);
    assert.equal(readSession({getItem:()=>JSON.stringify({version:1,project})}),null);
  }
});

test('valid runner ledger preserves failed rows, null errors and source lineage without certification',()=>{
  const audit={planned:2,attempted:2,accepted:1,failed:1,source_profile_sha256:'a'.repeat(64),ledger:'ledger.json',cases:[
    {id:'accepted',split:'training',accepted:true,error:null,source:'runs/accepted/raw.json',gates:{control_succeeded:true,solver_accepted:true,numerical_closure:true,lcia_complete:true,metric_inputs_complete:true}},
    {id:'failed',split:'holdout',accepted:false,error:'Solver rejected',source:'runs/failed/raw.json',gates:{control_succeeded:true,solver_accepted:false,numerical_closure:false,lcia_complete:false,metric_inputs_complete:false}}
  ]};
  const before=structuredClone(audit),project={...native,meta:{...native.meta,scan_audit:audit}};
  assert.equal(validateScanAudit(audit),audit);assert.equal(validateWorkspaceShape(project),project);
  assert.deepEqual(audit,before);assert.equal(audit.cases.length,2);assert.equal(audit.cases[1].accepted,false);
  assert.equal(validateScanAudit(undefined),undefined);assert.equal(validateScanAudit(null),null);
  assert.equal(validateWorkspaceShape(native),native);
});

test('excessively nested imported metadata cannot crash or establish the native prediction handoff',()=>{
  const project=structuredClone(native);project.extra=JSON.parse('['.repeat(10000)+'0'+']'.repeat(10000));
  assert.equal(validateWorkspaceShape(project),project);
  const link=referenceLink(project,native);assert.equal(link.matches,false);assert.equal(link.href,'pipeline.html?from=import');
});
