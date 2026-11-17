import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {summarizeExample,exampleCode} from '../analysis_web/demo.mjs';
import {docs} from '../analysis_web/docs-content.mjs';
const project=JSON.parse(await readFile(new URL('../analysis_web/data/universal-example.json',import.meta.url),'utf8'));
test('public runnable example preserves hand-checked results and possibility interpretation',()=>{
  const result=summarizeExample(project);
  assert.match(result.text,/energy 5\.00 kWh\/kg/);
  assert.match(result.text,/Climate 3\.00 kg CO2-eq\/kg/);
  assert.match(result.text,/\[2\.091, 4\.222\]/);
  assert.deepEqual(result.comparison.rows.map(r=>r.id),['B','A']);
  assert.ok(result.comparison.rows.every(r=>r.possible_rank[0]===1&&r.possible_rank[1]===2));
});
test('copied browser example executes against the real module and fixture',async()=>{
  // Supply browser fetch and console while resolving the displayed relative module.
  const source=exampleCode.replace("'./universal-core.mjs'",JSON.stringify(new URL('../analysis_web/universal-core.mjs',import.meta.url).href)).replace('import { assess, rank } from','const { assess, rank } = await import(').replace(";\n\nconst project", ");\n\nconst project");
  const logs=[];const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  await new AsyncFunction('fetch','console',source)(async path=>{assert.equal(path,'./data/universal-example.json');return {json:async()=>project};},{log:(...args)=>logs.push(args)});
  assert.equal(logs[0][0].length,2);assert.equal(logs[0][1][0].id,'B');
});
test('documentation article links and on-page IDs resolve',()=>{
  const ids=new Set(docs.map(d=>d.id));assert.equal(ids.size,docs.length);
  for(const doc of docs){const anchors=[...doc.body.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(anchors).size,anchors.length,doc.id);
    for(const [,id] of doc.body.matchAll(/href="#([^"]+)"/g))assert.ok(ids.has(id),`${doc.id}: unknown article ${id}`);
  }
});
