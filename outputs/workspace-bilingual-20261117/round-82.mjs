const task=await taskSpace(2),page=task.page('p1');
await page.click('#calculate');
console.log('production native result',await page.evaluate(()=>({summary:document.querySelector('#results-summary').textContent,balance:document.querySelector('#balance-status').textContent,impact:document.querySelector('#impact-status')?.textContent,charts:document.querySelector('#result-visuals').querySelectorAll('svg').length,handOff:document.querySelector('#workflow-handoff')?.textContent})));
const report=page.waitForEvent('download',{timeout:30000});await page.click('#export-results');await(await report).saveAs('C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/production-native-report.json');
await page.click('[data-rv-view="energy"]');
const svg=page.waitForEvent('download',{timeout:30000});await page.click('[data-rv-export="equipment"][data-rv-format="svg"]');await(await svg).saveAs('C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/production-native-energy.svg');
await page.click('[data-language="en"]');
console.log('English retained native result',await page.evaluate(()=>({case:document.querySelector('#result-case').value,summary:document.querySelector('#results-summary').textContent,view:document.querySelector('[data-rv-view][aria-pressed="true"]').dataset.rvView})));
console.log(await page.snapshot());
