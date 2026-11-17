// Planning only: the browser never opens or executes an Aspen model.
const object=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value)&&!value.includes('..');
const inputPath=value=>typeof value==='string'&&/^\\Data\\(?:Blocks|Streams)\\[^\\]+\\Input\\.+$/.test(value)&&!value.includes('..')&&!/[\x00-\x1f]/.test(value);
export function inspectProfile(profile){
  const errors=[],variables=Array.isArray(profile?.variables)?profile.variables:[];
  if(!object(profile)||profile.profile_version!==1)errors.push('Expected profile_version 1');
  if(profile?.review!==undefined&&(!object(profile.review)||profile.review.state!=='reviewed'))errors.push('Profile review is incomplete. Complete native node, unit and mapping review before planning a scan.');
  if(!identifier(profile?.id))errors.push('A simple profile ID without paths is required');
  if(profile?.name!==undefined&&(typeof profile.name!=='string'||!profile.name.trim()))errors.push('Profile name must be readable text');
  if(typeof profile?.model?.sha256!=='string'||!/^[a-f0-9]{64}$/.test(profile.model.sha256))errors.push('A lowercase 64-character model SHA-256 is required');
  if(!Array.isArray(profile?.variables)||!variables.length||variables.length>20)errors.push('Declare 1–20 writable input variables');
  const seen=new Set(),paths=new Set();
  for(const variable of variables){
    if(!object(variable)){errors.push('Each variable must be an object');continue;}
    const label=typeof variable.id==='string'?variable.id:'Variable';
    if(!identifier(variable.id)||seen.has(variable.id))errors.push('Variable IDs must be simple and unique');seen.add(variable.id);
    if(!inputPath(variable.path))errors.push(`${label}: only explicit Blocks/Streams Input nodes can be scanned`);
    if(paths.has(variable.path))errors.push(`${label}: duplicate input node path`);paths.add(variable.path);
    if(typeof variable.native_unit!=='string')errors.push(`${label}: declare the native unit (an empty string means unitless)`);
    if(!Number.isFinite(variable.min)||!Number.isFinite(variable.max)||variable.min>=variable.max)errors.push(`${label}: finite bounds with min below max are required`);
  }
  const independent=new Map(variables.filter(object).map(variable=>[variable.id,variable]));
  for(const field of ['linked_inputs','fixed_inputs']){
    const entries=profile?.[field]===undefined?[]:profile[field];
    if(!Array.isArray(entries)||entries.length>100){errors.push(`${field}: expected at most 100 reviewed controls`);continue;}
    for(const entry of entries){
      if(!object(entry)){errors.push(`${field}: each control must be an object`);continue;}
      const allowed=['id','path','native_unit','source',field==='linked_inputs'?'source_id':'value'];
      if(Object.keys(entry).some(key=>!allowed.includes(key)))errors.push(`${field}: unsupported control fields`);
      if(!identifier(entry.id)||seen.has(entry.id))errors.push(`${field}: control IDs must be simple and unique`);seen.add(entry.id);
      if(!inputPath(entry.path)||paths.has(entry.path))errors.push(`${field}: explicit, unique input node paths are required`);paths.add(entry.path);
      if(typeof entry.native_unit!=='string'||entry.source!==undefined&&typeof entry.source!=='string')errors.push(`${field}: declare text units and source`);
      if(field==='linked_inputs'){
        const source=independent.get(entry.source_id);
        if(!identifier(entry.source_id)||!source||entry.native_unit!==source.native_unit)errors.push('Linked inputs must reference an independent variable with exactly matching native units');
      }else if(!Number.isFinite(entry.value))errors.push('Fixed input values must be finite numbers');
    }
  }
  if(!object(profile?.mapping?.product)||!Array.isArray(profile?.mapping?.streams)||!profile.mapping.streams.length||!Array.isArray(profile?.mapping?.blocks)||!profile.mapping.blocks.length)errors.push('Review product, stream topology and block mappings in the profile');
  if(!Array.isArray(profile?.solver_checks)||!profile.solver_checks.length)errors.push('Declare native solver acceptance checks');
  const maximum=profile?.limits?.max_cases===undefined?100:profile.limits.max_cases;
  if(profile?.limits!==undefined&&!object(profile.limits))errors.push('Profile limits must be an object');
  if(!Number.isInteger(maximum)||maximum<1||maximum>100)errors.push('max_cases must be an integer from 1 to 100');
  return {errors,ready:errors.length===0,variables:variables.filter(object),maxCases:Number.isInteger(maximum)&&maximum>=1&&maximum<=100?maximum:0};
}
function frozenHoldouts(combinations,dimensions){
  const count=Math.max(2,Math.round(combinations.length*.2)),minimumTraining=Math.max(6,2*dimensions+2);
  const candidates=combinations.map((point,index)=>({point,index})).filter(({point})=>!point.coordinates.every(value=>value===0||value===1));
  if(combinations.length-count<minimumTraining||candidates.length<count)throw new Error(`Frozen design needs at least ${minimumTraining} training cases and 2 held-out cases while keeping all corners in training. Use a denser grid or verification mode.`);
  const distance=(a,b)=>a.reduce((sum,value,i)=>sum+(value-b[i])**2,0),center=Array(dimensions).fill(.5),selected=[];
  // Center-first, then maximin spacing in normalized design coordinates.
  while(selected.length<count){
    let best=null,bestDistance=-Infinity;
    for(const candidate of candidates){
      if(selected.includes(candidate))continue;
      const score=selected.length?Math.min(...selected.map(other=>distance(candidate.point.coordinates,other.point.coordinates))):-distance(candidate.point.coordinates,center);
      if(best===null||score>bestDistance+1e-12){best=candidate;bestDistance=score;}
    }
    selected.push(best);
  }
  return new Set(selected.map(row=>row.index));
}
export function buildPlan(profile,settings,splitMode='verification'){
  const inspection=inspectProfile(profile);if(!inspection.ready)throw new Error(inspection.errors.join('; '));
  if(!object(settings))throw new Error('Provide scan settings for each reviewed variable');
  if(!['verification','frozen'].includes(splitMode))throw new Error('Unknown split mode');
  let combinations=[{parameters:{},coordinates:[]}];
  for(const variable of profile.variables){
    const row=settings[variable.id];
    if(!object(row))throw new Error(`${variable.id}: missing scan settings`);
    const {min,max,count}=row;
    if(![min,max,count].every(Number.isFinite)||!Number.isInteger(count)||count<1||count>100)throw new Error(`${variable.id}: invalid point count or bounds`);
    if(min<variable.min||max>variable.max||min>max)throw new Error(`${variable.id}: the scan must stay inside the reviewed bounds`);
    if(count===1&&min!==max)throw new Error(`${variable.id}: one point requires equal min and max`);
    if(count>1&&min===max)throw new Error(`${variable.id}: repeated identical points are not a scan`);
    if(splitMode==='frozen'&&count===1)throw new Error(`${variable.id}: every surrogate input must vary in a frozen design. Use verification mode for fixed inputs.`);
    if(combinations.length*count>inspection.maxCases)throw new Error(`Plan exceeds the ${inspection.maxCases}-case limit`);
    const values=Array.from({length:count},(_,i)=>i===0?min:i===count-1?max:min*(1-i/(count-1))+max*(i/(count-1)));
    if(values.some(value=>!Number.isFinite(value)||value<min||value>max))throw new Error(`${variable.id}: generated points must be finite and inside the reviewed bounds`);
    if(new Set(values).size!==values.length)throw new Error(`${variable.id}: range is too narrow for distinct numeric values`);
    combinations=combinations.flatMap(point=>values.map((value,index)=>({parameters:{...point.parameters,[variable.id]:value},coordinates:[...point.coordinates,count===1?0:index/(count-1)]})));
  }
  const holdouts=splitMode==='frozen'?frozenHoldouts(combinations,profile.variables.length):new Set();
  return {plan_version:1,profile_id:profile.id,model_sha256:profile.model.sha256,
    split_design:{method:splitMode==='frozen'?'frozen-corners-training-center-first-maximin':'verification-only',training_count:splitMode==='frozen'?combinations.length-holdouts.size:0,holdout_count:holdouts.size,verification_count:splitMode==='verification'?combinations.length:0,readiness:'A planned split is not evidence of model accuracy or physical validation'},
    points:combinations.map((point,index)=>({id:`case-${String(index+1).padStart(3,'0')}`,parameters:point.parameters,split:splitMode==='frozen'?(holdouts.has(index)?'holdout':'training'):'verification'}))};
}
