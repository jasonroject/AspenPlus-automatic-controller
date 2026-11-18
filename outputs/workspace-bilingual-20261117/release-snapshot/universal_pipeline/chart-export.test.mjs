import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildCSV,standaloneSVG,wrapSVGText} from '../analysis_web/chart-export.mjs';
import {predictionColumns,predictionChartRows} from '../analysis_web/pipeline-export.mjs';
import {responseSlice,responseChart,pairChart,supportedPoint} from '../analysis_web/pipeline-charts.mjs';

const analysis=JSON.parse(readFileSync(new URL('../analysis_web/data/pipeline.json',import.meta.url),'utf8'));
const observations=JSON.parse(readFileSync(new URL('../analysis_web/data/pipeline-observations.json',import.meta.url),'utf8'));
const current=supportedPoint(analysis.grid.rows,325,8.5);
const slice=responseSlice(analysis.grid.rows,observations.rows,current,'temperature_C','HR_electricity_kWh');

function readCSV(csv){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=csv.startsWith('\uFEFF')?1:0;i<csv.length;i++){
    const c=csv[i];
    if(c==='"'){if(quoted&&csv[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(!quoted&&c===','){row.push(cell);cell='';}
    else if(!quoted&&c==='\r'&&csv[i+1]==='\n'){row.push(cell);rows.push(row);row=[];cell='';i++;}
    else cell+=c;
  }
  return rows;
}

test('CSV preserves numeric precision, Unicode and quoted multiline source text; formula-like text stays inert',()=>{
  const value=-0.0000012345678901234567,source='来源, "A"\nline 2';
  const [header,row]=readCSV(buildCSV([{key:'value',label:'Value / kW'},'source','null','formula'],[{value,source,null:null,formula:'=HYPERLINK("https://example.test")'}]));
  assert.deepEqual(header,['Value / kW','source','null','formula']);
  assert.equal(Number(row[0]),value);assert.equal(row[0],String(value));
  assert.equal(row[1],source);assert.equal(row[2],'');assert.equal(row[3][0],"'");
  for(const source of ['+cmd','-cmd','@SUM(A1)','\tcmd','\ncmd','  =1'])assert.equal(readCSV(buildCSV(['source'],[{source}]))[1][0],"'"+source);
  assert.throws(()=>buildCSV(['value'],[{value:NaN}]),/finite/);
});

test('response CSV uses exact plotted prediction/native values and source hashes rather than rounded labels',()=>{
  const rows=predictionChartRows('response',{analysis,current,slice,scenario:'HR',observations});
  assert.equal(rows.length,slice.predictions.length+slice.native.length);
  const native=rows.find(row=>row.evidence_type==='native_simulation');
  assert.equal(native.value,12.2727297050724);
  assert.equal(native.source_record,slice.native[0].source_record);
  assert.equal(native.source_sha256,observations.sources.find(row=>row.id===slice.native[0].source).sha256);
  const prediction=rows.find(row=>row.selected_prediction);
  assert.equal(prediction.value,current.HR_electricity_kWh);assert.notEqual(prediction.value,native.value);
  assert.equal(prediction.unit,'kWh / 100 kg wet feed');assert.equal(prediction.duration_h,1);
  const csv=readCSV(buildCSV(predictionColumns,rows)),index=csv[0].indexOf('value');
  assert.equal(Number(csv[rows.indexOf(native)+1][index]),native.value);
  assert.ok(rows.every(row=>row.physical_validation===false));
});

test('paired exports match both frozen routes and all exports fail closed after input changes or incomplete data',()=>{
  for(const [kind,keys] of [['energy',['STD_electricity_kWh','HR_electricity_kWh']],['carbon',['CF_STD','CF_HR']]]){
    const rows=predictionChartRows(kind,{analysis,current});
    assert.deepEqual(rows.map(row=>row.value),keys.map(key=>current[key]));
    assert.deepEqual(rows.map(row=>row.scenario),['STD','HR']);
    assert.deepEqual(predictionChartRows(kind,{analysis,current,dirty:true}),[]);
    assert.deepEqual(predictionChartRows(kind,{analysis:{...analysis,prediction_enabled:false},current}),[]);
    assert.deepEqual(predictionChartRows(kind,{analysis,current:{...current,[keys[0]]:null}}),[]);
  }
  assert.deepEqual(predictionChartRows('response',{analysis,current,slice:{...slice,predictions:[]}}),[]);
  assert.deepEqual(predictionChartRows('response',{analysis,current:null,slice}),[]);
});

test('standalone SVG retains editable geometry, language/units and evidence notes without webpage styling or transient cursor',()=>{
  const chart=responseChart(slice,{title:'能耗',xLabel:'温度 / °C',yLabel:'kWh / 100 kg wet feed',nativeLabel:'原生',selectedLabel:'预测'});
  const exported=standaloneSVG(chart,{title:'当前能耗 <HR>',description:'模型预测，不代表物理验证。',metadata:{basis:'100 kg wet feed / 1 h',source:'data/pipeline.json',reference:analysis.training.reference_sha256}});
  assert.match(exported,/xmlns="http:\/\/www.w3.org\/2000\/svg"/);assert.match(exported,/<polyline /);
  assert.match(exported,/Microsoft YaHei/);assert.match(exported,/fill="#fff"/);
  assert.ok(exported.includes('当前能耗 &lt;HR&gt;'));assert.ok(exported.includes('温度 / °C'));
  assert.ok(exported.includes('100 kg wet feed / 1 h'));assert.ok(exported.includes(analysis.training.reference_sha256));
  assert.ok(!exported.includes('data-response-inspection'));assert.ok(!/foreignObject|<script|<image|href=/.test(exported));
  assert.ok(!exported.includes('data-response-chart'),'HTML boolean data attributes must not leak into standalone XML');
  assert.doesNotThrow(()=>standaloneSVG(pairChart([{label:'STD',value:1},{label:'HR',value:2}],'kWh','Compare')));
  assert.throws(()=>standaloneSVG('<svg viewBox="0 0 20 20"><image href="https://example.test/a.png"/></svg>'),/self-contained/);
  assert.throws(()=>standaloneSVG('<svg viewBox="0 0 NaN 0"></svg>'),/viewBox/);
});

test('figure notes preserve English words and mixed Chinese text, while long hashes remain bounded',()=>{
  const wrapped=wrapSVGText('No native values are interpolated. 原生值未插值。',22);
  assert.ok(wrapped.includes('No native values are'));
  assert.ok(wrapped.some(line=>line.includes('interpolated.')));
  assert.equal(wrapped.join('').replaceAll(' ',''),'No native values are interpolated. 原生值未插值。'.replaceAll(' ',''));
  const hash='a0123456789abcdef'.repeat(4),hashLines=wrapSVGText(hash,22);
  assert.equal(hashLines.join(''),hash);assert.ok(hashLines.every(line=>line.length<=22));
  assert.deepEqual(wrapSVGText('English words\n中文说明',14),['English words','中文说明']);
});
