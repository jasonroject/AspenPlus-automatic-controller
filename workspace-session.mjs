// Keep this tab's working data local while visiting charts, docs and the HTL lab.
import {TABLES} from './universal-core.mjs';
export const SESSION_KEY='process-studio-workspace-v1';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const cell=value=>value===null||value===undefined||['string','number','boolean'].includes(typeof value);
export function validateScanAudit(audit){
  if(audit===undefined||audit===null)return audit;
  if(!object(audit))throw new Error('Scan audit must be an object');
  if(audit.cases!==undefined){
    if(!Array.isArray(audit.cases))throw new Error('Scan audit cases must be an array');
    for(const [index,row] of audit.cases.entries()){
      if(!object(row))throw new Error(`Scan audit row ${index+1} must be an object`);
      for(const field of ['id','split','source','error'])if(row[field]!==undefined&&row[field]!==null&&typeof row[field]!=='string')throw new Error(`Scan audit row ${index+1} ${field} must be text or null`);
      if(row.accepted!==undefined&&row.accepted!==null&&typeof row.accepted!=='boolean')throw new Error(`Scan audit row ${index+1} accepted must be boolean or null`);
      if(row.gates!==undefined){
        if(!object(row.gates))throw new Error(`Scan audit row ${index+1} gates must be an object`);
        for(const gate of ['control_succeeded','solver_accepted','numerical_closure','lcia_complete','metric_inputs_complete'])if(row.gates[gate]!==undefined&&typeof row.gates[gate]!=='boolean')throw new Error(`Scan audit row ${index+1} ${gate} must be boolean`);
      }
    }
  }
  for(const key of ['planned','attempted','solver_accepted','numerically_closed','lcia_complete','accepted','failed'])if(audit[key]!==undefined&&(!Number.isInteger(audit[key])||audit[key]<0))throw new Error(`Scan audit ${key} must be a nonnegative integer`);
  return audit;
}
export function validateWorkspaceShape(project){
  // This is an editable-data guard, not a calculation gate. Missing values,
  // invalid numeric strings and incomplete rows remain available for correction.
  if(!object(project)||project.schema_version!==1)throw new Error('Expected a project object with schema_version 1');
  if(!object(project.meta))throw new Error('Project meta must be an object');
  for(const field of ['name','boundary','functional_unit','allocation_method','enthalpy_basis','calorie_J','steady_state','inventory_complete','comparable_cases']){
    if(!cell(project.meta[field]))throw new Error(`Project metadata ${field} must be a scalar value`);
  }
  const warnings=project.meta.native_warnings;
  if(warnings!==undefined&&warnings!==null&&typeof warnings!=='string'&&!(Array.isArray(warnings)&&warnings.every(item=>typeof item==='string')))throw new Error('Native warnings must be text or a list of text');
  validateScanAudit(project.meta.scan_audit);
  if(project.meta.locally_modified!==undefined&&typeof project.meta.locally_modified!=='boolean')throw new Error('Local modification flag must be boolean');
  if(project.meta.origin!==undefined){
    const origin=project.meta.origin;
    if(!object(origin))throw new Error('Historical origin must be an object');
    for(const field of ['scope','evidence_type','source_sha256','model_profile_id'])if(origin[field]!==undefined&&origin[field]!==null&&typeof origin[field]!=='string')throw new Error(`Historical origin ${field} must be text or null`);
    if(!cell(origin.name))throw new Error('Historical origin name must be a scalar value');
    validateScanAudit(origin.scan_audit);
    const historicalWarnings=origin.native_warnings;
    if(historicalWarnings!==undefined&&historicalWarnings!==null&&typeof historicalWarnings!=='string'&&!(Array.isArray(historicalWarnings)&&historicalWarnings.every(item=>typeof item==='string')))throw new Error('Historical native warnings must be text or a list of text');
  }
  for(const [table,fields] of Object.entries(TABLES)){
    if(!Array.isArray(project[table]))throw new Error(`Project ${table} must be an array`);
    for(const [index,row] of project[table].entries()){
      if(!object(row))throw new Error(`${table} row ${index+1} must be an object`);
      for(const field of fields)if(!cell(row[field]))throw new Error(`${table} row ${index+1} ${field} must be a scalar value`);
    }
  }
  return project;
}
export function readSession(storage){
  try{const state=JSON.parse(storage.getItem(SESSION_KEY));
    if(!object(state)||state.version!==1)return null;
    validateWorkspaceShape(state.project);
    if(state.draft!==undefined&&state.draft!==null&&typeof state.draft!=='string')return null;
    if(state.sheets!==undefined&&(!Array.isArray(state.sheets)||state.sheets.some(sheet=>!object(sheet)||typeof sheet.name!=='string'||!Array.isArray(sheet.rows)||sheet.rows.some(row=>!Array.isArray(row)||row.some(value=>!cell(value))))))return null;
    if(state.applied!==undefined&&(!Array.isArray(state.applied)||state.applied.some(index=>!Number.isInteger(index)||index<0||index>=(state.sheets?.length??0))))return null;
    if(state.mappings!==undefined&&(!Array.isArray(state.mappings)||state.mappings.some(row=>!object(row)||typeof row.field!=='string'||!cell(row.column)||!cell(row.constant))))return null;
    if(state.reviewedHeader!==undefined&&state.reviewedHeader!==null&&(!Array.isArray(state.reviewedHeader)||state.reviewedHeader.some(value=>!cell(value))))return null;
    if(state.weights!==undefined&&(!Array.isArray(state.weights)||state.weights.length!==3||state.weights.some(value=>!cell(value))))return null;
    if(['sheet','header','type','mode','category','caseId'].some(key=>!cell(state[key])))return null;
    return state;
  }catch{return null;}
}
export function writeSession(storage,state){
  try{storage.setItem(SESSION_KEY,JSON.stringify({...state,version:1}));return true;}catch{
    // A failed update must never restore an older calculation as the current one.
    try{storage.removeItem(SESSION_KEY);}catch{}
    return false;
  }
}
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export function referenceLink(project,reference){
  // A copied case ID/hash alone cannot identify modified inputs as native evidence.
  let matches=false;
  try{matches=Boolean(reference)&&JSON.stringify(canonical(project))===JSON.stringify(canonical(reference));}catch{/* Unsupported nesting can never establish reference identity. */}
  return {matches,href:matches?'pipeline.html?temperature=325&length=8.5&scenario=HR&from=import&reference=htl':'pipeline.html?from=import'};
}
