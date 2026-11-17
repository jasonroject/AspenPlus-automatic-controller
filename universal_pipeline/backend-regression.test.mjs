import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assess,rank,convert,rate,number,cut,adaptAspen} from '../analysis_web/universal-core.mjs';

const fixture=()=>JSON.parse(fs.readFileSync(new URL('../analysis_web/data/universal-example.json',import.meta.url),'utf8'));
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
const allFinite=value=>typeof value==='number'?Number.isFinite(value):Array.isArray(value)?value.every(allFinite):value&&typeof value==='object'?Object.values(value).every(allFinite):true;

test('factor energy denominators do not conflate milli and mega joules',()=>{
  near(rate(1,'kWh/h','MJ'),3.6);near(rate(1,'kWh/h','GJ'),.0036);
  assert.throws(()=>rate(1,'kWh/h','mJ'),/prefix|Unsupported/);
  assert.throws(()=>rate(1,'kWh/h','mj'),/prefix|Unsupported/);
  const p=fixture();p.factors[0].denominator_unit='mJ';
  const result=assess(p).results[0];assert.equal(result.impacts[0].complete,false);
  assert.match(result.impacts[0].errors.join(' '),/prefix|Unsupported/);
});

test('ranking requires exactly three scalar weights and handles very large finite preferences',()=>{
  const r=assess(fixture()),category=r.categories[0];
  for(const weights of [[],[1],[1,1],[1,1,1,1],[[1],1,1],[1,Infinity,1]])assert.throws(()=>rank(r,category,weights,true));
  const large=rank(r,category,[1e308,1e308,1e308],true),normal=rank(r,category,[1,1,1],true);
  near(large.weights.reduce((a,b)=>a+b,0),1);assert.deepEqual(large.rows,normal.rows);
});

test('slash-containing case and row identifiers remain distinct tuple keys',()=>{
  const p=fixture();
  for(const [before,after] of [['A','A/B'],['B','A']]){
    p.cases.find(c=>c.id===before).id=after;
    for(const table of ['streams','blocks','inventory'])for(const row of p[table])if(row.case_id===before)row.case_id=after;
  }
  p.inventory.find(row=>row.case_id==='A/B').id='C';p.inventory.find(row=>row.case_id==='A').id='B/C';
  assert.equal(assess(p).results.length,2);
  p.inventory.push({...p.inventory[0]});assert.throws(()=>assess(p),/duplicate/);
});

test('slash-containing factor IDs and impact categories do not collide',()=>{
  const p=fixture();p.factors=[
    {...p.factors[0],id:'factor/category',category:'climate'},
    {...p.factors[0],id:'factor',category:'category/climate'},
  ];
  const result=assess(p);assert.deepEqual(result.categories,['climate','category/climate']);
  assert.equal(result.results[0].impacts.every(i=>!i.complete),true);
});

test('case references cannot pass validation and then silently disappear during grouping',()=>{
  const p=fixture();p.inventory[0].case_id='A ';
  assert.throws(()=>assess(p),/case_id.*text|case_id.*spaces/);
  const q=fixture();q.cases[0].id='1';
  for(const table of ['streams','blocks','inventory'])for(const row of q[table])if(row.case_id==='A')row.case_id='1';
  q.inventory[0].case_id=1;
  assert.throws(()=>assess(q),/case_id.*text|case_id.*spaces/);
});

test('reserved external boundary name cannot masquerade as a balanced equipment block',()=>{
  const p=fixture();p.blocks[0].id='BOUNDARY';p.blocks[0].heat=-10;
  p.blocks.push({case_id:'A',id:'SECOND',heat:10,power:0,energy_unit:'kW'});
  p.streams[0].from='BOUNDARY';p.streams[0].to='SECOND';p.streams[1].from='SECOND';p.streams[1].to='BOUNDARY';
  assert.throws(()=>assess(p),/BOUNDARY.*reserved|reserved.*BOUNDARY/);
});

test('numeric scalars and derived conversion values must remain finite',()=>{
  for(const bad of [[2],{valueOf:()=>2},true])assert.throws(()=>number(bad));
  near(number('2.5'),2.5);near(convert(1,'mW','energy'),1e-6);
  assert.throws(()=>convert(1e308,'MW','energy'),/finite|overflow/);
  assert.throws(()=>rate(1e308,'kWh/h','MJ'),/finite|overflow/);
  assert.throws(()=>cut([1,2,3],NaN),/finite|Alpha/);
});

test('overflow cannot become a complete impact or JSON null disguised as a valid total',()=>{
  const p=fixture();Object.assign(p.inventory[0],{amount:1e308,amount_low:1e308,amount_high:1e308});
  Object.assign(p.factors[0],{value:1e308,low:1e308,high:1e308});
  const report=assess(p),impact=report.results[0].impacts[0];
  assert.equal(impact.complete,false);assert.match(impact.errors.join(' '),/finite|overflow/);
  assert.equal(allFinite(report),true);assert.throws(()=>rank(report,report.categories[0],[1,1,1],true));
});

test('overflowed fuzzy support and boundary aggregates retain diagnostics',()=>{
  const p=fixture();Object.assign(p.factors[0],{high:1e308});
  const report=assess(p);assert.equal(report.results[0].impacts[0].complete,false);assert.equal(allFinite(report),true);
  const q=fixture();q.streams[0].mass_flow=1e308;q.streams[1].mass_flow=1e308;
  q.streams.push({...q.streams[0],id:'EXTRA_IN'},{...q.streams[1],id:'EXTRA_OUT'});
  const balance=assess(q).results[0].balance;assert.equal(balance.complete,false);assert.equal(balance.total,null);assert.equal(allFinite(balance),true);
});

test('a mismatched category method or unit blocks a complete footprint, including zero allocation',()=>{
  for(const field of ['method','impact_unit']){
    const p=fixture();p.factors.find(f=>f.category===p.factors[0].category&&f.id==='feed')[field]='Other';p.cases[0].allocation=0;
    const result=assess(p).results[0];assert.equal(result.impacts[0].complete,false);
    assert.equal(result.impacts[1].complete,true);near(result.impacts[1].nominal_subtotal,0);
  }
});

test('Aspen adapter pairs normalized and native values with their own units',()=>{
  const p=adaptAspen({streams:{S1:{mass_flow_kg_h:5,MASSFLMX:{value:null,unit:'kg/s'}}},blocks:{H1:{heat_kW:10,power_kW:2,'\\QCALC':{value:2388,unit:'cal/sec'},'\\WNET':{value:.002,unit:'MW'}}}});
  assert.equal(p.streams[0].mass_flow,5);assert.equal(p.streams[0].mass_unit,'kg/h');
  assert.equal(p.blocks[0].heat,10);assert.equal(p.blocks[0].heat_unit,'kW');assert.equal(p.blocks[0].power_unit,'kW');
  near(convert(p.blocks[0].heat,p.blocks[0].heat_unit,'energy',4.1868),10);
});

test('Aspen native quantities with missing units remain unresolved rather than assuming SI',()=>{
  const p=adaptAspen({streams:{S1:{MASSFLMX:{value:5}}},blocks:{H1:{'\\QCALC':{value:10},'\\WNET':{value:2}}}});
  assert.equal(p.streams[0].mass_unit,'');assert.equal(p.blocks[0].heat_unit,'');assert.equal(p.blocks[0].power_unit,'');
  assert.equal(p.blocks[0].energy_unit,'');
});
