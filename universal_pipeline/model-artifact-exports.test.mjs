import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectArtifact} from '../analysis_web/model-artifact-data.mjs';
import {artifactScatter} from '../analysis_web/model-artifacts.mjs';
import {standaloneSVG} from '../analysis_web/chart-export.mjs';
import {buildModelArtifactExport} from '../analysis_web/model-artifact-exports.mjs';

const bundle=JSON.parse(await readFile(new URL('./fixtures/surrogate-demo.bundle.json',import.meta.url),'utf8'));
const predictions=JSON.parse(await readFile(new URL('./fixtures/surrogate-demo.predictions.json',import.meta.url),'utf8'));

test('coverage exports plotted raw numbers, all input units and declared lineage without new native claims',()=>{
  const artifact=inspectArtifact(structuredClone(bundle));
  const result=buildModelArtifactExport(artifact,'coverage',{inputId:'x',responseId:'signed_heat'});
  assert.equal(result.rows.length,artifact.validCount);
  for(const row of result.rows){
    const source=artifact.rows.find(record=>record.id===row.record_id);
    assert.equal(row.input_value,source.inputs.x);assert.equal(row.response_value,source.outputs.signed_heat);
    assert.equal(row.source,source.source);assert.equal(row.dataset_sha256,bundle.dataset_sha256);
    assert.deepEqual(JSON.parse(row.inputs_json),source.inputs);assert.equal(JSON.parse(row.input_units_json).x,'1');
    assert.equal(row.exploratory,true);assert.equal(row.declared_prediction_enabled,false);assert.equal(row.independently_verified,false);
  }
  assert.ok(result.rows.some(row=>row.response_value<0));assert.ok(result.csv.startsWith('\uFEFF'));
  assert.ok(result.csv.includes(String(result.rows[0].response_value)));assert.equal(result.rows[0].record_kind,'supplied_observation');
  assert.match(result.description,/not a controlled response curve/);
});

test('parity exports exclude training/failed pairs and preserve supplied vs predicted directions exactly',()=>{
  const raw=structuredClone(bundle);raw.validation.records.push({id:'not-validation',split:'training',constraints_passed:true,actual:{energy:2,signed_heat:2,zero_impact:0},predicted:{energy:2,signed_heat:2,zero_impact:0}});
  const artifact=inspectArtifact(raw),result=buildModelArtifactExport(artifact,'parity',{inputId:'x',responseId:'energy'});
  assert.ok(result.rows.every(row=>['holdout','verification'].includes(row.group)));assert.ok(!result.rows.some(row=>row.record_id==='not-validation'));
  for(const row of result.rows){const pair=artifact.pairs.find(item=>item.id===row.record_id);assert.equal(row.supplied_value,pair.actual.energy);assert.equal(row.predicted_mean,pair.predicted.energy);}
  assert.equal(result.svgOptions.metadata.retained_records_not_plotted,artifact.pairs.length-result.rows.length);
  assert.match(result.description,/Training records are excluded/);
});

test('prediction coverage is mean-only and refuses held-out export without an evaluation',()=>{
  const artifact=inspectArtifact(predictions),result=buildModelArtifactExport(artifact,'coverage',{inputId:'x',responseId:'zero_impact'});
  assert.equal(result.rows.length,2);assert.ok(result.rows.every(row=>row.record_kind==='surrogate_mean_prediction'&&row.response_value===0));
  assert.equal(result.rows[0].declared_prediction_enabled,null);assert.equal(result.svgOptions.metadata.retained_records_not_plotted,1);
  assert.throws(()=>buildModelArtifactExport(artifact,'parity',{inputId:'x',responseId:'energy'}),/evaluation/);
  assert.throws(()=>buildModelArtifactExport(artifact,'coverage',{inputId:'unknown',responseId:'energy'}),/declared/);
  assert.throws(()=>buildModelArtifactExport(null,'coverage'),/loaded/);
});

test('source and all-input provenance follow plotted row order even if a caller supplies repeated IDs',()=>{
  // inspectArtifact currently rejects duplicate IDs. The pure exporter also
  // keeps provenance intact when handed an already-built display object.
  const raw=structuredClone(bundle);raw.observations[1].id=raw.observations[0].id;
  assert.throws(()=>inspectArtifact(raw),/duplicate.*record/i);
  for(const kind of ['coverage','parity']){
    const artifact=inspectArtifact(structuredClone(bundle));
    const selected=(kind==='coverage'?artifact.rows:artifact.pairs).filter(row=>row.displayValid);
    selected[0].id=selected[1].id='same-id';
    selected[0].source='first-origin';selected[1].source='second-origin';
    selected[0].inputs={x:-.75,y:-.5};selected[1].inputs={x:.75,y:.5};
    if(kind==='coverage'){
      selected[0].outputs.signed_heat=-3;selected[1].outputs.signed_heat=9;
    }else{
      selected[0].actual.signed_heat=-3;selected[0].predicted.signed_heat=-2.5;
      selected[1].actual.signed_heat=9;selected[1].predicted.signed_heat=8.5;
    }
    const result=buildModelArtifactExport(artifact,kind,{inputId:'x',responseId:'signed_heat'});
    assert.deepEqual(result.rows.slice(0,2).map(row=>row.source),['first-origin','second-origin']);
    assert.deepEqual(result.rows.slice(0,2).map(row=>JSON.parse(row.inputs_json).x),[-.75,.75]);
    assert.deepEqual(result.rows.slice(0,2).map(row=>kind==='coverage'?row.response_value:row.supplied_value),[-3,9]);
    assert.deepEqual(result.rows.slice(0,2).map(row=>kind==='coverage'?row.input_value:row.predicted_mean),kind==='coverage'?[-.75,.75]:[-2.5,8.5]);
  }
});

test('empty native input unit and missing qualification stay explicit, while CSV protects source text',()=>{
  const raw=structuredClone(bundle);raw.dataset_metadata.inputs[0].unit='';delete raw.prediction_enabled;delete raw.status;
  raw.observations[0].source='=HYPERLINK("untrusted")';
  const result=buildModelArtifactExport(inspectArtifact(raw),'coverage',{inputId:'x',responseId:'energy'});
  assert.equal(result.rows[0].input_unit,'');assert.equal(result.rows[0].declared_prediction_enabled,null);assert.equal(result.rows[0].exploratory,null);
  assert.ok(result.csv.includes("'=HYPERLINK"));assert.equal(result.rows[0].declared_qualification_status,'');
});

test('current-renderer SVG can be wrapped with escaped source/scope notes without raster or confidence bands',()=>{
  const artifact=inspectArtifact(bundle),chart=buildModelArtifactExport(artifact,'parity',{inputId:'x',responseId:'signed_heat'});
  const points=chart.rows.map(row=>({id:row.record_id,split:row.group,x:row.supplied_value,y:row.predicted_mean}));
  const rendered=artifactScatter(points,'Supplied / kW','Mean / kW',chart.title,true);
  const svg=standaloneSVG(rendered,chart.svgOptions);
  assert.match(svg,/xmlns="http:\/\/www.w3.org\/2000\/svg"/);assert.ok(svg.includes(artifact.modelHash));
  assert.match(svg,/not uncertainty bounds/);assert.ok(!svg.includes('[object Object]'));assert.ok(!svg.includes('<image'));
});
