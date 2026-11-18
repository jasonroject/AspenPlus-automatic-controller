import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {applyProjectEdit} from '../analysis_web/workspace-provenance.mjs';
import {validateWorkspaceShape,readSession} from '../analysis_web/workspace-session.mjs';
import {blankProject,assess} from '../analysis_web/universal-core.mjs';
const native=JSON.parse(await readFile(new URL('../analysis_web/data/generic-htl-pilot/project.json',import.meta.url),'utf8'));
const universalSource=await readFile(new URL('../analysis_web/universal.js',import.meta.url),'utf8');
const contextSource=universalSource.slice(universalSource.indexOf('function context('),universalSource.indexOf('function loadProject('));
function contextHarness(input){
  // Execute the actual browser wiring with only its form fields stubbed. This
  // catches representation changes introduced while saving/calculating, not
  // just the pure provenance helper's behavior.
  assert.match(contextSource,/^function context\(/);
  const fields=Object.fromEntries([['project-name','name'],['boundary','boundary'],['functional-unit','functional_unit'],['allocation-method','allocation_method'],['enthalpy-basis','enthalpy_basis']].map(([id,key])=>['#'+id,{value:String(input.meta[key]||'')} ]));
  fields['#calorie']={value:String(input.meta.calorie_J??'')};
  fields['#inventory-complete']={checked:input.meta.inventory_complete===true};fields['#comparable']={checked:input.meta.comparable_cases===true};
  const create=new Function('input','$','applyProjectEdit',`let project=structuredClone(input);${contextSource};return {run:()=>context(),get:()=>project};`);
  return {...create(input,key=>fields[key],applyProjectEdit),fields};
}

test('actual basis wiring preserves numeric-string calories and equal visible values across save/calculate reads',()=>{
  const input=structuredClone(native);input.meta.calorie_J='4.1868';input.meta.name='  Preserved original name  ';
  const form=contextHarness(input);form.run();form.run();assert.deepEqual(form.get(),input);
  form.fields['#calorie'].value='4.1868000';form.run();assert.deepEqual(form.get(),input);
  assert.equal(form.get().meta.locally_modified,undefined);assert.equal(form.get().meta.scan_audit.accepted,17);
});

test('actual basis wiring does not invent absent optional empty or false metadata',()=>{
  const input=structuredClone(native);
  for(const key of ['name','allocation_method','enthalpy_basis','calorie_J','inventory_complete','comparable_cases'])delete input.meta[key];
  const form=contextHarness(input);form.run();assert.deepEqual(form.get(),input);
  assert.equal(form.get().meta.locally_modified,undefined);assert.equal(form.get().meta.scan_audit.accepted,17);
});

test('actual changed basis values archive native checks once and repeated reads preserve that origin',()=>{
  const input=structuredClone(native);input.meta.calorie_J='4.1868';const form=contextHarness(input);
  form.fields['#calorie'].value='4.184';form.run();const changed=structuredClone(form.get());
  assert.equal(changed.meta.calorie_J,4.184);assert.equal(changed.meta.locally_modified,true);
  assert.equal(changed.meta.scan_audit,undefined);assert.equal(changed.meta.origin.scan_audit.accepted,17);
  form.run();assert.deepEqual(form.get(),changed);
  form.fields['#calorie'].value='';form.run();assert.equal(form.get().meta.calorie_J,null);
  assert.deepEqual(form.get().meta.origin,changed.meta.origin);
});

test('editing a native product rate archives the original run audit without certifying the edited inputs',()=>{
  const before=structuredClone(native),draft=structuredClone(native);draft.cases[0].product_rate=2.8;
  const changed=applyProjectEdit(native,draft);
  assert.equal(changed.meta.locally_modified,true);assert.equal(changed.meta.evidence_type,'locally_modified');
  assert.equal(changed.meta.physical_validation,false);assert.equal(changed.meta.scan_audit,undefined);
  assert.equal(changed.meta.source_sha256,undefined);assert.equal(changed.meta.model_profile_id,undefined);
  assert.deepEqual(changed.meta.origin.scan_audit,native.meta.scan_audit);
  assert.equal(changed.meta.origin.scan_audit.accepted,17);
  assert.equal(changed.meta.origin.evidence_type,'native_simulation');
  assert.equal(changed.meta.origin.source_sha256,native.meta.source_sha256);
  assert.equal(changed.meta.origin.scope,'historical_source_only');
  assert.deepEqual(native,before);assert.equal(draft.meta.locally_modified,undefined);
  assert.equal(changed.cases[0].product_rate,2.8);assert.equal(validateWorkspaceShape(changed),changed);
});

test('worksheet replacement retains all historical failed and accepted rows but none as active checks',()=>{
  const source=structuredClone(native);source.meta.scan_audit.cases.push({id:'failed-preserved',split:'verification',accepted:false,error:'Solver rejected',gates:{solver_accepted:false}});
  source.meta.native_warnings=['A native warning'];source.meta.omitted_failed_case_ids=['failed-preserved'];
  const next={...source,cases:[{id:'new-case',product_rate:'unfinished'}]};
  const changed=applyProjectEdit(source,next);
  assert.equal(changed.meta.scan_audit,undefined);assert.equal(changed.meta.native_warnings,undefined);
  assert.equal(changed.meta.omitted_failed_case_ids,undefined);
  assert.equal(changed.meta.origin.scan_audit.cases.at(-1).accepted,false);
  assert.deepEqual(changed.meta.origin.native_warnings,['A native warning']);
  assert.deepEqual(changed.meta.origin.omitted_failed_case_ids,['failed-preserved']);
  assert.equal(validateWorkspaceShape(changed),changed);
});

test('repeated applied edits retain one origin and cannot restore native claims through JSON editing',()=>{
  const first=applyProjectEdit(native,{...native,cases:[]}),next=structuredClone(first);
  next.meta.evidence_type='native_simulation';delete next.meta.locally_modified;
  next.meta.origin={source_sha256:'forged'};next.meta.scan_audit={accepted:100};next.meta.physical_validation=true;
  const second=applyProjectEdit(first,next);
  assert.equal(second.meta.evidence_type,'locally_modified');assert.equal(second.meta.physical_validation,false);
  assert.equal(second.meta.scan_audit,undefined);assert.deepEqual(second.meta.origin,first.meta.origin);
  assert.equal(second.meta.origin.origin,undefined);assert.equal(second.meta.origin.locally_modified,undefined);
  second.meta.origin.scan_audit.accepted=0;
  assert.equal(first.meta.origin.scan_audit.accepted,17);assert.equal(native.meta.scan_audit.accepted,17);
});

test('unchanged applied JSON and read-only calculations preserve original evidence and input values',()=>{
  const reordered=Object.fromEntries(Object.entries(structuredClone(native)).reverse());
  reordered.meta=Object.fromEntries(Object.entries(reordered.meta).reverse());
  assert.equal(applyProjectEdit(native,reordered),reordered);
  assert.equal(reordered.meta.locally_modified,undefined);assert.equal(reordered.meta.scan_audit.accepted,17);
  const before=structuredClone(native);assert.equal(assess(native).results.length,17);assert.deepEqual(native,before);
});

test('local editable work survives session recovery and malformed historical audits are rejected',()=>{
  const changed=applyProjectEdit(native,{...native,meta:{...native.meta,boundary:'Edited boundary'}});
  const restored=readSession({getItem:()=>JSON.stringify({version:1,project:changed,draft:'',calculated:false})});
  assert.deepEqual(restored.project,changed);assert.equal(restored.draft,'');assert.equal(restored.calculated,false);
  for(const origin of [null,[],{scan_audit:{cases:[null]}},{source_sha256:{}},{native_warnings:[{}]}]){
    const invalid={...changed,meta:{...changed.meta,origin}};
    assert.throws(()=>validateWorkspaceShape(invalid));
    assert.equal(readSession({getItem:()=>JSON.stringify({version:1,project:invalid,calculated:true})}),null);
  }
});

test('a new locally assembled project is marked without inventing a native source or audit',()=>{
  const source=blankProject(),next={...source,cases:[{}]};
  const changed=applyProjectEdit(source,next);
  assert.equal(changed.meta.evidence_type,'locally_modified');
  assert.equal(changed.meta.origin.source_sha256,undefined);assert.equal(changed.meta.origin.scan_audit,undefined);
  assert.equal(validateWorkspaceShape(changed),changed);
});
