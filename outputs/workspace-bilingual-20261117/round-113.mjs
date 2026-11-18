const fs=await import('node:fs/promises');const task=await taskSpace(2),page=task.page('p9');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await page.evaluate(()=>document.querySelector('#result-case').closest('.panel').scrollIntoView({block:'start',behavior:'instant'}));
await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/production-first-visit-results-zh.png'});
const result=await page.evaluate(()=>({url:location.href,language:document.documentElement.lang,caseCount:document.querySelectorAll('#result-case option').length,selectedCase:document.querySelector('#result-case').value,summary:document.querySelector('#result-case').closest('.panel').textContent,sessionSaved:Object.keys(sessionStorage).length>0,project:JSON.parse(document.querySelector('#project-json').value)}));
await fs.writeFile('C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/production-first-visit-acceptance.json',JSON.stringify({checkedAt:new Date().toISOString(),path:'New agent tab, empty sessionStorage, home Start analysis, import native37 project.json, review basis, calculate',...result},null,2));
console.log({language:result.language,caseCount:result.caseCount,selectedCase:result.selectedCase,sessionSaved:result.sessionSaved,locallyModified:result.project.meta.locally_modified??false});
console.log(await page.snapshot());
