import {validateProject} from './universal-core.mjs';

// Preflight guidance is not a replacement for the calculation's detailed checks.
export function readiness(project){
  const meta=project.meta||{},has=key=>Boolean(String(meta[key]??'').trim());
  const checks=[
    {label:'Reference cases',ok:project.cases.length>0,detail:`${project.cases.length} cases · declare product and feed rates`},
    {label:'Process connections',ok:project.streams.length>0&&project.blocks.length>0,detail:`${project.streams.length} streams · ${project.blocks.length} blocks; check signs and units`},
    {label:'Calculation basis',ok:['boundary','functional_unit','allocation_method','enthalpy_basis'].every(has),detail:'Boundary, product basis, allocation and enthalpy reference'},
    {label:'Impact inventory',ok:project.inventory.length>0&&project.factors.length>0,detail:`${project.inventory.length} inventory rows · ${project.factors.length} factors; coverage checked when calculated`},
    {label:'Scope reviewed',ok:meta.inventory_complete===true,detail:'Confirm which external burdens your inventory includes'}
  ];
  let schemaError='';try{validateProject(project);}catch(error){schemaError=error.message;}
  return {checks,schemaError,hasCases:project.cases.length>0,complete:checks.every(c=>c.ok)&&!schemaError};
}

export function eligibleCases(report,category){return report?.results.filter(r=>r.balance.within_tolerance&&!r.issues.length&&r.energy&&r.yield&&r.impacts.some(i=>i.category===category&&i.complete))||[];}

export function resultGuidance(result){
  const errors=[...result.balance.errors,...result.issues,...result.impacts.flatMap(i=>i.errors.map(e=>`${i.category}: ${e}`))];
  if(result.balance.complete&&!result.balance.within_tolerance)errors.unshift('One or more block balances exceed the numerical tolerance. Check signs, units and stream connections.');
  if(!result.impacts.length)errors.push('Impact results are unavailable. Review reference-product inputs and factor coverage.');
  if(!result.yield)errors.push('Target/feed yield is unavailable. Supply a positive feed rate and valid product rates in Cases to enable comparison.');
  return {errors:[...new Set(errors)],balanced:result.balance.within_tolerance,completeImpact:result.impacts.some(i=>i.complete)};
}
