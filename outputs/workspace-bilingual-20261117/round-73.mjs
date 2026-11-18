const task=await taskSpace(2),page=task.page('p1');await page.goto('http://127.0.0.1:8766/universal.html');await page.snapshot();
console.log('restored17',await page.evaluate(()=>({cases:document.querySelector('#result-case').options.length,selected:document.querySelector('#result-case').value})));
const ids=await page.evaluate(()=>[...document.querySelector('#result-case').options].map(o=>o.value));const records=[];
for(const id of ids){await page.selectOption('#result-case',id);records.push(await page.evaluate(()=>({id:document.querySelector('#result-case').value,status:document.querySelector('#result-summary')?.textContent||document.querySelector('#results-next')?.textContent,charts:document.querySelector('#result-visuals').querySelectorAll('[data-rv-view]').length})));}
console.log('selected all native cases',records);
const exported=page.waitForEvent('download',{timeout:30000});await page.click('#export-results');await(await exported).saveAs('C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/native17-browser-audit.json');
await page.goto('http://127.0.0.1:8766/pipeline.html?from=import');await page.snapshot();
console.log('generic reference entry',await page.evaluate(()=>document.querySelector('#reference-context').textContent));
await page.goto('http://127.0.0.1:8766/pipeline.html?from=import&reference=htl&temperature=325&length=8.5&scenario=STD');await page.snapshot();
console.log('reference exact entry',await page.evaluate(()=>({entry:document.querySelector('#reference-context').textContent,pair:document.querySelector('#pair-context').textContent,native:document.querySelector('#native-match').textContent,basis:document.querySelector('#accounting-basis')?.textContent})));
