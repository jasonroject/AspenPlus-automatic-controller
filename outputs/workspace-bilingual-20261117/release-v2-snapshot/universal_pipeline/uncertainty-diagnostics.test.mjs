import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assess,rank} from '../analysis_web/universal-core.mjs';
import {inputUncertainty,scanPreferences} from '../analysis_web/uncertainty-diagnostics.mjs';

const fixture=name=>JSON.parse(fs.readFileSync(new URL(`../analysis_web/data/${name}.json`,import.meta.url),'utf8'));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const freeze=p=>{for(const c of p.cases)c.product_low=c.product_high=c.product_rate;for(const r of p.inventory)r.amount_low=r.amount_high=r.amount;for(const f of p.factors)f.low=f.high=f.value;return p;};

test('native uncertainty attribution identifies only the declared electricity factor support',()=>{
  const p=fixture('universal-htl'),r=assess(p),before=JSON.stringify({p,r}),d=inputUncertainty(p,r,p.cases[0].id,r.categories[0]);
  assert.equal(d.available,true);assert.equal(d.varying.length,1);assert.equal(d.varying[0].kind,'factor');assert.equal(d.varying[0].id,'electricity');
  near(d.nominal,11.069477744607346);near((d.varying[0].impactSupport[1]-d.varying[0].impactSupport[0])/2,.15060935658993746);
  near(d.varying[0].impactSupport[0],d.combinedSupport[0]);near(d.varying[0].impactSupport[1],d.combinedSupport[1]);
  assert.equal(JSON.stringify({p,r}),before);assert.deepEqual(d.fixedCounts,{inventory:5,factors:4,product:1});
});

test('one-at-a-time supports reproduce full accounting with every other input frozen',()=>{
  const p=fixture('universal-example');p.inventory.push({...p.inventory[0],id:'additional-electricity',amount:3,amount_low:2,amount_high:4});
  const r=assess(p),category=r.categories[0],d=inputUncertainty(p,r,'A',category);
  assert.equal(d.varying.find(v=>v.kind==='factor').affectedInventory.length,2);
  for(const parameter of d.varying){
    const results=[parameter.lower,parameter.upper].map(value=>{
      const q=freeze(structuredClone(p));
      if(parameter.kind==='product')Object.assign(q.cases.find(c=>c.id==='A'),{product_rate:value,product_low:value,product_high:value});
      if(parameter.kind==='inventory')Object.assign(q.inventory.find(c=>c.case_id==='A'&&c.id===parameter.id),{amount:value,amount_low:value,amount_high:value});
      if(parameter.kind==='factor')Object.assign(q.factors.find(c=>c.category===category&&c.id===parameter.id),{value,low:value,high:value});
      return assess(q).results[0].impacts[0].cuts.at(-1).range[0];
    }).sort((a,b)=>a-b);
    near(parameter.impactSupport[0],results[0]);near(parameter.impactSupport[1],results[1]);
  }
});

test('zero nominal factors can have a positive upper OAT support; incomplete categories do not expose totals',()=>{
  const p=fixture('universal-example');Object.assign(p.factors[0],{value:0,low:0,high:.5});
  const r=assess(p),d=inputUncertainty(p,r,'A',r.categories[0]);
  assert.ok(d.varying.find(v=>v.kind==='factor').impactSupport[1]>d.nominal);
  p.meta.inventory_complete=false;const incomplete=inputUncertainty(p,assess(p),'A',r.categories[0]);
  assert.equal(incomplete.available,false);assert.equal(incomplete.nominal,null);assert.equal(incomplete.combinedSupport,null);assert.ok(incomplete.varying.every(v=>v.impactSupport===null));
});

test('OAT supports preserve scale-equivalent tiny positive impact values',()=>{
  const p=fixture('universal-example'),r=assess(p),category=r.categories[0],original=inputUncertainty(p,r,'A',category),scale=1e-16;
  for(const factor of p.factors.filter(row=>row.category===category)){
    for(const key of ['value','low','high'])if(typeof factor[key]==='number')factor[key]*=scale;
    factor.impact_unit='scaled illustrative impact';
  }
  const scaled=inputUncertainty(p,assess(p),'A',category);
  assert.equal(scaled.errors.length,0);assert.ok(scaled.nominal>0&&scaled.nominal<1e-14);
  for(const [index,row] of scaled.varying.entries()){
    assert.ok(row.impactSupport.every(value=>value>0),'A positive quantity cannot disappear when its reporting unit changes');
    for(let side=0;side<2;side++)assert.ok(Math.abs(row.impactSupport[side]/scale-original.varying[index].impactSupport[side])<1e-12);
  }
});

function exactOATProject(amounts,factors){
  const p=freeze(fixture('universal-example'));p.cases=p.cases.filter(row=>row.id==='A');
  for(const table of ['streams','blocks'])p[table]=p[table].filter(row=>row.case_id==='A');
  Object.assign(p.cases[0],{product_rate:1,product_low:1,product_high:1});
  p.factors=factors.map(row=>({category:'Hand arithmetic',denominator_unit:'kg',impact_unit:'illustrative impact',method:'Independent fixture',source:'Hand arithmetic',...row}));
  p.inventory=amounts.map((row,i)=>({case_id:'A',id:String(i),kind:'material',unit:'kg/h',source:'Hand arithmetic',...row}));
  return p;
}

test('a shared factor with a zero lower bound gives an exact zero OAT support',()=>{
  const p=exactOATProject([{amount:3,factor_id:'shared'},{amount:1,factor_id:'shared'}],[{id:'shared',value:.1,low:0,high:.2}]);
  Object.assign(p.cases[0],{product_rate:3,product_low:3,product_high:3});
  const d=inputUncertainty(p,assess(p),'A','Hand arithmetic'),factor=d.varying.find(row=>row.kind==='factor');
  assert.deepEqual(d.errors,[]);assert.deepEqual(factor.affectedInventory,['0','1']);
  assert.equal(factor.impactSupport[0],0);near(factor.impactSupport[1],4*.2/3);
});

test('omitting a dominant term preserves smaller contributions and avoids summing overflowing raw quantities',()=>{
  const p=exactOATProject([{amount:1e20,amount_low:0,amount_high:1e20,factor_id:'large'},{amount:3,factor_id:'small'},{amount:4,factor_id:'small'}],[{id:'large',value:1,low:0,high:1},{id:'small',value:1}]);
  const d=inputUncertainty(p,assess(p),'A','Hand arithmetic');
  assert.deepEqual(d.errors,[]);
  for(const row of d.varying)assert.equal(row.impactSupport[0],7,'The other contributions are 3 + 4, even when the nominal total rounds to 1e20');
  const q=exactOATProject([{amount:9e307,factor_id:'shared'},{amount:9e307,factor_id:'shared'}],[{id:'shared',value:1e-308,low:0,high:2e-308}]);
  const huge=inputUncertainty(q,assess(q),'A','Hand arithmetic');
  assert.deepEqual(huge.errors,[]);assert.equal(huge.varying[0].impactSupport[0],0);near(huge.varying[0].impactSupport[1],3.6);
});

test('preference scan covers 66 exact simplex settings and matches direct core leaders',()=>{
  const p=fixture('universal-example'),r=assess(p),scan=scanPreferences(r,r.categories[0],true);
  assert.equal(scan.sampleCount,66);assert.equal(new Set(scan.samples.map(s=>s.weights.join(','))).size,66);
  for(const sample of scan.samples){near(sample.weights.reduce((a,b)=>a+b,0),1);const direct=rank(r,r.categories[0],sample.weights,true);const leaders=direct.rows.filter(row=>Math.abs(row.score-direct.rows[0].score)<=scan.tieTolerance).map(row=>row.id).sort();assert.deepEqual([...sample.leaders].sort(),leaders);}
  near(scan.rows.reduce((sum,row)=>sum+row.preferenceShare,0),1);assert.equal(scan.rows[0].id,'B');near(scan.rows[0].preferenceShare,1);
});

test('trade-off preference counts are independently checkable and ties are shared rather than discarded',()=>{
  const p=fixture('universal-example');p.inventory.find(i=>i.case_id==='B'&&i.kind==='energy').amount=16;
  Object.assign(p.inventory.find(i=>i.case_id==='B'&&i.kind==='energy'),{amount_low:16,amount_high:16});
  const r=assess(p),scan=scanPreferences(r,r.categories[0],true),a=scan.rows.find(r=>r.id==='A'),b=scan.rows.find(r=>r.id==='B');
  assert.equal(a.leaderInclusions,51);assert.equal(b.leaderInclusions,21);near(a.sharedLeaderCount,48);near(b.sharedLeaderCount,18);
  assert.deepEqual(a.rankRange,[1,2]);assert.deepEqual(b.rankRange,[1,2]);
});

test('preference scans require comparable eligible cases and cap cost without dropping cases silently',()=>{
  const p=fixture('universal-example'),r=assess(p);
  assert.throws(()=>scanPreferences(r,r.categories[0],false),/comparable/);
  assert.throws(()=>scanPreferences(r,r.categories[0],true,0),/divisions/);
  p.meta.inventory_complete=false;assert.throws(()=>scanPreferences(assess(p),r.categories[0],true),/two/);
  const many={...r,results:Array.from({length:201},(_,i)=>({...r.results[0],id:String(i)}))};
  assert.throws(()=>scanPreferences(many,r.categories[0],true),/200/);
});

test('identical cases retain tied leads across every preference setting',()=>{
  const p=fixture('universal-example'),original=assess(p),r={...original,results:[original.results[0],{...original.results[0],id:'Identical'}]};
  const scan=scanPreferences(r,r.categories[0],true);
  for(const row of scan.rows){assert.equal(row.leaderInclusions,66);near(row.sharedLeaderCount,33);near(row.preferenceShare,.5);assert.deepEqual(row.rankRange,[1,2]);}
});
