import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {assess,rank,convert,triangle,cut,parseCSV,suggest,adaptAspen} from '../analysis_web/universal-core.mjs';
const fixture=()=>JSON.parse(fs.readFileSync(new URL('../analysis_web/data/universal-example.json',import.meta.url),'utf8'));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('independent arithmetic: energy closure, climate totals and alpha bounds',()=>{
  const r=assess(fixture()).results[0];assert.equal(r.balance.complete,true);assert.equal(r.balance.within_tolerance,true);
  near(r.balance.total.mass_residual_kg_h,0);near(r.balance.total.energy_residual_kW,0);
  const c=r.impacts[0];assert.equal(c.complete,true);near(c.cuts.at(-1).range[0],3);
  near(c.cuts[0].range[0],(9*.4+1)/2.2);near(c.cuts[0].range[1],(11*.6+1)/1.8);
  near(r.energy.at(-1).range[0],5);near(r.yield[1],.2);
});
test('heterogeneous units and explicit calorie convention',()=>{
  near(convert(1,'kg/s','mass'),3600);near(convert(3.6,'MJ/h','energy'),1);
  near(convert(1,'MW','energy'),1000);near(convert(1,'mW','energy'),1e-6);
  near(convert(1,'cal/sec','energy',4.1868),.0041868);
  assert.throws(()=>convert(1,'cal/sec','energy'));assert.throws(()=>convert(1,'kg/h','energy'));assert.throws(()=>convert(1,'mw','energy'));assert.throws(()=>convert('','kW','energy'));assert.throws(()=>convert(1,'constructor','energy'));
  const p=fixture();p.streams[1].enthalpy_flow=36;p.streams[1].energy_unit='MJ/h';
  p.blocks[0].heat=10000;p.blocks[0].heat_unit='W';p.blocks[0].power_unit='kW';assert.equal(assess(p).results[0].balance.within_tolerance,true);
});
test('negative enthalpy reference is valid; conflicting enthalpy is rejected',()=>{
  const p=fixture();p.streams[0].enthalpy_flow=-50;p.streams[1].enthalpy_flow=-40;assert.equal(assess(p).results[0].balance.within_tolerance,true);
  p.streams[0].specific_enthalpy=0;p.streams[0].enthalpy_unit='kJ/kg';assert.equal(assess(p).results[0].balance.complete,false);
});
test('missing duty, missing topology and nonclosure are distinct and not filled with zero',()=>{
  let p=fixture();p.blocks[0].power='';assert.equal(assess(p).results[0].balance.complete,false);
  p=fixture();p.streams[0].from='';assert.equal(assess(p).results[0].balance.complete,false);
  p=fixture();p.streams[1].enthalpy_flow=20;const report=assess(p);assert.equal(report.results[0].balance.complete,true);assert.equal(report.results[0].balance.within_tolerance,false);assert.throws(()=>rank(report,report.categories[0],[1,1,1],true));
});
test('internal recycle cancels across system boundary; no duplicate utility inventory',()=>{
  const p=fixture();p.blocks.push({case_id:'A',id:'B2',heat:0,power:0,energy_unit:'kW'});
  p.streams.push({case_id:'A',id:'REC1',from:'HEATER',to:'B2',mass_flow:3,mass_unit:'kg/h',enthalpy_flow:-5,energy_unit:'kW'},
    {case_id:'A',id:'REC2',from:'B2',to:'HEATER',mass_flow:3,mass_unit:'kg/h',enthalpy_flow:-5,energy_unit:'kW'});
  const r=assess(p).results[0];assert.equal(r.balance.within_tolerance,true);near(r.balance.total.energy_residual_kW,0);near(r.impacts[0].nominal_subtotal,3);
});
test('missing factor or incompatible factor unit prevents complete LCIA and ranking',()=>{
  let p=fixture();p.factors=p.factors.filter(f=>!(f.id==='feed'&&f.category==='Illustrative climate'));let r=assess(p);assert.equal(r.results[0].impacts[0].complete,false);assert.throws(()=>rank(r,'Illustrative climate',[1,1,1],true));
  p=fixture();p.factors[0].denominator_unit='kg';assert.equal(assess(p).results[0].impacts[0].complete,false);
  p=fixture();p.meta.inventory_complete=false;assert.equal(assess(p).results[0].impacts[0].complete,false);
  p=fixture();p.factors[1].method='Other method';assert.equal(assess(p).results[0].impacts[0].complete,false);
});
test('declared allocation scales burdens; no negative credits silently accepted',()=>{
  const p=fixture();p.cases[0].allocation=.5;near(assess(p).results[0].impacts[0].nominal_subtotal,1.5);
  p.inventory[0].amount=-1;assert.equal(assess(p).results[0].impacts[0].complete,false);
});
test('triangular supports and normalized fuzzy memberships',()=>{
  assert.deepEqual(cut(triangle(2,1,4),.5),[1.5,3]);assert.throws(()=>triangle(2,3,4));
  const r=assess(fixture()),result=rank(r,r.categories[0],[1,1,1],true);assert.equal(result.rows[0].id,'B');
  for(const row of result.rows){near(row.membership.reduce((a,b)=>a+b,0),1);assert.ok(row.score>=row.score_support[0]&&row.score<=row.score_support[1]);}
  assert.throws(()=>rank(r,r.categories[0],[0,0,0],true));assert.throws(()=>rank(r,r.categories[0],[1,1,1],false));
  for(const item of r.results[0].impacts)for(let i=1;i<item.cuts.length;i++){assert.ok(item.cuts[i].range[0]>=item.cuts[i-1].range[0]);assert.ok(item.cuts[i].range[1]<=item.cuts[i-1].range[1]);}
});
test('CSV quotes, Unicode headers and fuzzy mapping stay separate from numeric assumptions',()=>{
  const rows=parseCSV('\uFEFF物流,质量流量_kg_h,来源\r\nS1,10,"a,b\nsecond line"\r\n');assert.equal(rows[1][2],'a,b\nsecond line');
  const s=suggest(rows[0],'streams');assert.equal(s.find(x=>x.field==='id').index,0);assert.equal(s.find(x=>x.field==='mass_flow').index,1);
  assert.equal(suggest(['mass flo'],'streams').find(x=>x.field==='mass_flow').index,0);assert.throws(()=>parseCSV('id,a\n"broken'));
});
test('duplicate data, unsupported functional basis and dynamic cases reject',()=>{
  let p=fixture();p.streams.push({...p.streams[0]});assert.throws(()=>assess(p));p=fixture();p.meta.steady_state=false;assert.throws(()=>assess(p));p=fixture();p.meta.functional_unit='1 MJ fuel';assert.throws(()=>assess(p));
});
test('legacy exporter adapter preserves missing enthalpy, topology and missing power',()=>{
  const p=adaptAspen({streams:{S1:{mass_flow_kg_h:1}},blocks:{H1:{heat_kW:10,power_kW:null}}});
  assert.equal(p.streams[0].from,'');assert.equal(p.streams[0].specific_enthalpy,'');assert.equal(p.blocks[0].power,'');
});
test('real native HTL fixture reproduces independent audited carbon calculation',()=>{
  const p=JSON.parse(fs.readFileSync(new URL('../analysis_web/data/universal-htl.json',import.meta.url),'utf8')),r=assess(p).results[0];
  assert.equal(r.balance.within_tolerance,true);assert.equal(r.impacts[0].complete,true);
  const prior=JSON.parse(fs.readFileSync(new URL('../analysis_web/data/study/surrogate/details.json',import.meta.url),'utf8'));
  // Independent fresh native comparison exists locally; public check always reconstructs foreground.
  const iv=p.inventory,amount=id=>iv.find(x=>x.id===id).amount,product=p.cases[0].product_rate,c=prior.accounting;
  near(r.impacts[0].nominal_subtotal,(c.fixed_feed_GWP+c.electricity_beta*amount('electricity')+amount('CO2')+36*amount('CH4')+c.wastewater_gamma*amount('wastewater')/1000)/product);
  const fresh=new URL('../outputs/htl_pipeline/fresh_comparison.json',import.meta.url);
  if(fs.existsSync(fileURLToPath(fresh))){const original=JSON.parse(fs.readFileSync(fresh,'utf8')).find(x=>x.temperature_C===325);near(r.impacts[0].nominal_subtotal,original.actual.CF_HR);}
});
