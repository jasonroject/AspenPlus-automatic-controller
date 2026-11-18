// Applied local changes are a new input set, not a new native simulation run.
// The caller supplies the before/after projects only when edits are applied;
// loading files, staging worksheets and changing view controls do not call this.
const originFields=['name','evidence_type','source_sha256','model_profile_id','scan_audit','native_warnings','omitted_failed_case_ids','physical_validation'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

function equalJSON(left,right){
  // Iterative comparison also handles deeply nested imported extra metadata.
  const pending=[[left,right]];
  while(pending.length){
    const [a,b]=pending.pop();if(Object.is(a,b))continue;
    if(a===null||b===null||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
    const keys=Object.keys(a);if(keys.length!==Object.keys(b).length)return false;
    for(const key of keys){if(!Object.hasOwn(b,key))return false;pending.push([a[key],b[key]]);}
  }
  return true;
}

export function applyProjectEdit(previous,next){
  if(!object(previous?.meta)||!object(next?.meta))throw new Error('Applied edits require project metadata objects');
  if(equalJSON(previous,next))return next;
  const old=previous.meta;
  // Keep one historical source snapshot. Repeated edits cannot grow a nested
  // audit trail or replace the first source using an edited JSON declaration.
  const origin=old.locally_modified===true&&object(old.origin)
    ?structuredClone(old.origin)
    :Object.fromEntries(originFields.filter(key=>Object.hasOwn(old,key)).map(key=>[key,structuredClone(old[key])]));
  origin.scope='historical_source_only';
  const meta={...next.meta,locally_modified:true,evidence_type:'locally_modified',physical_validation:false,origin};
  for(const key of ['source_sha256','model_profile_id','scan_audit','native_warnings','omitted_failed_case_ids'])delete meta[key];
  return {...next,meta};
}
