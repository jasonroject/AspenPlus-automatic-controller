import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectArtifact,recordPage} from '../analysis_web/model-artifact-data.mjs';
import {artifactViewHTML,mountModelArtifacts,artifactExamplePath} from '../analysis_web/model-artifacts.mjs';
import {robustnessMetricSeries,robustnessRankSeries} from '../analysis_web/robustness-artifact-data.mjs';
import {robustnessRangeChart} from '../analysis_web/robustness-artifact-view.mjs';
import {setLanguage} from '../analysis_web/i18n.mjs';

const original=JSON.parse(await readFile(new URL('./fixtures/surrogate-demo.robustness.json',import.meta.url),'utf8'));
const copy=value=>structuredClone(value);
function failedFixture(){
  // Display-only fixture: every finite query is explicitly failed, not a new GP result.
  const raw=copy(original);raw.config.candidates=raw.config.candidates.slice(0,2);
  raw.config.scenarios=Array.from({length:77},(_,i)=>({id:i===38?'center':`scenario-${i}`,offsets:{x:(i-38)/38,y:0}}));
  raw.center_scenario_id='center';raw.rank_complete=false;raw.rank_incomplete_reason='Retained display fixture failures';raw.preferences=[];raw.nominal_anchors={};
  raw.records=raw.config.candidates.flatMap(candidate=>raw.config.scenarios.map(scenario=>({id:`${candidate.id}::${scenario.id}`,candidate_id:candidate.id,scenario_id:scenario.id,
    kind:'prediction',split:'prediction',inputs:{x:candidate.inputs.x+.5*scenario.offsets.x,y:0},outputs:null,constraints_passed:false,
    errors:['Retained display fixture failure <not markup>'],source_id:raw.model_sha256,exploratory:true})));
  raw.records[149].errors=['Late failure <script>unsafe</script>'];raw.query_count=raw.records.length;
  raw.candidates=raw.config.candidates.map(candidate=>({...copy(candidate),coverage:{expected:77,valid:0,unsupported:77,complete:false},
    metrics:Object.fromEntries(raw.responses.map(response=>[response.id,{unit:response.unit,direction:response.direction,complete:false,nominal:null,min:null,max:null,relative_span_pct:null,relative_span_reason:'incomplete_scenario_coverage'}]))}));
  return raw;
}

test('actual Python robustness export has zero/signed values, intact claims and both controls',()=>{
  const artifact=inspectArtifact(copy(original));assert.equal(artifact.kind,'process_robustness');assert.equal(artifact.independentlyVerified,false);
  assert.equal(artifact.rankComplete,true);assert.equal(artifact.exploratory,true);assert.equal(artifact.evidence,'offline_fixture');
  assert.equal(artifact.validCount,9);assert.equal(robustnessMetricSeries(artifact,'zero_impact')[0].nominal,0);
  assert.ok(robustnessMetricSeries(artifact,'signed_heat').some(row=>row.min<0));
  const state={response:'signed_heat',preference:'equal'},html=artifactViewHTML(artifact,state);
  assert.match(html,/artifact-response/);assert.match(html,/artifact-preference/);assert.match(html,/not confidence intervals/);assert.match(html,/not probabilities/);
  assert.match(html,/does not authenticate/);assert.match(html,/No Aspen execution/);assert.ok(!/NaN|Infinity/.test(html));
  assert.equal(robustnessRankSeries(artifact,'equal').length,3);
  const nullable=copy(original);nullable.responses.forEach(row=>{row.min=null;row.max=null;});assert.doesNotThrow(()=>inspectArtifact(nullable));
});

test('Chinese and English rendering retain the chosen fields and exported numeric values',()=>{
  const artifact=inspectArtifact(copy(original)),state={response:'signed_heat',preference:'equal'};
  try{setLanguage('zh');const html=artifactViewHTML(artifact,state);assert.match(html,/探索性情景分析/);assert.match(html,/不是概率/);assert.equal(state.response,'signed_heat');assert.equal(state.preference,'equal');}
  finally{setLanguage('en');}
  assert.match(artifactViewHTML(artifact,state),/Exploratory scenario analysis/);
});

test('missing, duplicated, malformed or contradictory structures reject instead of plotting a false complete ranking',()=>{
  const changes=[raw=>raw.records.pop(),raw=>raw.records[1]=copy(raw.records[0]),raw=>raw.records[0].source_id='f'.repeat(64),
    raw=>raw.records[0].scenario_id='unknown',raw=>raw.records[0].inputs.x+=.2,raw=>raw.records[0].outputs.energy=null,
    raw=>raw.candidates[0].coverage.valid=100,raw=>raw.candidates[0].metrics.energy.unit='MW',raw=>raw.candidates[0].metrics.energy.min=-10,
    raw=>raw.candidates[0].metrics.zero_impact.nominal=1e-11,raw=>raw.candidates[0].metrics.zero_impact.relative_span_pct=0,
    raw=>raw.responses=null,raw=>raw.inputs=[null],raw=>raw.config=null,raw=>raw.config.preferences[0].weights.energy=Infinity,
    raw=>raw.preferences[0].candidates[0].top_share_pct=123,raw=>raw.preferences[0].scenarios[0].ranks.A=0,
    raw=>raw.preferences[0].scenarios[0].spearman_vs_nominal.value=2,raw=>raw.config.perturbations.x.unit='K',
    raw=>raw.model_sha256={},raw=>raw.physical_validation=true,raw=>raw.exploratory=false];
  for(const change of changes){const raw=copy(original);change(raw);assert.throws(()=>inspectArtifact(raw),error=>error instanceof Error&&!(error instanceof TypeError));}
  const duplicate=copy(original);duplicate.config.scenarios.push({id:'duplicate-right',offsets:{x:1,y:1}});assert.throws(()=>inspectArtifact(duplicate),/duplicate effective/);
  const incorrectSpan=copy(original);incorrectSpan.candidates[0].metrics.energy.relative_span_pct=123456;assert.throws(()=>inspectArtifact(incorrectSpan),/relative span contradicts/);
  const incorrectRanks=copy(original),ids=incorrectRanks.candidates.map(row=>row.id);
  for(const p of incorrectRanks.preferences){for(const s of p.scenarios){s.ranks=Object.fromEntries(ids.map(id=>[id,1]));s.top_ids=ids;s.spearman_vs_nominal={value:null,reason:'constant_rank_vector'};}for(const c of p.candidates){c.nominal_rank=c.rank_min=c.rank_max=1;c.top_share_pct=100/ids.length;}}
  assert.throws(()=>inspectArtifact(incorrectRanks),/ranks contradict exported scores/);
});

test('numerically constant anchor declarations retain unit roundoff but not true near-zero differences',()=>{
  function values(lower,upper){const raw=copy(original),byId=Object.fromEntries(raw.candidates.map((row,i)=>[row.id,i?upper:lower]));for(const row of raw.records)row.outputs.zero_impact=byId[row.candidate_id];for(const row of raw.candidates)Object.assign(row.metrics.zero_impact,{min:byId[row.id],nominal:byId[row.id],max:byId[row.id],relative_span_pct:0,relative_span_reason:null});Object.assign(raw.nominal_anchors.zero_impact,{min:lower,max:upper,constant:true});return raw;}
  const rounded=values(1.5177297297297296,1.5177297297297299);assert.doesNotThrow(()=>inspectArtifact(rounded));
  rounded.nominal_anchors.zero_impact.constant=false;assert.throws(()=>inspectArtifact(rounded),/anchor mismatch/);
  assert.throws(()=>inspectArtifact(values(1e-20,2e-20)),/anchor mismatch/);
});

test('all retained failures are paginated and no surviving-candidate ranking is issued',()=>{
  const raw=failedFixture(),artifact=inspectArtifact(raw),state={robustPage:2,robustFilter:'failed',response:'energy'};
  assert.equal(artifact.rankComplete,false);assert.equal(artifact.failedCount,154);assert.deepEqual(robustnessRankSeries(artifact,'energy'),[]);
  const html=artifactViewHTML(artifact,state);assert.match(html,/Global ranking unavailable/);assert.match(html,/No complete global ranking/);
  assert.match(html,/Late failure &lt;script&gt;unsafe&lt;\/script&gt;/);assert.ok(!html.includes('<script>unsafe'));
  assert.match(html,/101–150 \/ 154/);assert.equal(recordPage(artifact.rows,3).rows.length,4);
  const visited=Array.from({length:4},(_,page)=>recordPage(artifact.rows,page).rows).flat();assert.equal(new Set(visited.map(row=>row.id)).size,154);
  const lying=copy(raw);lying.preferences=copy(original.preferences);assert.throws(()=>inspectArtifact(lying),/cannot carry global rankings/);
  const incomplete=copy(raw);incomplete.rank_complete=true;assert.throws(()=>inspectArtifact(incomplete),/rank completeness/);
});

test('range SVGs remain finite for signed, zero and extreme scales and can display 50 candidate rows',()=>{
  for(const values of [[0,0,0],[-5,-2,4],[-1e308,0,1e308],[Number.MIN_VALUE,Number.MIN_VALUE,Number.MIN_VALUE]]){
    const html=robustnessRangeChart([{id:'<unsafe>',min:values[0],nominal:values[1],max:values[2]}],{unitLabel:'kW'});
    assert.ok(!/NaN|Infinity/.test(html));assert.match(html,/&lt;unsafe&gt;/);assert.ok(!html.includes('<unsafe>'));
    for(const match of html.matchAll(/(?:x1|x2|cx|cy)="([^"]+)"/g))assert.ok(Number.isFinite(Number(match[1])));
  }
  const rows=Array.from({length:50},(_,i)=>({id:`case-${i}`,rank_min:1,nominal_rank:i+1,rank_max:50,top_share_pct:2}));
  const svg=robustnessRangeChart(rows,{rank:true});assert.match(svg,/case-49/);assert.equal((svg.match(/<circle /g)||[]).length,50);
});

class Container {
  constructor(){this.listeners=new Map();this.message={textContent:'',hidden:true};this.view={innerHTML:'',replaceChildren(){this.innerHTML='';}};this.details={open:false};}
  querySelector(selector){return selector==='#artifact-message'?this.message:selector==='#artifact-view'?this.view:this.details;}
  addEventListener(type,listener){this.listeners.set(type,listener);}removeEventListener(type){this.listeners.delete(type);}
  change(event){return this.listeners.get('change')({target:event});}
}
test('one uploader clears stale results and responds to metric/preference/filter/page controls',async()=>{
  const container=new Container(),state={artifact:inspectArtifact(copy(original))};mountModelArtifacts(container,state);
  await container.change({id:'artifact-response',value:'signed_heat'});assert.equal(state.response,'signed_heat');
  await container.change({id:'artifact-preference',value:'equal'});assert.equal(state.preference,'equal');
  const failed=failedFixture();await container.change({id:'artifact-file',files:[{size:100,text:async()=>JSON.stringify(failed)}]});
  await container.change({id:'artifact-robust-filter',value:'failed'});assert.equal(state.robustFilter,'failed');assert.equal(state.robustPage,0);
  container.listeners.get('click')({target:{closest:()=>({disabled:false,dataset:{artifactPage:'robust',pageDirection:'1'}})}});
  assert.equal(state.robustPage,1);assert.equal(container.details.open,true);
  failed.records.pop();await container.change({id:'artifact-file',files:[{size:100,text:async()=>JSON.stringify(failed)}]});
  assert.equal(state.artifact,null);assert.equal(container.view.innerHTML,'');assert.match(container.message.textContent,/missing or excess/);
});

test('languagechange rerenders only the artifact, preserves controls/disclosures/focus and cleans its listener',async()=>{
  const priorWindow=globalThis.window,priorDocument=globalThis.document,listeners=new Map();
  globalThis.window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const focused={id:'artifact-response'},focusRestored={count:0,focus(){this.count++;}};
  globalThis.document={activeElement:focused};
  try{
    const container=new Container(),state={artifact:inspectArtifact(copy(original)),response:'signed_heat',preference:'equal',robustPage:0};container.view.contains=()=>true;
    const baseQuery=container.querySelector.bind(container);container.querySelector=selector=>selector==='#artifact-response'?focusRestored:baseQuery(selector);container.details.open=true;
    setLanguage('zh');const cleanup=mountModelArtifacts(container,state);focusRestored.count=0;
    assert.match(container.view.innerHTML,/情景响应范围/);setLanguage('en');listeners.get('languagechange')();
    assert.match(container.view.innerHTML,/Scenario response range/);assert.ok(!/情景响应范围|候选工况|名次稳定性/.test(container.view.innerHTML));
    assert.equal(state.response,'signed_heat');assert.equal(state.preference,'equal');assert.equal(container.details.open,true);assert.equal(focusRestored.count,1);
    let resolve,reads=0;const pending=container.change({id:'artifact-file',files:[{size:100,text:()=>{reads++;return new Promise(done=>{resolve=done;});}}]});
    listeners.get('languagechange')();resolve(JSON.stringify(original));await pending;assert.equal(reads,1);assert.equal(state.artifact.kind,'process_robustness');
    cleanup();assert.equal(listeners.has('languagechange'),false);
  }finally{setLanguage('en');if(priorWindow===undefined)delete globalThis.window;else globalThis.window=priorWindow;if(priorDocument===undefined)delete globalThis.document;else globalThis.document=priorDocument;}
});

test('reviewed example buttons share validation, revision and error clearing without accepting remote or escaped paths',async()=>{
  assert.equal(artifactExamplePath('data/generic-htl-pilot/model.bundle.json'),'data/generic-htl-pilot/model.bundle.json');
  for(const path of ['https://example.com/result.json','/data/generic-htl-pilot/x.json','data/generic-htl-pilot/../x.json','data/generic-htl-pilot/x.json?from=elsewhere','data/generic-htl-pilot/%2e%2e.json','data/other/x.json'])assert.throws(()=>artifactExamplePath(path),/reviewed JSON example/);
  const previousFetch=globalThis.fetch,container=new Container(),state={artifact:inspectArtifact(copy(original))};mountModelArtifacts(container,state);
  const button={disabled:false,dataset:{artifactExample:'data/generic-htl-pilot/robustness.json'}},event={target:{closest:selector=>selector==='[data-artifact-example]'?button:null}};
  try{
    let requested;globalThis.fetch=async path=>{requested=path;return {ok:true,text:async()=>JSON.stringify(original)};};
    await container.listeners.get('click')(event);assert.equal(requested,button.dataset.artifactExample);assert.equal(state.artifact.kind,'process_robustness');
    let completeFetch;globalThis.fetch=()=>new Promise(resolve=>{completeFetch=resolve;});const old=container.listeners.get('click')(event);
    const newest=copy(original);newest.profile_id='newest-upload';await container.change({id:'artifact-file',files:[{size:100,text:async()=>JSON.stringify(newest)}]});
    completeFetch({ok:true,text:async()=>JSON.stringify(original)});await old;assert.equal(state.artifact.profileId,'newest-upload');
    globalThis.fetch=async()=>({ok:false});await container.listeners.get('click')(event);assert.equal(state.artifact,null);assert.equal(container.view.innerHTML,'');assert.match(container.message.textContent,/example is unavailable/);
  }finally{globalThis.fetch=previousFetch;}
});
