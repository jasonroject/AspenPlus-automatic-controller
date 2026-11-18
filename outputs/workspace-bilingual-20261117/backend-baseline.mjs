import fs from 'node:fs';
import {assess,rank} from '../../analysis_web/universal-core.mjs';
const rows={};
for(const name of ['universal-example','universal-htl']){
  const p=JSON.parse(fs.readFileSync(new URL(`../../analysis_web/data/${name}.json`,import.meta.url),'utf8'));
  const report=assess(p);rows[name]={report,ranking:name==='universal-example'?rank(report,report.categories[0],[1,1,1],true):null};
}
const destination=new URL('./backend-baseline.json',import.meta.url);
if(fs.existsSync(destination)){
  const before=fs.readFileSync(destination,'utf8');
  console.log({canonicalReportsExactlyUnchanged:before===JSON.stringify(rows,null,2)});
}else{fs.writeFileSync(destination,JSON.stringify(rows,null,2));console.log('Saved numerical baseline');}
