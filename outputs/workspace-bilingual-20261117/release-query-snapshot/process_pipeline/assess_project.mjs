// Node bridge: calculations come from the same core as the public workspace.
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {assess} from '../analysis_web/universal-core.mjs';

export function assessProject(project){
  const report=assess(project);
  const cases=report.results.map(result=>({
    id:result.id,
    numerical_closure:result.balance.complete&&result.balance.within_tolerance,
    lcia_complete:Boolean(result.impacts.length)&&result.impacts.every(impact=>impact.complete),
    metric_inputs_complete:Boolean(result.energy&&result.yield)&&!result.issues.length,
    metrics:{purchased_energy_kWh_kg:result.energy?.at(-1).range[0]??null,
      yield_fraction:result.yield?.[1]??null,
      impacts:Object.fromEntries(result.impacts.map(impact=>[impact.category,{value:impact.complete?impact.nominal_subtotal:null,unit:impact.unit+'/kg',complete:impact.complete}]))},
    physical_validation:false
  }));
  return {assessment_version:1,core:'analysis_web/universal-core.mjs',report,cases};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const [input,output]=process.argv.slice(2);
  if(!input||!output)throw new Error('Usage: node process_pipeline/assess_project.mjs input.json output.json');
  let result;
  try{result=assessProject(JSON.parse(await readFile(input,'utf8')));}
  catch(error){result={assessment_version:1,error:error.message,cases:[],report:null};process.exitCode=2;}
  await writeFile(output,JSON.stringify(result,null,2)+'\n','utf8');
}
