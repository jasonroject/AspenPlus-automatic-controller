import {readFile,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {docs} from '../../analysis_web/docs-content.mjs';
const root=resolve('analysis_web');
const pages=['index.html','docs.html','brand.html','workspace.zh.html','index.en.html','universal.html','pipeline.html'];
const links=new Set();
for(const name of pages){const html=await readFile(resolve(root,name),'utf8');for(const [,link] of html.matchAll(/(?:href|src)="([^"]+)"/g))if(!link.startsWith('#')&&!/^(https?:|data:)/.test(link))links.add(link.split(/[?#]/)[0]);}
for(const doc of docs)for(const [,link]of doc.body.matchAll(/href="([^"]+)"/g))if(!link.startsWith('#')&&!link.startsWith('http'))links.add(link.split(/[?#]/)[0]);
for(const link of links)await access(resolve(root,link));
const manifest=JSON.parse(await readFile(resolve(root,'assets/brand/manifest.json'),'utf8'));
for(const logo of manifest.logos){const bytes=await readFile(resolve(root,logo.path));if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Invalid PNG '+logo.id);}
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
if(await hash(resolve(root,'assets/brand/logo-07.png'))!==await hash(resolve('outputs/site-refresh-20261117/download-logo-07.png')))throw new Error('Browser download differs from original');
console.log({localLinks:links.size,articles:docs.length,logos:manifest.logos.length,download:'hash matches original'});
