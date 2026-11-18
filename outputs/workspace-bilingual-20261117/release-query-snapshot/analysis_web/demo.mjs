import {assess,rank} from './universal-core.mjs';
export const exampleCode = `import { assess, rank } from './universal-core.mjs';

const project = await fetch('./data/universal-example.json')
  .then(response => response.json());
const report = assess(project);
const comparison = rank(report, 'Illustrative climate',
  [1, 1, 1], project.meta.comparable_cases);

console.log(report.results, comparison.rows);`;
export function summarizeExample(project){
  const report=assess(project);
  const comparison=rank(report,'Illustrative climate',[1,1,1],project.meta.comparable_cases);
  const a=report.results.find(r=>r.id==='A');
  const impact=a.impacts.find(i=>i.category==='Illustrative climate');
  if(!a.balance.within_tolerance||!impact.complete)throw new Error('Example validation failed. Inspect the project and factors.');
  return {report,comparison,text:`Case A · energy ${a.energy.at(-1).range[0].toFixed(2)} kWh/kg\nClimate ${impact.nominal_subtotal.toFixed(2)} kg CO2-eq/kg\nα = 0: [${impact.cuts[0].range.map(x=>x.toFixed(3)).join(', ')}]\nNominal order: ${comparison.rows.map(r=>r.id).join(' → ')} · possible ranks ${comparison.rows.map(r=>`${r.id}: ${r.possible_rank.join('–')}`).join(', ')}`};
}
export async function runExample(button,output){button.disabled=true;output.textContent='Loading the synthetic example…';try{const response=await fetch('./data/universal-example.json');if(!response.ok)throw new Error(`Example request failed (${response.status})`);output.textContent=summarizeExample(await response.json()).text;}catch(error){output.textContent=error.message;}finally{button.disabled=false;}}
