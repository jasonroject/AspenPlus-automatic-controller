// Display contracts only. Canonical Python digests and native provenance are not
// independently verified by this browser viewer, which never executes a model.
import {inspectRobustnessArtifact} from './robustness-artifact-data.mjs';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw new Error(message);};
const groups=new Set(['training','holdout','verification']);
const evaluationGroups=new Set(['holdout','verification']);
const gates=['control_succeeded','solver_accepted','numerical_closure','lcia_complete','metric_inputs_complete'];
function optionalText(value,name){if(value!==undefined&&typeof value!=='string')fail(`${name} must be text`);return value??'';}
function messages(value,name){if(value!==undefined&&(!Array.isArray(value)||value.some(item=>typeof item!=='string')))fail(`${name} must be a list of text messages`);return value??[];}
function accountingBasis(value){
  if(value===undefined||value===null)return null;
  if(!object(value))fail('Accounting basis must be an object or null');
  const basis={};
  for(const key of ['functional_unit','boundary','allocation_method','enthalpy_basis']){
    if(value[key]!==undefined&&value[key]!==null&&typeof value[key]!=='string')fail(`Accounting basis ${key} must be text or null`);
    basis[key]=value[key]??null;
  }
  if(value.calorie_J!==undefined&&value.calorie_J!==null&&(!Number.isFinite(value.calorie_J)||value.calorie_J<=0))fail('Accounting basis calorie_J must be positive and finite or null');
  return basis;
}
function declarations(value,name){
  if(!Array.isArray(value)||!value.length||value.length>30)fail(`Missing or excessive ${name} declarations`);
  const ids=new Set();
  return value.map(row=>{
    if(!object(row)||typeof row.id!=='string'||!row.id.trim()||row.id.length>100||ids.has(row.id)||typeof row.unit!=='string'||(name==='response'&&!row.unit.trim()))fail(`Invalid or duplicate ${name} declaration`);
    ids.add(row.id);return row;
  });
}
function records(value,name){
  if(!Array.isArray(value)||value.length>5000)fail(`Expected at most 5,000 ${name} records`);
  const ids=new Set();
  return value.map(row=>{
    if(!object(row)||typeof row.id!=='string'||!row.id.trim()||row.id.length>100||ids.has(row.id))fail(`Invalid or duplicate ${name} record`);
    ids.add(row.id);
    for(const key of ['split','source','source_id','source_record','error'])if(row[key]!==null)optionalText(row[key],`${name} ${key}`);
    for(const key of ['inputs','outputs','actual','predicted','gates'])if(row[key]!==undefined&&row[key]!==null&&!object(row[key]))fail(`${name} ${key} must be an object or null`);
    return {...row,errors:messages(row.errors,`${name} errors`),warnings:messages(row.warnings,`${name} warnings`)};
  });
}
const numbers=(value,specs)=>object(value)&&specs.every(spec=>Object.hasOwn(value,spec.id)&&Number.isFinite(value[spec.id]));
function validationSummary(value,responses){
  if(!object(value)||!object(value.splits))fail('The bundle has no validation summary');
  messages(value.reasons,'Validation reasons');
  for(const [split,row] of Object.entries(value.splits)){
    if(!object(row)||!Number.isInteger(row.expected)||!Number.isInteger(row.valid)||row.expected<0||row.expected>5000||row.valid<0||row.valid>row.expected||!object(row.metrics))fail(`Malformed validation summary for ${split}`);
    for(const response of responses){
      const metric=Object.hasOwn(row.metrics,response.id)?row.metrics[response.id]:undefined;
      if(metric===undefined||metric===null)continue;
      if(!object(metric))fail(`Malformed validation metrics for ${response.id}`);
      if(metric.unit!==undefined&&metric.unit!==response.unit)fail(`Validation unit differs from the declared response unit: ${response.id}`);
      for(const field of ['mae','rmse','max_relative_error'])if(metric[field]!==undefined&&metric[field]!==null&&(!Number.isFinite(metric[field])||metric[field]<0))fail(`Invalid validation error metric: ${response.id} ${field}`);
    }
  }
  return value;
}
function validationCriteria(value,responses){
  if(value===undefined||value===null)return {};
  if(!object(value))fail('Validation criteria must be an object');
  for(const response of responses){
    const rule=value[response.id];if(rule===undefined)continue;
    if(!object(rule)||rule.unit!==response.unit)fail(`Validation criterion has a malformed declaration or mismatched unit: ${response.id}`);
    for(const field of ['max_mae','max_rmse','max_relative_error'])if(rule[field]!==undefined&&(!Number.isFinite(rule[field])||rule[field]<0))fail(`Invalid validation criterion: ${response.id} ${field}`);
    if(rule.relative_floor!==undefined&&(!Number.isFinite(rule.relative_floor)||rule.relative_floor<=0))fail(`Invalid relative-error floor: ${response.id}`);
    if(rule.max_relative_error!==undefined&&rule.relative_floor===undefined)fail(`Relative-error criterion requires a declared floor: ${response.id}`);
  }
  return value;
}
export function inspectArtifact(value){
  if(object(value)&&value.kind==='process_robustness')return inspectRobustnessArtifact(value);
  if(!object(value)||!['process_surrogate','surrogate_prediction'].includes(value.kind))fail('Choose a process surrogate bundle or prediction result JSON');
  if(typeof value.model_sha256!=='string'||!/^[0-9a-f]{64}$/.test(value.model_sha256))fail('The exported model SHA-256 is missing or malformed');
  const bundle=value.kind==='process_surrogate';
  if((bundle?value.bundle_version:value.result_version)!==1)fail('Unsupported model artifact version');
  const metadata=bundle?value.dataset_metadata:value;
  if(!object(metadata))fail('Missing model declarations');
  const inputs=declarations(metadata.inputs,'input'),responses=declarations(metadata.responses,'response'),basis=accountingBasis(bundle?metadata.basis:value.dataset_metadata?.basis);
  const observations=records(bundle?value.observations:value.records,bundle?'observation':'prediction');
  const rows=observations.map(row=>{
    const issues=[];
    if((bundle?row.accepted:row.constraints_passed)!==true)issues.push('Producer did not mark this record as available.');
    if(bundle&&!groups.has(row.split))issues.push('Unknown observation group.');
    if(bundle&&row.gates!==undefined&&(!object(row.gates)||gates.some(key=>row.gates[key]!==true)))issues.push('One or more exported audit gates are not true.');
    if(!numbers(row.inputs,inputs))issues.push('Missing finite declared inputs.');
    if(!numbers(row.outputs,responses))issues.push('Missing finite declared outputs.');
    return {...row,displayValid:!issues.length,displayIssues:issues};
  });
  const validation=bundle?validationSummary(value.validation,responses):null;
  const criteria=bundle?validationCriteria(validation.criteria??value.validation_policy,responses):{};
  const pairs=bundle?records(validation.records,'validation').map(row=>{
    const issues=[];
    if(!evaluationGroups.has(row.split))issues.push('This group is not held-out or verification evidence.');
    if(row.constraints_passed!==true)issues.push('Producer did not mark this evaluation as available.');
    if(!numbers(row.actual,responses)||!numbers(row.predicted,responses))issues.push('Missing finite supplied or predicted outputs.');
    return {...row,displayValid:!issues.length,displayIssues:issues};
  }):[];
  const trainingWarnings=bundle?value.training?.warnings??[]:[];
  if(!Array.isArray(trainingWarnings)||trainingWarnings.some(row=>!object(row)||typeof row.response!=='string'||typeof row.message!=='string'))fail('Training warnings must identify a response and text message');
  return {raw:value,kind:value.kind,bundle,basis,profileId:optionalText(value.profile_id,'Profile ID'),modelHash:value.model_sha256,evidence:optionalText(value.evidence_type,'Evidence type')||'unspecified',inputs,responses,rows,pairs,validation,criteria,
    declaredEnabled:bundle&&value.prediction_enabled===true,independentlyVerified:false,
    validCount:rows.filter(row=>row.displayValid).length,failedCount:rows.filter(row=>!row.displayValid).length,
    validPairCount:pairs.filter(row=>row.displayValid).length,failedPairCount:pairs.filter(row=>!row.displayValid).length,
    warningCount:rows.filter(row=>row.warnings.length).length,trainingWarnings};
}
export function artifactSeries(artifact,inputId,responseId){
  if(!artifact.inputs.some(row=>row.id===inputId)||!artifact.responses.some(row=>row.id===responseId))throw new Error('Choose declared input and response fields');
  return {observations:artifact.rows.filter(row=>row.displayValid).map(row=>({id:row.id,x:row.inputs[inputId],y:row.outputs[responseId],split:row.split||'prediction',source:row.source||row.source_id||''})),
    pairs:artifact.pairs.filter(row=>row.displayValid).map(row=>({id:row.id,x:row.actual[responseId],y:row.predicted[responseId],split:row.split,source:row.source||''}))};
}
export function finiteDomain(values){
  const finite=values.filter(Number.isFinite);if(!finite.length)return [0,1];
  const low=Math.min(...finite),high=Math.max(...finite),scale=Math.max(Math.abs(low),Math.abs(high))||1;
  const padding=(high/scale-low/scale)*.08||Math.abs(low/scale)*.08||1;
  const bounds=[Math.max(-Number.MAX_VALUE,(low/scale-padding)*scale),Math.min(Number.MAX_VALUE,(high/scale+padding)*scale)];
  // Subnormal values may round padded endpoints to the same representable number.
  return bounds[0]===bounds[1]?[Math.min(0,low),Math.max(0,high)]:bounds;
}
export function domainFraction(value,domain){
  const scale=Math.max(Math.abs(domain[0]),Math.abs(domain[1]))||1;
  return (value/scale-domain[0]/scale)/(domain[1]/scale-domain[0]/scale);
}
export const domainTick=(domain,fraction)=>domain[0]*(1-fraction)+domain[1]*fraction;
export function recordPage(rows,page=0,size=50){
  const count=Math.max(1,Math.ceil(rows.length/size)),current=Number.isInteger(page)?Math.max(0,Math.min(count-1,page)):0,start=current*size;
  return {page:current,count,total:rows.length,start:rows.length?start+1:0,end:Math.min(start+size,rows.length),rows:rows.slice(start,start+size)};
}
