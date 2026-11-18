import fs from 'node:fs';
import {createRequire} from 'node:module';
import {TABLES,blankProject} from '../../analysis_web/universal-core.mjs';
const require=createRequire(import.meta.url),XLSX=require('../../analysis_web/vendor/xlsx.full.min.js');
const native=JSON.parse(fs.readFileSync(new URL('../../analysis_web/data/universal-htl.json',import.meta.url),'utf8'));
const wb=XLSX.utils.book_new();
for(const [name,fields]of Object.entries(TABLES))XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([fields,...native[name].map(row=>fields.map(key=>row[key]??''))]),name);
fs.writeFileSync(new URL('native-five-tables.xlsx',import.meta.url),XLSX.write(wb,{type:'buffer',bookType:'xlsx'}));
fs.writeFileSync(new URL('blank-project.json',import.meta.url),JSON.stringify(blankProject(),null,2));
