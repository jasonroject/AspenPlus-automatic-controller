import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {responseSlice,climateContributions,orderedCandidates,supportedPoint,pairChart,responseChart,rankChart} from '../analysis_web/pipeline-charts.mjs';
import {createStudyLoader,fsJsonFetcher} from '../analysis_web/study-loader.mjs';
const study=createStudyLoader({fetchJson:fsJsonFetcher(new URL('../analysis_web/data/study/',import.meta.url))});
const analysis=await study.htlAnalysis();
const observations=await study.observations();
const current=supportedPoint(analysis.grid.rows,325,8.5);

test('prediction selection rejects off-grid and out-of-domain values instead of rounding',()=>{
  assert.ok(current);assert.equal(current.temperature_C,325);assert.equal(current.length_m,8.5);
  assert.equal(supportedPoint(analysis.grid.rows,325.004,8.5),null);
  assert.equal(supportedPoint(analysis.grid.rows,350.5,8.5),null);
  assert.equal(supportedPoint(analysis.grid.rows,325,NaN),null);
});
test('response slices hold the other input exactly fixed and retain only real native markers',()=>{
  const slice=responseSlice(analysis.grid.rows,observations.rows,current,'temperature_C','HR_electricity_kWh');
  assert.equal(slice.predictions.length,81);
  assert.ok(slice.predictions.every(row=>row.length_m===8.5));
  assert.equal(slice.native.length,1);
  assert.equal(slice.native[0].temperature_C,325);
  assert.equal(slice.native[0].HR_electricity_kWh,12.2727297050724);
  assert.notEqual(slice.native[0].HR_electricity_kWh,current.HR_electricity_kWh);
  const lengthSlice=responseSlice(analysis.grid.rows,observations.rows,current,'length_m','target_kg_h');
  assert.equal(lengthSlice.predictions.length,61);assert.ok(lengthSlice.predictions.every(row=>row.temperature_C===325));
});
test('all displayed contribution sums reproduce exported carbon footprints with the inherited wastewater conversion',()=>{
  for(const row of analysis.grid.rows)for(const scenario of ['STD','HR']){
    const entries=climateContributions(row,scenario,analysis.accounting);
    assert.equal(entries.length,4);
    assert.ok(Math.abs(entries.reduce((sum,item)=>sum+item.value,0)-row['CF_'+scenario])<1e-10);
    assert.equal(entries[3].value,row.water_kg_h/1000*analysis.accounting.wastewater_gamma/row.target_kg_h);
  }
});
test('native chart observations are copied from accepted source rows with a verified source hash',async()=>{
  const file=await readFile(new URL('../htl_pipeline/reference/native_samples.csv',import.meta.url));
  assert.equal(createHash('sha256').update(file).digest('hex'),observations.sources[0].sha256);
  const lines=file.toString('utf8').trim().split(/\r?\n/),headers=lines.shift().split(',');
  const rows=lines.map(line=>Object.fromEntries(line.split(',').map((value,index)=>[headers[index],value])));
  for(const actual of observations.rows.filter(row=>row.source==='native_reference')){
    const source=rows.find(row=>row.source_file===actual.source_record);
    assert.ok(source);assert.equal(source.accepted,'True');
    for(const field of ['temperature_C','length_m','target_kg_h','STD_electricity_kWh','HR_electricity_kWh','CF_STD','CF_HR'])assert.equal(actual[field],source[field]===''?null:Number(source[field]));
    assert.ok(actual.temperature_C>=310&&actual.temperature_C<=350&&actual.length_m>=5&&actual.length_m<=20);
  }
  assert.equal(observations.rows.filter(row=>row.source==='fresh_comparison').length,3);
});
test('rank charts sort a copy and preserve supplied P05/P50/P95 and top-one frequencies',()=>{
  const original=analysis.robustness.scenarios.HR,first=original[0];
  const nominal=orderedCandidates(original,'nominal');
  assert.equal(nominal[0].nominal_rank,1);assert.equal(nominal[0].temperature_C,340);assert.equal(nominal[0].length_m,7);
  const byFrequency=orderedCandidates(original);assert.ok(byFrequency.every((row,index)=>!index||row.top1_fraction<=byFrequency[index-1].top1_fraction));
  assert.equal(original[0],first);
  const chart=rankChart(nominal,{title:'Ranks',conditionLabel:'Condition',rankLabel:'Rank',topLabel:'Top 1',nominalLabel:'Nominal'});
  assert.ok(chart.includes('P05 / P50 / P95: 1 / 2 / 6'));assert.ok(!chart.includes('NaN'));
});
test('chart markup escapes labels and has named accessible images with finite plotted coordinates',()=>{
  const pair=pairChart([{label:'<script>',value:10},{label:'HR',value:2}],'kWh','Compare');
  assert.ok(pair.includes('&lt;script&gt;'));assert.ok(!pair.includes('<script>'));assert.match(pair,/role="img" aria-label="Compare"/);
  const slice=responseSlice(analysis.grid.rows,observations.rows,current,'temperature_C','HR_electricity_kWh');
  const chart=responseChart(slice,{title:'Energy',xLabel:'Temperature',yLabel:'kWh',nativeLabel:'Native',selectedLabel:'Selected'});
  assert.ok(!/NaN|Infinity/.test(chart));assert.ok(chart.includes('fresh_verification'));
});
