import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,assess,rank} from '../analysis_web/universal-core.mjs';

export function mixedUnitTrain(){
  const project=blankProject();
  Object.assign(project.meta,{name:'Equivalent thermal trains',enthalpy_basis:'Common signed enthalpy reference; steady-state rates',boundary:'Purchased heating and shaft electricity only; cooling service outside the declared scope',allocation_method:'All burdens to declared target',inventory_complete:true,comparable_cases:true,calorie_J:4.184});
  project.factors=[
    {id:'heat',category:'Illustrative climate',value:.02,denominator_unit:'MJ',impact_unit:'kg CO2-eq',method:'Hand-arithmetic fixture',source:'Illustrative factor, not a database value'},
    {id:'electricity',category:'Illustrative climate',value:.5,denominator_unit:'kWh',impact_unit:'kg CO2-eq',method:'Hand-arithmetic fixture',source:'Illustrative factor, not a database value'}
  ];
  for(const id of ['SI','export-units']){
    const exported=id==='export-units';
    project.cases.push({id,product_rate:exported?3.7/.45359237:3.7,feed_rate:exported?100/.45359237:100,mass_unit:exported?'lb/hr':'kg/h',allocation:1,source:'Same offline thermal train, alternate reporting units'});
    for(const [stream,from,to,H] of [['feed','BOUNDARY','heater',-20],['hot','heater','cooler',32.3],['out','cooler','BOUNDARY',26]]){
      project.streams.push({case_id:id,id:stream,from,to,mass_flow:exported?100/1632.932532:100,mass_unit:exported?'lb/sec':'kg/h',enthalpy_flow:exported?H*3.6:H,energy_unit:exported?'MJ/hr':'kW',specific_enthalpy:exported?H*36/4.184:H*36,enthalpy_unit:exported?'cal/g':'kJ/kg',source:'Independent total and mass-specific enthalpy readouts'});
    }
    for(const [block,heat,power] of [['heater',52.3,0],['cooler',-10,3.7]])project.blocks.push({case_id:id,id:block,heat:exported?heat*1000/4.184:heat,power:exported?power*1000:power,heat_unit:exported?'cal/sec':'kW',power_unit:exported?'W':'kW',source:'Explicit positive-into-block sign convention'});
    project.inventory.push({case_id:id,id:'external-heat',name:'Purchased heating',kind:'energy',amount:exported?52.3*1000/4.184:52.3,unit:exported?'cal/sec':'kW',factor_id:'heat',source:'Explicit purchased utility'},
      {case_id:id,id:'shaft',name:'Purchased electricity',kind:'energy',amount:exported?3700:3.7,unit:exported?'W':'kW',factor_id:'electricity',source:'Explicit purchased utility'});
  }
  return project;
}

test('equivalent cross-unit cases close signed heating/cooling balances and reproduce purchased-energy accounting',()=>{
  const report=assess(mixedUnitTrain());
  for(const result of report.results){
    assert.equal(result.balance.within_tolerance,true);
    assert.ok(Math.abs(result.balance.total.energy_residual_kW)<1e-12);
    assert.ok(Math.abs(result.balance.total.external_heat_in_kW-52.3)<1e-12);
    assert.ok(Math.abs(result.balance.total.external_heat_out_kW-10)<1e-12);
    assert.ok(Math.abs(result.energy.at(-1).range[0]-56/3.7)<1e-12);
    assert.ok(Math.abs(result.impacts[0].nominal_subtotal-(52.3*3.6*.02+3.7*.5)/3.7)<1e-12);
  }
});

test('roundoff from alternate source units cannot turn equivalent candidates into opposite ranking extremes',()=>{
  const report=assess(mixedUnitTrain()),comparison=rank(report,report.categories[0],[1,1,1],true);
  assert.ok(Math.abs(comparison.rows[0].score-comparison.rows[1].score)<1e-12,JSON.stringify(comparison));
  for(const row of comparison.rows)assert.deepEqual(row.possible_rank,[1,2]);
});

test('relative floating-point policy preserves real differences between near-zero positive metrics',()=>{
  const report=assess(mixedUnitTrain());
  // Exercise rank's numeric contract directly: these tiny values differ by 2x,
  // not by floating-point resolution, regardless of their absolute magnitude.
  for(const [index,row] of report.results.entries())row.energy=row.energy.map(cut=>({...cut,range:[(index+1)*1e-20,(index+1)*1e-20]}));
  const comparison=rank(report,report.categories[0],[1,0,0],true);
  assert.equal(comparison.rows[0].id,'SI');assert.equal(comparison.rows[0].score,1);
  assert.equal(comparison.rows[1].score,0);assert.deepEqual(comparison.rows[0].possible_rank,[1,1]);
});
