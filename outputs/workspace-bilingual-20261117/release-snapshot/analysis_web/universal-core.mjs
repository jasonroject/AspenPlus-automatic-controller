// Pure, browser/Node-compatible accounting. No model-specific factors or kinetics.
export const TABLES = {
  streams: ['case_id','id','from','to','mass_flow','mass_unit','enthalpy_flow','energy_unit','specific_enthalpy','enthalpy_unit','source'],
  blocks: ['case_id','id','heat','power','energy_unit','heat_unit','power_unit','source'],
  cases: ['id','product_rate','product_low','product_high','feed_rate','mass_unit','allocation','source'],
  inventory: ['case_id','id','name','kind','amount','amount_low','amount_high','unit','factor_id','source'],
  factors: ['id','category','value','low','high','denominator_unit','impact_unit','method','source'],
};
const ALIASES = {
  case_id:['case','condition','scenario','工况','方案'], id:['stream id','stream name','block id','block name','设备','物流','编号','id'],
  from:['source block','from block','upstream','入口设备','上游'],to:['destination','to block','downstream','出口设备','下游'],
  mass_flow:['mass flow','mass flow kg h','mass_flow_kg_h','质量流量','质量流量_kg_h'],mass_unit:['mass unit','质量单位','流量单位'],
  enthalpy_flow:['enthalpy flow','enthalpy rate','焓流','焓流率'],energy_unit:['energy unit','power unit','热负荷单位','功率单位'],
  specific_enthalpy:['mass enthalpy','specific enthalpy','比焓','HMX_MASS'],enthalpy_unit:['specific enthalpy unit','比焓单位'],
  heat:['heat duty','heat_kw','热负荷_kW','热负荷','QCALC'],power:['power_kw','电耗_kW','轴功','WNET','功率'],heat_unit:['heat duty unit','热量单位'],power_unit:['shaft work unit','轴功单位'],
  product_rate:['product mass flow','target_kg_h','产品流量'],feed_rate:['feed mass flow','进料流量'],
  product_low:['product minimum'],product_high:['product maximum'],allocation:['allocation share','分配系数'],
  name:['名称','flow name'],kind:['inventory type','清单类型'],amount:['quantity','清单流量','用量'],
  amount_low:['quantity low'],amount_high:['quantity high'],unit:['units','单位'],factor_id:['factor','因子编号'],
  category:['impact category','影响类别'],value:['factor value','emission factor','排放因子'],low:['lower','minimum','下限'],high:['upper','maximum','上限'],
  denominator_unit:['factor denominator','因子分母单位'],impact_unit:['impact unit','影响单位'],method:['LCIA method','方法'],source:['provenance','reference','来源'],
};
export const blankProject = () => ({schema_version:1,meta:{name:'Imported process',steady_state:true,enthalpy_basis:'',boundary:'',functional_unit:'1 kg declared target product',allocation_method:'',calorie_J:null,inventory_complete:false,comparable_cases:false},...Object.fromEntries(Object.keys(TABLES).map(k=>[k,[]]))});
export const clean = x => String(x??'').trim();
const normalized = x=>clean(x).toLowerCase().replace(/[\s_\-./()[\]°]/g,'');
export const present = x=>x!==null&&x!==undefined&&clean(x)!=='';
export function number(x,label='value') {
  if(!['number','string'].includes(typeof x)||!present(x)||!Number.isFinite(Number(x))) throw new Error(`${label}: a finite scalar number is required`);
  return Number(x);
}
function finiteResult(value,label='Calculation'){
  if(!Number.isFinite(value))throw new Error(`${label}: non-finite result or numeric overflow; check values and units`);
  return value;
}
export function similarity(a,b) {
  a=normalized(a);b=normalized(b);if(!a||!b)return 0;
  const row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){let diagonal=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,diagonal+(a[i-1]===b[j-1]?0:1));diagonal=old;}}
  return 1-row[b.length]/Math.max(a.length,b.length);
}
export function suggest(headers,type) {
  return TABLES[type].map(field=>{
    const aliases=[field,...(ALIASES[field]||[])];
    const matches=headers.map((h,i)=>({index:i,score:Math.max(...aliases.map(a=>similarity(h,a)))})).sort((a,b)=>b.score-a.score);
    const best=matches[0]||{index:-1,score:0};
    return {field,index:best.score>=.72?best.index:-1,score:best.score,ambiguous:best.score>0&&matches[1]?.score===best.score};
  });
}
export function parseCSV(text) {
  text=text.replace(/^\uFEFF/,'');
  const first=text.split(/\r?\n/,1)[0],counts={'\t':0,';':0,',':0};let inQuotes=false;
  for(let i=0;i<first.length;i++){if(first[i]==='"'){if(inQuotes&&first[i+1]==='"')i++;else inQuotes=!inQuotes;}else if(!inQuotes&&first[i] in counts)counts[first[i]]++;}
  const delimiter=[',','\t',';'].sort((a,b)=>counts[b]-counts[a])[0];
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(c===delimiter&&!quoted){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(present))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw new Error('Unclosed CSV quotation');row.push(cell);if(row.some(present))rows.push(row);return rows;
}
function unitKey(unit){return clean(unit).toLowerCase().replace(/\s/g,'').replaceAll('hr','h').replaceAll('sec','s').replaceAll('³','3');}
export function convert(value,unit,dimension,calorieJ=null) {
  const v=number(value),u=unitKey(unit);
  const converted=factor=>finiteResult(v*factor,`Converted ${dimension}`);
  // SI prefixes are case-sensitive: milli must never become mega.
  const original=clean(unit).replace(/\s/g,'').replaceAll('hr','h');
  if(dimension==='energy'&&original==='mW')return converted(1e-6);
  if(dimension==='energy'&&original==='mJ/h')return finiteResult(v/3.6e9,'Converted energy');
  if(dimension==='enthalpy'&&original==='mJ/kg')return converted(1e-6);
  if((u==='mw'&&original!=='MW')||(u.startsWith('mj/')&&!original.startsWith('MJ/')))throw new Error(`Ambiguous SI prefix in ${unit}; use MW/MJ or explicit milli units`);
  const factors={mass:{'kg/h':1,'kg/s':3600,'kg/min':60,'g/s':3.6,'g/h':.001,'gm/s':3.6,'t/h':1000,'lb/h':.45359237,'lb/s':1632.932532},
    energy:{kw:1,w:.001,mw:1000,'kj/s':1,'j/s':.001,'kj/h':1/3600,'mj/h':1/3.6,'gj/h':1000/3.6,'kwh/h':1,'btu/h':1055.05585262/3600000},
    enthalpy:{'kj/kg':1,'j/kg':.001,'mj/kg':1000,'btu/lb':1055.05585262/.45359237/1000},volume:{'m3/h':1,'m3/s':3600,'l/h':.001},molar:{'kmol/h':1,'mol/h':.001,'mol/s':3.6}};
  if(/cal/.test(u)){
    if(![4.184,4.1868].includes(Number(calorieJ)))throw new Error('Calorie convention must be explicitly selected (4.184 or 4.1868 J/cal)');
    const c=Number(calorieJ),cs={energy:{'cal/s':c/1000,'kcal/h':c/3600,'kcal/s':c},enthalpy:{'cal/g':c,'cal/gm':c,'kcal/kg':c}};
    if(Object.hasOwn(cs[dimension]||{},u))return converted(cs[dimension][u]);
  }
  if(!Object.hasOwn(factors[dimension]||{},u))throw new Error(`Unsupported ${dimension} unit: ${unit||'(missing)'}`);
  return converted(factors[dimension][u]);
}
export function rate(value,unit,denominator,calorieJ=null){
  const d=unitKey(denominator),original=clean(denominator).replace(/\s/g,'');
  if((d==='mj'&&original!=='MJ')||(d==='gj'&&original!=='GJ'))throw new Error(`Ambiguous SI prefix in factor denominator ${denominator}; use MJ or GJ`);
  if(d==='kg')return convert(value,unit,'mass',calorieJ);
  if(d==='kwh')return convert(value,unit,'energy',calorieJ);
  if(d==='mj')return finiteResult(convert(value,unit,'energy',calorieJ)*3.6,'Inventory rate');
  if(d==='gj')return finiteResult(convert(value,unit,'energy',calorieJ)*.0036,'Inventory rate');
  if(d==='m3')return convert(value,unit,'volume',calorieJ);
  if(d==='kmol')return convert(value,unit,'molar',calorieJ);
  throw new Error(`Unsupported factor denominator: ${denominator}`);
}
export function triangle(mode,low,high,label='parameter'){
  const m=number(mode,label),l=present(low)?number(low,label+' lower'):m,h=present(high)?number(high,label+' upper'):m;
  if(l<0||l>m||m>h)throw new Error(`${label}: require 0 ≤ lower ≤ mode ≤ upper`);return [l,m,h];
}
export function cut(t,alpha){alpha=number(alpha,'Alpha');if(alpha<0||alpha>1)throw new Error('Alpha must be in [0,1]');return [finiteResult(t[0]+alpha*(t[1]-t[0]),'Alpha-cut lower bound'),finiteResult(t[2]-alpha*(t[2]-t[1]),'Alpha-cut upper bound')];}
const add=(a,b)=>[finiteResult(a[0]+b[0]),finiteResult(a[1]+b[1])];
const multiply=(a,b)=>[finiteResult(a[0]*b[0]),finiteResult(a[1]*b[1])]; // only nonnegative physical inputs admitted
const divide=(a,b)=>{if(b[0]<=0)throw new Error('Reference product lower bound must be positive');return [finiteResult(a[0]/b[1]),finiteResult(a[1]/b[0])];};
const scale=(a,s)=>a.map(v=>finiteResult(v*s));
const sum=xs=>xs.reduce((a,b)=>finiteResult(a+b,'Sum'),0);
function unique(rows,key,label){const ids=new Set();for(const r of rows){if(!r||typeof r!=='object'||Array.isArray(r))throw new Error(`${label}: rows must be objects`);if(typeof r.id!=='string'||r.id!==r.id.trim())throw new Error(`${label}: IDs must be text without surrounding spaces`);const id=key(r);if(!id||ids.has(id))throw new Error(`${label}: missing or duplicate ID ${id}`);ids.add(id);}}
export function validateProject(project){
  if(project.schema_version!==1)throw new Error('Expected schema_version 1');
  if(project.meta?.steady_state!==true)throw new Error('This release supports steady-state rate balances; batch/transient accumulation is not supported');
  if(!/^1\s+kg(?:\s|$)/i.test(clean(project.meta.functional_unit)))throw new Error('This release normalizes to 1 kg declared product; functional_unit must begin with "1 kg"');
  for(const k of Object.keys(TABLES))if(!Array.isArray(project[k]))throw new Error(`${k} must be an array`);
  unique(project.cases,r=>clean(r.id),'Cases');unique(project.factors,r=>clean(r.id)&&clean(r.category)?JSON.stringify([r.id,r.category]):'','Factors');
  for(const k of ['streams','blocks','inventory'])unique(project[k],r=>clean(r.case_id)&&clean(r.id)?JSON.stringify([r.case_id,r.id]):'',k);
  if(project.blocks.some(r=>r.id==='BOUNDARY'))throw new Error('Block ID BOUNDARY is reserved for external connections; rename the equipment block');
  const ids=new Set(project.cases.map(c=>clean(c.id)));
  for(const k of ['streams','blocks','inventory'])for(const r of project[k]){
    if(typeof r.case_id!=='string'||r.case_id!==r.case_id.trim())throw new Error(`${k} ${r.id}: case_id must be text without surrounding spaces`);
    if(!ids.has(r.case_id))throw new Error(`${k} ${r.id}: unknown case ${r.case_id}; import Cases first`);
  }
  return project;
}
export function balance(project,c){
  const errors=[],cal=project.meta.calorie_J,blocks=project.blocks.filter(r=>r.case_id===c.id),raw=project.streams.filter(r=>r.case_id===c.id);
  const ids=new Set(blocks.map(b=>b.id));const streams=[];const units=[];
  if(!clean(project.meta.enthalpy_basis))errors.push('Declare a common enthalpy reference, complete substream basis and Q/W sign convention');
  if(!blocks.length||!raw.length)errors.push('Both Blocks and Streams tables are needed');
  for(const r of raw){try{
    if(![r.from,r.to].every(x=>x==='BOUNDARY'||ids.has(x))||r.from===r.to)throw new Error('from/to must name different known blocks or BOUNDARY');
    const mass=convert(r.mass_flow,r.mass_unit,'mass',cal);if(mass<0)throw new Error('Negative mass flow; reverse the stream endpoints explicitly');
    const direct=present(r.enthalpy_flow)?convert(r.enthalpy_flow,r.energy_unit,'energy',cal):null;
    const specific=present(r.specific_enthalpy)?finiteResult(mass*convert(r.specific_enthalpy,r.enthalpy_unit,'enthalpy',cal)/3600,'Stream enthalpy rate'):null;
    if(direct===null&&specific===null)throw new Error('Total enthalpy flow or mass-specific enthalpy required; missing is not zero');
    if(direct!==null&&specific!==null&&Math.abs(direct-specific)>Math.max(1e-6,Math.abs(direct)*1e-4))throw new Error('Total and mass-specific enthalpy disagree');
    streams.push({...r,mass,enthalpy:direct??specific});
  }catch(e){errors.push(`Stream ${r.id}: ${e.message}`);}}
  for(const b of blocks){try{
    const heat=convert(b.heat,b.heat_unit||b.energy_unit,'energy',cal),power=convert(b.power,b.power_unit||b.energy_unit,'energy',cal);
    const ins=streams.filter(s=>s.to===b.id),outs=streams.filter(s=>s.from===b.id);
    if(!ins.length||!outs.length)throw new Error('Complete inlet and outlet connections are required');
    const mi=sum(ins.map(s=>s.mass)),mo=sum(outs.map(s=>s.mass)),hi=sum(ins.map(s=>s.enthalpy)),ho=sum(outs.map(s=>s.enthalpy));
    const massScale=Math.max(mi,mo,1e-12),energyScale=Math.max(Math.abs(hi),Math.abs(ho),finiteResult(Math.abs(heat)+Math.abs(power),'Block duty scale'),1e-12);
    const massResidual=finiteResult(mo-mi,'Block mass residual'),energyResidual=finiteResult(ho-hi-heat-power,'Block energy residual');
    units.push({id:b.id,heat,power,mass_residual_kg_h:massResidual,energy_residual_kW:energyResidual,mass_relative:Math.abs(massResidual)/massScale,energy_relative:Math.abs(energyResidual)/energyScale,within_tolerance:Math.abs(massResidual)<=Math.max(.01,.001*massScale)&&Math.abs(energyResidual)<=Math.max(.01,.001*energyScale)});
  }catch(e){errors.push(`Block ${b.id}: ${e.message}`);}}
  const inbound=streams.filter(s=>s.from==='BOUNDARY'),outbound=streams.filter(s=>s.to==='BOUNDARY');
  if(!inbound.length||!outbound.length)errors.push('Explicit external feed and product/waste boundary streams are needed');
  let total=null;
  if(!errors.length)try{total={mass_residual_kg_h:finiteResult(sum(outbound.map(s=>s.mass))-sum(inbound.map(s=>s.mass)),'Boundary mass residual'),energy_residual_kW:finiteResult(sum(outbound.map(s=>s.enthalpy))-sum(inbound.map(s=>s.enthalpy))-sum(units.map(b=>finiteResult(b.heat+b.power))),'Boundary energy residual'),external_heat_in_kW:sum(units.map(b=>Math.max(0,b.heat))),external_heat_out_kW:sum(units.map(b=>Math.max(0,-b.heat))),work_in_kW:sum(units.map(b=>Math.max(0,b.power))),work_out_kW:sum(units.map(b=>Math.max(0,-b.power)))};}catch(e){errors.push(`Boundary: ${e.message}`);}
  return {complete:errors.length===0,within_tolerance:errors.length===0&&units.every(b=>b.within_tolerance),tolerance:'Per block: max(0.01 kg/h, 0.1% mass throughput); max(0.01 kW, 0.1% absolute enthalpy/duty scale). Numerical consistency only.',errors,streams,blocks:units,total};
}
export function assess(project){
  validateProject(project);
  const categories=[...new Set(project.factors.map(f=>f.category))],alphas=[0,.25,.5,.75,1],cal=project.meta.calorie_J;
  const results=project.cases.map(c=>{
    const result={id:c.id,balance:balance(project,c),impacts:[],issues:[],energy:null,yield:null};let product,allocation,feed;
    try{
      product=triangle(c.product_rate,c.product_low,c.product_high,'Product').map(v=>convert(v,c.mass_unit,'mass',cal));
      if(product[0]<=0)throw new Error('Product lower bound must be positive');
      allocation=number(c.allocation,'Allocation share');if(allocation<0||allocation>1)throw new Error('Allocation share must be in [0,1]');
      if(present(c.feed_rate)){feed=convert(c.feed_rate,c.mass_unit,'mass',cal);if(feed<=0)throw new Error('Feed rate must be positive');result.yield=product.map(v=>finiteResult(v/feed,'Target/feed yield'));}
    }catch(e){result.issues.push(e.message);return result;}
    const inventory=project.inventory.filter(r=>r.case_id===c.id);
    const contextIssues=[];
    for(const field of ['boundary','functional_unit','allocation_method'])if(!clean(project.meta[field]))contextIssues.push(`Declare ${field}`);
    if(project.meta.inventory_complete!==true)contextIssues.push('Inventory scope/completeness has not been confirmed');
    if(!inventory.length)contextIssues.push('No inventory rows');
    const energy=inventory.filter(r=>r.kind==='energy');
    try{if(!energy.length)throw new Error('No explicit purchased-energy inventory rows');
      const demands=energy.map(r=>triangle(r.amount,r.amount_low,r.amount_high,`Inventory ${r.id}`).map(v=>convert(v,r.unit,'energy',cal)));
      result.energy=alphas.map(alpha=>({alpha,range:scale(divide(demands.map(t=>cut(t,alpha)).reduce(add,[0,0]),cut(product,alpha)),allocation)}));
    }catch(e){result.issues.push(e.message);}
    for(const category of categories){
      const factors=project.factors.filter(f=>f.category===category),errors=[...contextIssues],contributions=[];
      const methods=new Set(factors.map(f=>clean(f.method))),units=new Set(factors.map(f=>clean(f.impact_unit)));
      const consistentContext=methods.size===1&&!methods.has('')&&units.size===1&&!units.has('');
      if(!consistentContext)errors.push('Category factors must use one declared method and impact unit');
      const terms=[];
      for(const row of inventory){try{
        const f=factors.find(f=>f.id===row.factor_id);if(!f)throw new Error(`Missing ${category} factor ${row.factor_id||'(unmapped)'}`);
        if(!clean(f.source)||!clean(row.source))throw new Error('Inventory and factor provenance are required');
        if(!['energy','material','emission','waste'].includes(row.kind))throw new Error('Inventory kind must be energy, material, emission or waste');
        const amount=triangle(row.amount,row.amount_low,row.amount_high,`Inventory ${row.id}`).map(v=>rate(v,row.unit,f.denominator_unit,cal));
        const factor=triangle(f.value,f.low,f.high,`Factor ${f.id}`),nominal=finiteResult(amount[1]*factor[1]*allocation/product[1],'Nominal impact contribution');
        terms.push({amount,factor});contributions.push({id:row.id,name:row.name||row.id,nominal,factor_id:f.id,source:f.source,...(consistentContext?{}:{unit:clean(f.impact_unit),method:clean(f.method)})});
      }catch(e){errors.push(`${row.id}: ${e.message}`);}}
      let cuts=[],subtotal=null;
      if(consistentContext){
        try{cuts=alphas.map(alpha=>({alpha,range:scale(divide(terms.map(t=>multiply(cut(t.amount,alpha),cut(t.factor,alpha))).reduce(add,[0,0]),cut(product,alpha)),allocation)}));}catch(e){errors.push(`Impact support: ${e.message}`);}
        try{subtotal=sum(contributions.map(x=>x.nominal));}catch(e){errors.push(`Impact subtotal: ${e.message}`);}
      }
      result.impacts.push({category,unit:[...units][0],method:[...methods][0],complete:!errors.length,errors,covered:terms.length,total:inventory.length,cuts,contributions,nominal_subtotal:subtotal});
    }
    if(!categories.length)result.issues.push('No impact factors imported; LCA totals are unavailable');
    return result;
  });
  return {schema_version:1,assumptions:{basis:'Steady state; 1 kg declared target product; Q and W positive into each block; no accumulation/KE/PE terms',uncertainty:'Nonnegative triangular fuzzy inputs, Cartesian alpha-cut outer bounds. Possibility levels, not probabilities or confidence intervals. Shared dependencies can widen the bounds.',boundary:project.meta.boundary},categories,results};
}
export function rank(report,category,weights=[1,1,1],comparable=false){
  if(!comparable)throw new Error('Confirm that compared cases provide the same function and use comparable system boundaries and allocation');
  if(!Array.isArray(weights)||weights.length!==3)throw new Error('Exactly three weights are required: energy, impact and yield');
  weights=weights.map(w=>number(w,'Weight'));if(weights.some(w=>w<0)||Math.max(...weights)<=0)throw new Error('Use nonnegative weights with a positive sum');
  const maximum=Math.max(...weights),scaledWeights=weights.map(w=>w/maximum),weightSum=sum(scaledWeights);weights=scaledWeights.map(w=>w/weightSum);
  const rows=report.results.filter(r=>r.balance.within_tolerance&&!r.issues.length&&r.energy&&r.yield&&r.impacts.some(i=>i.category===category&&i.complete));
  if(rows.length<2)throw new Error('At least two complete, comparable cases are needed for ranking');
  const values=rows.map(r=>[r.energy.at(-1).range[0],r.impacts.find(i=>i.category===category).cuts.at(-1).range[0],r.yield[1]]);
  const anchors=[0,1,2].map(k=>[Math.min(...values.map(v=>v[k])),Math.max(...values.map(v=>v[k]))]);
  // Equivalent source units can differ by a few floating-point steps. Such a
  // span has no resolved scoring range; this is not a performance threshold.
  const utility=(v,k)=>{const [lo,hi]=anchors[k];if(hi===lo||(hi-lo)/Math.max(Math.abs(lo),Math.abs(hi))<=16*Number.EPSILON)return .5;const x=Math.min(1,Math.max(0,(v-lo)/(hi-lo)));return k===2?x:1-x;};
  const graded=x=>[Math.max(0,1-2*x),1-Math.abs(2*x-1),Math.max(0,2*x-1)];
  const ranked=rows.map((r,i)=>{
    const memberships=values[i].map((v,k)=>graded(utility(v,k)));
    const combined=[0,1,2].map(j=>sum(memberships.map((m,k)=>m[j]*weights[k])));
    const score=combined[1]*.5+combined[2];
    const ranges=[r.energy[0].range,r.impacts.find(x=>x.category===category).cuts[0].range,[r.yield[0],r.yield[2]]].map((v,k)=>v.map(x=>utility(x,k)).sort((a,b)=>a-b));
    return {id:r.id,score,membership:combined,score_support:[0,1].map(j=>sum(ranges.map((v,k)=>v[j]*weights[k])))};
  }).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  for(const r of ranked){r.possible_rank=[1+ranked.filter(o=>o!==r&&o.score_support[0]>r.score_support[1]).length,1+ranked.filter(o=>o!==r&&o.score_support[1]>=r.score_support[0]).length];}
  return {weights,anchors,category,excluded:report.results.filter(r=>!rows.includes(r)).map(r=>r.id),rows:ranked};
}
// Existing exporter JSON can be staged, but missing topology/enthalpy must be supplied.
export function adaptAspen(raw){
  if(raw.schema_version===1)return raw;
  if(!raw.streams||!raw.blocks||Array.isArray(raw.streams))throw new Error('JSON must be a version-1 project or this repository’s Aspen export');
  const p=blankProject();p.meta.name='Aspen export (mapping required)';const source='Imported Aspen JSON';
  p.cases=[{id:'case-1',product_rate:'',mass_unit:'kg/h',allocation:1,source}];
  for(const [id,s] of Object.entries(raw.streams)){
    const native=s.MASSFLMX,useNative=native?.value!==null&&native?.value!==undefined;
    p.streams.push({case_id:'case-1',id,from:'',to:'',mass_flow:useNative?native.value:s.mass_flow_kg_h??'',mass_unit:useNative?native.unit??'':s.mass_flow_kg_h!==null&&s.mass_flow_kg_h!==undefined?'kg/h':'',specific_enthalpy:s.HMX_MASS?.value??'',enthalpy_unit:s.HMX_MASS?.unit??'',source});
  }
  for(const [id,b] of Object.entries(raw.blocks)){
    const normalizedHeat=b.heat_kW!==null&&b.heat_kW!==undefined,normalizedPower=b.power_kW!==null&&b.power_kW!==undefined;
    p.blocks.push({case_id:'case-1',id,heat:normalizedHeat?b.heat_kW:b['\\QCALC']?.value??'',power:normalizedPower?b.power_kW:b['\\WNET']?.value??'',energy_unit:'',heat_unit:normalizedHeat?'kW':b['\\QCALC']?.unit??'',power_unit:normalizedPower?'kW':b['\\WNET']?.unit??'',source});
  }
  // Native raw records carry mixed units; do not force heat and power into one unit.
  if(raw.T_K)p.meta.name='Native Aspen raw export; normalize block Q/W units before calculation';
  return p;
}
