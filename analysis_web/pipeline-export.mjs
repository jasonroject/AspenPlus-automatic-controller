// Numeric chart exports retain the existing frozen grid and native records.
export const predictionColumns = ['record_id','temperature_C','length_m','scenario','response','value','unit','evidence_type','split','selected_prediction','source','source_record','source_sha256','reference_sha256','wet_feed_kg','duration_h','pressure_MPa','status','physical_validation'];
export const responseUnit = key => key === 'target_kg_h' ? 'kg / 100 kg wet feed' : key.startsWith('CF_') ? 'kg CO2-eq/kg target' : 'kWh / 100 kg wet feed';
export const canExportPrediction = (analysis,current,dirty=false) => !dirty && analysis?.prediction_enabled === true && Number.isFinite(current?.temperature_C) && Number.isFinite(current?.length_m);

export function predictionChartRows(kind,{analysis,current,scenario='HR',slice,observations={sources:[]},dirty=false}) {
  if (!canExportPrediction(analysis,current,dirty)) return [];
  const record = (row, key, route, native=false) => {
    const source = native ? observations.sources?.find(item=>item.id===row.source) : null;
    return {
      record_id:native ? row.source_record || `${row.source}:${row.temperature_C}:${row.length_m}` : `grid:${row.temperature_C}:${row.length_m}:${route}`,
      temperature_C:row.temperature_C,length_m:row.length_m,scenario:route,response:key,value:row[key],unit:responseUnit(key),
      evidence_type:native?'native_simulation':'frozen_GP_prediction',split:native?row.split:'',
      selected_prediction:!native&&row.temperature_C===current.temperature_C&&row.length_m===current.length_m,
      source:native?source?.path||row.source:'data/study/surrogate/grid.json',source_record:native?row.source_record||'':'',source_sha256:source?.sha256||'',
      reference_sha256:analysis.training?.reference_sha256||'',wet_feed_kg:analysis.basis?.wet_feed_kg,duration_h:analysis.basis?.duration_h,pressure_MPa:analysis.basis?.pressure_MPa,
      status:'available',physical_validation:false,
    };
  };
  let rows;
  if (kind === 'response') {
    if (!slice?.predictions?.length || !Array.isArray(slice.native)) return [];
    rows=[...slice.predictions.map(row=>record(row,slice.metric,scenario)),...slice.native.map(row=>record(row,slice.metric,scenario,true))].sort((a,b)=>a[slice.axis]-b[slice.axis]);
  } else if (kind === 'energy' || kind === 'carbon') {
    rows=['STD','HR'].map(route=>record(current,kind==='energy'?`${route}_electricity_kWh`:`CF_${route}`,route));
  } else return [];
  return rows.every(row=>Number.isFinite(row.value)&&Number.isFinite(row.temperature_C)&&Number.isFinite(row.length_m)) ? rows : [];
}
