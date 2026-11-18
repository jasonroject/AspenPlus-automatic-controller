import fs from 'node:fs';
import {assess,rank,rate,convert} from '../../analysis_web/universal-core.mjs';
const example=()=>JSON.parse(fs.readFileSync(new URL('../../analysis_web/data/universal-example.json',import.meta.url),'utf8'));
console.log('denominator',rate(1,'kWh/h','MJ'),rate(1,'kWh/h','mJ'));
let p=example(),r=assess(p);for(const weights of [[1],[1,1],[1,1,1,1],[1e308,1e308,1e308]]){try{console.log('weights',weights,rank(r,r.categories[0],weights,true));}catch(e){console.log(e.message);}}
p=example();p.inventory[0].amount=1e308;p.inventory[0].amount_low=1e308;p.inventory[0].amount_high=1e308;p.factors[0].value=1e308;p.factors[0].low=1e308;p.factors[0].high=1e308;r=assess(p);console.log('overflow',JSON.stringify(r.results[0]));
p=example();p.blocks[0].id='BOUNDARY';p.blocks[0].heat=-10;p.blocks.push({case_id:'A',id:'SECOND',heat:10,power:0,energy_unit:'kW'});p.streams[0].from='BOUNDARY';p.streams[0].to='SECOND';p.streams[1].from='SECOND';p.streams[1].to='BOUNDARY';r=assess(p);console.log('sentinel',r.results[0].balance);
console.log('convert overflow',convert(1e308,'MW','energy'));
