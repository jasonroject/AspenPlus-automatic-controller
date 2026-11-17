import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assess} from '../analysis_web/universal-core.mjs';
import {resultVisualData,supportAxis} from '../analysis_web/result-visuals.mjs';

const fixture=name=>JSON.parse(fs.readFileSync(new URL(`../analysis_web/data/${name}.json`,import.meta.url),'utf8'));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('visual metrics preserve calculated values, units, possibility levels and category separation',()=>{
  const p=fixture('universal-example'),r=assess(p),v=resultVisualData(p,r,'A',r.categories[0]);
  near(v.cases[0].energy,5);near(v.cases[0].impact,3);near(v.cases[0].yield,20);
  near(v.impact.contributions.reduce((sum,c)=>sum+c.nominal,0),v.impact.total);
  assert.deepEqual(v.impact.cuts.map(c=>c.alpha),[0,.25,.5,.75,1]);
  assert.equal(v.impact.category,r.categories[0]);assert.equal(v.impact.unit,'kg CO2-eq');
  const other=resultVisualData(p,r,'A',r.categories[1]);
  assert.notEqual(other.impact.total,v.impact.total);assert.notEqual(other.impact.unit,v.impact.unit);
});

test('missing factors leave explicit missing contributions and withhold total, supports and comparison value',()=>{
  const p=fixture('universal-example');p.factors=p.factors.filter(f=>!(f.id==='feed'&&f.category==='Illustrative climate'));
  const r=assess(p),v=resultVisualData(p,r,'A','Illustrative climate');
  assert.equal(v.impact.complete,false);assert.equal(v.impact.total,null);assert.deepEqual(v.impact.cuts,[]);
  assert.equal(v.impact.missing.length,1);assert.equal(v.cases[0].impact,null);assert.ok(v.impact.subtotal>0);
  assert.equal(resultVisualData(p,r,'A','Illustrative acidification').impact.complete,true);
});

test('native block charts keep heat signs and normalized kW, including imported missing duties',()=>{
  const p=fixture('universal-htl'),r=assess(p),v=resultVisualData(p,r,p.cases[0].id);
  assert.equal(v.caseId,'HTL-325-8.5');assert.equal(v.balanceWithinTolerance,true);
  assert.ok(v.blocks.find(b=>b.id==='COOLER').heat<0);
  near(v.blocks.find(b=>b.id==='PUMP').power,2.1717208);
  assert.equal(v.comparable,false);
  p.blocks.find(b=>b.id==='PUMP').power='';
  const missing=resultVisualData(p,assess(p),p.cases[0].id);
  assert.ok(missing.missingBlocks.includes('PUMP'));assert.equal(missing.blocks.some(b=>b.id==='PUMP'),false);
});

test('visualization does not mutate report or invent absent feed, factors or cases',()=>{
  const p=fixture('universal-example');delete p.cases[0].feed_rate;p.factors=[];
  const r=assess(p),before=JSON.stringify(r),v=resultVisualData(p,r,'A');
  assert.equal(v.cases[0].yield,null);assert.equal(v.impact,null);assert.equal(v.cases[0].impact,null);
  assert.equal(JSON.stringify(r),before);assert.equal(resultVisualData(p,{results:[]},'A'),null);
});

test('support axis shows narrow native intervals without cropping bounds or inventing spread',()=>{
  const p=fixture('universal-htl'),report=assess(p),cuts=report.results[0].impacts[0].cuts;
  const axis=supportAxis(cuts),lower=Math.min(...cuts.flatMap(c=>c.range)),upper=Math.max(...cuts.flatMap(c=>c.range));
  assert.ok(axis[0]>0);assert.ok(axis[0]<lower);assert.ok(axis[1]>upper);
  assert.ok(axis[1]-axis[0]<(upper-lower)*1.5);
  const constant=[{alpha:0,range:[4,4]},{alpha:1,range:[4,4]}];
  const constantAxis=supportAxis(constant);assert.ok(constantAxis[0]<4&&constantAxis[1]>4);
  assert.deepEqual(constant[0].range,[4,4]);assert.deepEqual(supportAxis([]),[0,1]);
});
