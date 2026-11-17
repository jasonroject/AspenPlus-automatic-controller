// Display-shape and cross-reference checks only; no GP execution or Python hash recomputation.
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=message=>{throw new Error(`Robustness result: ${message}`);};
const check=(condition,message)=>{if(!condition)fail(message);};
const finite=Number.isFinite;
const constant=(lo,hi)=>hi-lo<=16*Number.EPSILON*Math.max(Math.abs(lo),Math.abs(hi));
const same=(a,b)=>a===b||(finite(a)&&finite(b)&&Math.abs(a-b)<=1e-10*Math.max(Number.MIN_VALUE,Math.abs(a),Math.abs(b)));
const text=(x,name)=>check(typeof x==='string'&&x.trim().length>0,`${name} must be text`);
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(x)&&!x.includes('..');
const keys=(x,names)=>object(x)&&Object.keys(x).length===names.length&&names.every(name=>Object.hasOwn(x,name));
function unique(rows,name,min,max){
  check(Array.isArray(rows)&&rows.length>=min&&rows.length<=max,`${name} count is invalid`);
  const seen=new Set();for(const row of rows){check(object(row)&&id(row.id)&&!seen.has(row.id),`${name} IDs must be valid and unique`);seen.add(row.id);}return seen;
}
const list=x=>Array.isArray(x)&&x.every(v=>typeof v==='string');
function numericMap(value,names,name,{nullable=false}={}){check(keys(value,names)&&names.every(key=>finite(value[key])||(nullable&&value[key]===null)),`${name} must contain exactly the declared numeric fields`);}
function exportedRanks(scores,ids){
  const order=[...ids].sort((a,b)=>scores[b]-scores[a]),ranks={};let start=0;
  while(start<order.length){let end=start+1;while(end<order.length&&scores[order[start]]-scores[order[end]]<=1e-12)end++;for(let i=start;i<end;i++)ranks[order[i]]=(start+1+end)/2;start=end;}return ranks;
}
function rankCorrelation(left,right,ids){
  const mean=values=>ids.reduce((sum,key)=>sum+values[key],0)/ids.length,ml=mean(left),mr=mean(right);
  let numerator=0,ll=0,rr=0;for(const key of ids){const a=left[key]-ml,b=right[key]-mr;numerator+=a*b;ll+=a*a;rr+=b*b;}const denominator=Math.sqrt(ll*rr);return denominator===0?null:Math.max(-1,Math.min(1,numerator/denominator));
}

export function inspectRobustnessArtifact(raw){
  check(object(raw)&&raw.kind==='process_robustness'&&raw.result_version===1,'unsupported result version');
  for(const name of ['model_sha256','bundle_sha256','dataset_sha256','profile_sha256','native_model_sha256','config_sha256','result_sha256'])check(typeof raw[name]==='string'&&/^[a-f0-9]{64}$/.test(raw[name]),`${name} is missing or malformed`);
  text(raw.profile_id,'profile_id');text(raw.evidence_type,'evidence_type');text(raw.scope,'scope');
  check(typeof raw.exploratory==='boolean'&&typeof raw.rank_complete==='boolean','status flags must be boolean');
  check(['native_simulation','offline_fixture'].includes(raw.evidence_type)&&!(raw.evidence_type==='offline_fixture'&&!raw.exploratory),'evidence and exploratory declarations contradict');
  for(const name of ['native_execution_performed','model_refitted','background_lca_recomputed','physical_validation'])check(raw[name]===false,`${name} must be false for this mean-scenario artifact`);
  check(Array.isArray(raw.inputs)&&raw.inputs.length>=1&&raw.inputs.length<=6&&raw.inputs.every(r=>object(r)&&typeof r.id==='string'&&r.id.trim()&&r.id.length<=150)&&new Set(raw.inputs.map(r=>r.id)).size===raw.inputs.length,'input IDs must be unique text');
  const inputIds=raw.inputs.map(r=>r.id);
  // Response IDs may contain category text/colon, unlike candidate identifiers.
  check(Array.isArray(raw.responses)&&raw.responses.length>=1&&raw.responses.length<=30&&raw.responses.every(r=>object(r)&&typeof r.id==='string'&&r.id.trim()&&r.id.length<=150)&&new Set(raw.responses.map(r=>r.id)).size===raw.responses.length,'response IDs must be unique text');
  const responseIds=raw.responses.map(r=>r.id);
  for(const row of raw.inputs)check(typeof row.unit==='string'&&finite(row.min)&&finite(row.max)&&row.min<row.max,'invalid input units or domain');
  for(const row of raw.responses)check(typeof row.unit==='string'&&row.unit.trim()&&['min','max'].includes(row.direction)&&['signed','positive','nonnegative'].includes(row.value_domain)&&(row.min==null||finite(row.min))&&(row.max==null||finite(row.max))&&(row.min==null||row.max==null||row.min<=row.max),'invalid response unit, direction or value domain');
  const config=raw.config;check(object(config)&&config.config_version===1,'missing configuration');
  const candidateIds=[...unique(config.candidates,'candidate',2,50)],scenarioIds=[...unique(config.scenarios,'scenario',1,256)],preferenceIds=[...unique(config.preferences,'preference',1,256)];
  for(const row of config.candidates)numericMap(row.inputs,inputIds,'candidate inputs');
  check(keys(config.perturbations,inputIds),'perturbations do not match declared inputs');
  for(const spec of raw.inputs){const p=config.perturbations[spec.id];check(object(p)&&p.unit===spec.unit&&finite(p.halfwidth)&&p.halfwidth>=0,'invalid perturbation width or native unit');}
  const displacements=new Set();let center=null;
  for(const row of config.scenarios){numericMap(row.offsets,inputIds,'scenario offsets');check(inputIds.every(key=>Math.abs(row.offsets[key])<=1),'offset outside [-1,1]');const displacement=inputIds.map(key=>row.offsets[key]*config.perturbations[key].halfwidth);const key=JSON.stringify(displacement);check(!displacements.has(key),'duplicate effective scenario displacement');displacements.add(key);if(inputIds.every(key=>row.offsets[key]===0)){check(center===null,'duplicate center');center=row.id;}}
  check(center!==null&&center===raw.center_scenario_id,'center scenario identity differs');
  for(const row of config.preferences){numericMap(row.weights,responseIds,'preference weights');check(responseIds.every(key=>row.weights[key]>=0)&&responseIds.some(key=>row.weights[key]>0),'invalid preference weights');}
  const expected=candidateIds.length*scenarioIds.length;
  check(Number.isInteger(config.max_total_queries)&&config.max_total_queries>=expected&&config.max_total_queries<=10000,'invalid query budget');
  check(raw.query_count===expected&&Array.isArray(raw.records)&&raw.records.length===expected,'missing or excess candidate/scenario queries');
  const candidateMap=new Map(config.candidates.map(row=>[row.id,row])),scenarioMap=new Map(config.scenarios.map(row=>[row.id,row])),recordMap=new Map();
  const rows=raw.records.map(row=>{
    check(object(row)&&candidateMap.has(row.candidate_id)&&scenarioMap.has(row.scenario_id),'unknown query identity');
    const key=`${row.candidate_id}::${row.scenario_id}`;check(row.id===key&&!recordMap.has(key),'duplicate or inconsistent query identity');
    check(row.source_id===raw.model_sha256&&row.kind==='prediction'&&row.split==='prediction'&&row.exploratory===raw.exploratory,'query provenance or exploratory flag differs');
    check(typeof row.constraints_passed==='boolean'&&list(row.errors),'malformed query status/errors');
    check(row.constraints_passed?row.errors.length===0:row.errors.length>0,'query status contradicts errors');
    numericMap(row.inputs,inputIds,'query inputs',{nullable:!row.constraints_passed});
    for(const spec of raw.inputs){const calculated=candidateMap.get(row.candidate_id).inputs[spec.id]+config.perturbations[spec.id].halfwidth*scenarioMap.get(row.scenario_id).offsets[spec.id];check(finite(calculated)?same(row.inputs[spec.id],calculated):row.inputs[spec.id]===null,'query coordinate differs from candidate/scenario');}
    if(row.outputs!==null)numericMap(row.outputs,responseIds,'query outputs',{nullable:!row.constraints_passed});
    if(row.constraints_passed){check(raw.inputs.every(spec=>row.inputs[spec.id]>=spec.min&&row.inputs[spec.id]<=spec.max),'available query lies outside declared input bounds');numericMap(row.outputs,responseIds,'available query outputs');for(const spec of raw.responses){const v=row.outputs[spec.id];check(spec.value_domain!=='nonnegative'||v>=0,'negative nonnegative response');check(spec.value_domain!=='positive'||v>0,'nonpositive positive response');check(spec.min==null||v>=spec.min,'response below declared minimum');check(spec.max==null||v<=spec.max,'response above declared maximum');}}
    const displayed={...row,displayValid:row.constraints_passed,displayIssues:[],warnings:[]};recordMap.set(key,displayed);return displayed;
  });
  check(unique(raw.candidates,'candidate summaries',candidateIds.length,candidateIds.length).size===candidateIds.length,'candidate summaries missing');
  const summaries=new Map();
  for(const row of raw.candidates){
    check(candidateMap.has(row.id),'unknown candidate summary');numericMap(row.inputs,inputIds,'summary inputs');check(inputIds.every(key=>same(row.inputs[key],candidateMap.get(row.id).inputs[key])),'summary input differs');
    const candidateRecords=scenarioIds.map(s=>recordMap.get(`${row.id}::${s}`));check(candidateRecords.every(Boolean),'candidate query missing');
    const valid=candidateRecords.filter(r=>r.constraints_passed).length,c=row.coverage;check(object(c)&&c.expected===scenarioIds.length&&c.valid===valid&&c.unsupported===scenarioIds.length-valid&&c.complete===(valid===scenarioIds.length),'candidate coverage counts contradict queries');
    check(keys(row.metrics,responseIds),'summary metrics missing');const nominal=recordMap.get(`${row.id}::${center}`);
    for(const spec of raw.responses){const m=row.metrics[spec.id];check(object(m)&&m.unit===spec.unit&&m.direction===spec.direction&&m.complete===c.complete,'metric declaration differs');check(m.nominal===null||finite(m.nominal),'invalid nominal metric');check(nominal.constraints_passed?same(m.nominal,nominal.outputs[spec.id]):m.nominal===null,'nominal summary differs from center');if(c.complete){const values=candidateRecords.map(r=>r.outputs[spec.id]);check(finite(m.min)&&finite(m.max)&&same(m.min,Math.min(...values))&&same(m.max,Math.max(...values))&&m.min<=m.nominal&&m.nominal<=m.max,'metric extrema contradict queries');}else check(m.min===null&&m.max===null&&m.relative_span_pct===null,'incomplete coverage cannot carry a complete interval');check(m.relative_span_pct===null?(typeof m.relative_span_reason==='string'&&m.relative_span_reason.length>0):(finite(m.relative_span_pct)&&m.relative_span_pct>=0&&m.relative_span_reason===null),'invalid relative span');if(m.nominal===0)check(m.relative_span_pct===null,'zero nominal denominator must retain null span');if(c.complete&&m.nominal!==0){const difference=m.max-m.min,span=(finite(difference)?difference/Math.abs(m.nominal):m.max/Math.abs(m.nominal)-m.min/Math.abs(m.nominal))*100;check(finite(span)?same(m.relative_span_pct,span):m.relative_span_pct===null&&m.relative_span_reason==='nonfinite_relative_span','relative span contradicts min/max/nominal');}}
    summaries.set(row.id,row);
  }
  const complete=raw.candidates.every(r=>r.coverage.complete);check(raw.rank_complete===complete,'global rank completeness contradicts query coverage');
  check(Array.isArray(raw.preferences)&&object(raw.nominal_anchors),'missing ranking structures');
  if(!complete){check(raw.preferences.length===0&&Object.keys(raw.nominal_anchors).length===0,'incomplete queries cannot carry global rankings');text(raw.rank_incomplete_reason,'rank incomplete reason');}
  else {
    check(raw.rank_incomplete_reason===null,'complete ranking has an incomplete reason');check(keys(raw.nominal_anchors,responseIds),'nominal anchors missing');
    for(const spec of raw.responses){const a=raw.nominal_anchors[spec.id],values=raw.candidates.map(r=>r.metrics[spec.id].nominal);check(object(a)&&a.unit===spec.unit&&a.direction===spec.direction&&same(a.min,Math.min(...values))&&same(a.max,Math.max(...values))&&a.constant===constant(a.min,a.max),'nominal anchor mismatch');}
    unique(raw.preferences,'ranking preferences',preferenceIds.length,preferenceIds.length);
    for(const preference of raw.preferences){
      check(preferenceIds.includes(preference.id),'unknown ranking preference');numericMap(preference.weights,responseIds,'normalized preference weights');const declared=config.preferences.find(r=>r.id===preference.id).weights,max=Math.max(...Object.values(declared)),sum=Object.values(declared).reduce((a,b)=>a+b/max,0);check(responseIds.every(key=>same(preference.weights[key],declared[key]/max/sum)),'normalized preference weights differ');
      unique(preference.candidates,'rank candidates',candidateIds.length,candidateIds.length);unique(preference.scenarios,'rank scenarios',scenarioIds.length,scenarioIds.length);
      for(const scenario of preference.scenarios){check(scenarioIds.includes(scenario.id),'unknown ranked scenario');numericMap(scenario.scores,candidateIds,'scenario scores');numericMap(scenario.ranks,candidateIds,'scenario ranks');check(candidateIds.every(key=>scenario.scores[key]>=0&&scenario.scores[key]<=1&&scenario.ranks[key]>=1&&scenario.ranks[key]<=candidateIds.length),'invalid score or rank');const expectedRanks=exportedRanks(scenario.scores,candidateIds);check(candidateIds.every(key=>scenario.ranks[key]===expectedRanks[key]),'scenario ranks contradict exported scores');check(Array.isArray(scenario.top_ids)&&scenario.top_ids.length>0&&new Set(scenario.top_ids).size===scenario.top_ids.length&&scenario.top_ids.every(key=>candidateIds.includes(key)),'invalid leading IDs');const minimum=Math.min(...Object.values(scenario.ranks)),leaders=candidateIds.filter(key=>scenario.ranks[key]===minimum);check(leaders.length===scenario.top_ids.length&&leaders.every(key=>scenario.top_ids.includes(key)),'leading IDs contradict ranks');const correlation=scenario.spearman_vs_nominal;check(object(correlation)&&(correlation.value===null?typeof correlation.reason==='string':finite(correlation.value)&&Math.abs(correlation.value)<=1&&correlation.reason===null),'invalid Spearman field');}
      const nominal=preference.scenarios.find(r=>r.id===center);
      for(const scenario of preference.scenarios){const expected=rankCorrelation(nominal.ranks,scenario.ranks,candidateIds);check(expected===null?scenario.spearman_vs_nominal.value===null:same(expected,scenario.spearman_vs_nominal.value),'Spearman differs from exported ranks');}
      for(const row of preference.candidates){check(candidateIds.includes(row.id)&&finite(row.nominal_score)&&same(row.nominal_score,nominal.scores[row.id])&&same(row.nominal_rank,nominal.ranks[row.id]),'nominal rank summary differs');const ranks=preference.scenarios.map(s=>s.ranks[row.id]);check(same(row.rank_min,Math.min(...ranks))&&same(row.rank_max,Math.max(...ranks)),'rank range differs');check(finite(row.top_share_pct)&&row.top_share_pct>=0&&row.top_share_pct<=100,'invalid leading share');const share=preference.scenarios.reduce((sum,s)=>sum+(s.top_ids.includes(row.id)?1/s.top_ids.length:0),0)/scenarioIds.length*100;check(same(row.top_share_pct,share),'leading share contradicts selected scenarios');}
      const total=preference.candidates.reduce((a,b)=>a+b.top_share_pct,0);check(same(total,100)&&same(preference.total_top_share_pct,total),'leading shares do not sum to 100');
    }
  }
  return {raw,kind:raw.kind,robustness:true,bundle:false,profileId:raw.profile_id,modelHash:raw.model_sha256,evidence:raw.evidence_type,inputs:raw.inputs,responses:raw.responses,
    rows,pairs:[],candidates:raw.candidates,preferences:raw.preferences,rankComplete:complete,config,exploratory:raw.exploratory,
    declaredEnabled:false,independentlyVerified:false,validCount:rows.filter(r=>r.displayValid).length,failedCount:rows.filter(r=>!r.displayValid).length};
}

export function robustnessMetricSeries(artifact,responseId){
  check(artifact.responses.some(r=>r.id===responseId),'choose a declared response');
  return artifact.candidates.filter(r=>r.coverage.complete).map(row=>({id:row.id,...row.metrics[responseId]}));
}
export function robustnessRankSeries(artifact,preferenceId){
  if(!artifact.rankComplete)return [];
  const preference=artifact.preferences.find(row=>row.id===preferenceId);check(Boolean(preference),'choose a declared preference');return preference.candidates;
}
