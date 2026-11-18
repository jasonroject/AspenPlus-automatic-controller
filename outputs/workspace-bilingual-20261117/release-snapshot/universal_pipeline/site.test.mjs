import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
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

test('native pilot documentation preserves failed independent checks and matches published error values',async()=>{
  const summary=JSON.parse(await readFile(new URL('../analysis_web/data/generic-htl-pilot/summary.json',import.meta.url),'utf8'));
  const evaluation=JSON.parse(await readFile(new URL('../analysis_web/data/generic-htl-pilot/evaluation.json',import.meta.url),'utf8'));
  const article=docs.find(doc=>doc.id==='models').body;
  assert.equal(summary.prediction_enabled,false);assert.equal(summary.exploratory,true);
  assert.match(article,/<h2 id="pilot">/);assert.match(article,/ordinary prediction remains disabled/);
  for(const split of ['holdout','verification'])for(const result of Object.values(summary.splits[split].metrics))assert.ok(article.includes((100*result.max_relative_error).toFixed(4)+'%'));
  const failedPoints=evaluation.records.filter(row=>row.split==='verification'&&Object.entries(evaluation.criteria).some(([key,policy])=>Math.abs(row.predicted[key]-row.actual[key])/Math.max(Math.abs(row.actual[key]),policy.relative_floor)>policy.max_relative_error));
  assert.equal(failedPoints.length,1);assert.equal(failedPoints[0].id,'verify-T335-L8p5');
  assert.match(article,/335 °C \/ 8\.5 m verification point/);assert.match(article,/345 °C \/ 17\.5 m point passed all three checks/);
  for(const file of ['README.md','index.json'])assert.ok(article.includes('data/generic-htl-pilot/'+file));
});

test('published native pilot JSON bytes match the complete evidence manifest',async()=>{
  const directory=new URL('../analysis_web/data/generic-htl-pilot/',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('index.json',directory),'utf8'));
  const declared=Object.keys(manifest.files).sort();
  const actual=(await readdir(directory)).filter(name=>name.endsWith('.json')&&name!=='index.json').sort();
  assert.equal(declared.length,14);assert.deepEqual(actual,declared);
  for(const name of declared){
    assert.match(name,/^[\w.-]+\.json$/);
    const bytes=await readFile(new URL(name,directory));
    assert.equal(bytes.length,manifest.files[name].bytes,`${name}: byte size`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.files[name].sha256,`${name}: SHA256`);
  }
});
