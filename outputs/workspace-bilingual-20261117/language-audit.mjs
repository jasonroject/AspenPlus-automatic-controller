import {readFile} from 'node:fs/promises';
import {dictionary} from '../../analysis_web/i18n-dictionary.mjs';
const html=await readFile(new URL('../../analysis_web/universal.html',import.meta.url),'utf8');
console.log([...new Set([...html.matchAll(/>([^<>]+)</g)].map(m=>m[1].trim().replace(/&amp;/g,'&')).filter(s=>/[a-z]{2}/i.test(s)&&!dictionary[s]))]);
