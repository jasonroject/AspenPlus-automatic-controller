import {triangle,convert,rate,number,rank} from './universal-core.mjs';
import {eligibleCases} from './workspace-state.mjs';

const checked=value=>{
  if(!Number.isFinite(value))throw new Error('Non-finite sensitivity result; check values and units');
  // Nonnegative inventory arithmetic must not create a negative footprint.
  // Retain a diagnostic for invalid arithmetic; never invent zero or erase a
  // valid small positive value using a threshold in arbitrary units.
  if(value<0)throw new Error('Negative sensitivity result from nonnegative inputs; review arithmetic precision and units');
  return value;
};
const nominal=impact=>impact?.cuts.find(c=>c.alpha===1)?.range[0]??null;

// Sum the other nonnegative contributions without subtracting a rounded total.
// Prefix/suffix sums preserve small terms when the omitted term is much larger.
function otherContributions(entries){
  const prefix=[0],suffix=Array(entries.length+1).fill(0);
  for(let i=0;i<entries.length;i++)prefix.push(prefix[i]+entries[i][1]);
  for(let i=entries.length-1;i>=0;i--)suffix[i]=suffix[i+1]+entries[i][1];
  return new Map(entries.map(([id],i)=>[id,prefix[i]+suffix[i+1]]));
}

// OAT diagnostics use declared bounds, hold every other input at its mode, and
// preserve shared factor identity across all matching inventory rows.
export function inputUncertainty(project,report,caseId,category){
  const record=project.cases.find(c=>c.id===caseId),result=report?.results.find(r=>r.id===caseId);
  if(!record||!result)return {available:false,caseId,category,varying:[],fixedCounts:{inventory:0,factors:0,product:0},errors:['Select a calculated case']};
  const impact=result.impacts.find(i=>i.category===category),inventory=project.inventory.filter(i=>i.case_id===caseId);
  const inventoryByFactor=new Map();
  for(const row of inventory){if(!inventoryByFactor.has(row.factor_id))inventoryByFactor.set(row.factor_id,[]);inventoryByFactor.get(row.factor_id).push(row);}
  const usedFactors=project.factors.filter(f=>f.category===category&&inventoryByFactor.has(f.id)),factorById=new Map(usedFactors.map(f=>[f.id,f]));
  const contributionById=new Map(impact?.contributions.map(c=>[c.id,c])||[]),contributionByFactor=new Map();
  for(const row of impact?.contributions||[])contributionByFactor.set(row.factor_id,(contributionByFactor.get(row.factor_id)||0)+row.nominal);
  const available=impact?.complete===true,total=available?nominal(impact):null,cal=project.meta.calorie_J;
  const otherById=available?otherContributions([...contributionById].map(([id,row])=>[id,row.nominal])):new Map();
  const otherByFactor=available?otherContributions([...contributionByFactor]):new Map();
  const diagnostics={available,caseId,category,unit:impact?.unit?`${impact.unit}/kg`:null,nominal:total,combinedSupport:available?[...impact.cuts[0].range]:null,
    varying:[],fixedCounts:{inventory:0,factors:0,product:0},errors:[]};
  let product,allocation;
  if(available){product=convert(record.product_rate,record.mass_unit,'mass',cal);allocation=number(record.allocation);}
  function include(kind,row,values,unit,affected,evaluate){
    const key=kind==='inventory'?'inventory':kind==='factor'?'factors':'product';
    if(values[0]===values[1]&&values[1]===values[2]){diagnostics.fixedCounts[key]++;return;}
    let support=null,error=null;
    if(available)try{support=[checked(evaluate(values[0])),checked(evaluate(values[2]))].sort((a,b)=>a-b);}catch(e){error=e.message;diagnostics.errors.push(`${kind} ${row.id}: ${e.message}`);}
    diagnostics.varying.push({kind,id:row.id,label:row.name||row.id,unit,lower:values[0],mode:values[1],upper:values[2],source:row.source||'',affectedInventory:affected,impactSupport:support,error});
  }
  try{
    const bounds=triangle(record.product_rate,record.product_low,record.product_high,'Product');
    include('product',record,bounds,record.mass_unit,inventory.map(i=>i.id),v=>total*product/convert(v,record.mass_unit,'mass',cal));
  }catch(e){diagnostics.errors.push(e.message);}
  for(const row of inventory)try{
    const bounds=triangle(row.amount,row.amount_low,row.amount_high,`Inventory ${row.id}`);
    const factor=factorById.get(row.factor_id);
    include('inventory',row,bounds,row.unit,[row.id],v=>otherById.get(row.id)+rate(v,row.unit,factor.denominator_unit,cal)*number(factor.value)*allocation/product);
  }catch(e){diagnostics.errors.push(e.message);}
  for(const factor of usedFactors)try{
    const bounds=triangle(factor.value,factor.low,factor.high,`Factor ${factor.id}`),affected=inventoryByFactor.get(factor.id);
    include('factor',factor,bounds,`${factor.impact_unit}/${factor.denominator_unit}`,affected.map(i=>i.id),v=>otherByFactor.get(factor.id)+affected.reduce((sum,row)=>sum+rate(row.amount,row.unit,factor.denominator_unit,cal)*v*allocation/product,0));
  }catch(e){diagnostics.errors.push(e.message);}
  return diagnostics;
}

// Preference-grid coverage is a deterministic design, not a probability model.
// Three basis-weight evaluations reuse the core's exact desirability scoring.
export function scanPreferences(report,category,comparable,divisions=10){
  if(!comparable)throw new Error('Confirm comparable functions, boundaries and allocation before a preference scan');
  if(!Number.isInteger(divisions)||divisions<1||divisions>20)throw new Error('Preference divisions must be an integer from 1 to 20');
  const candidates=eligibleCases(report,category);
  if(candidates.length<2)throw new Error('At least two complete, comparable cases are needed for a preference scan');
  if(candidates.length>200)throw new Error('Preference scan supports at most 200 eligible cases; select a smaller project');
  const axes=[[1,0,0],[0,1,0],[0,0,1]].map(weights=>new Map(rank(report,category,weights,true).rows.map(r=>[r.id,r.score])));
  const rows=candidates.map(r=>({id:r.id,leaderInclusions:0,sharedLeaderCount:0,preferenceShare:0,rankRange:[candidates.length,1]}));
  const records=new Map(rows.map(row=>[row.id,row])),samples=[];
  const tieTolerance=1e-12;
  for(let energy=0;energy<=divisions;energy++)for(let impact=0;impact<=divisions-energy;impact++){
    const weights=[energy,impact,divisions-energy-impact].map(v=>v/divisions);
    const scores=rows.map(row=>({id:row.id,score:weights.reduce((sum,w,k)=>sum+w*axes[k].get(row.id),0)})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
    const leaders=scores.filter(row=>Math.abs(row.score-scores[0].score)<=tieTolerance).map(row=>row.id);
    for(const id of leaders){records.get(id).leaderInclusions++;records.get(id).sharedLeaderCount+=1/leaders.length;}
    let start=0;
    while(start<scores.length){let end=start+1;while(end<scores.length&&Math.abs(scores[end].score-scores[start].score)<=tieTolerance)end++;
      for(let i=start;i<end;i++){const range=records.get(scores[i].id).rankRange;range[0]=Math.min(range[0],start+1);range[1]=Math.max(range[1],end);}start=end;}
    samples.push({weights,leaders});
  }
  for(const row of rows)row.preferenceShare=row.sharedLeaderCount/samples.length;
  rows.sort((a,b)=>b.preferenceShare-a.preferenceShare||a.rankRange[0]-b.rankRange[0]||a.id.localeCompare(b.id));
  return {category,divisions,sampleCount:samples.length,tieTolerance,rows,samples,excluded:report.results.filter(r=>!records.has(r.id)).map(r=>r.id),
    definition:'Nominal scoring over a fixed simplex grid of energy/impact/yield priorities. Tied leading credit is shared equally. Rank spans include tied positions. These are preference-design shares, not probabilities or physical robustness.'};
}
