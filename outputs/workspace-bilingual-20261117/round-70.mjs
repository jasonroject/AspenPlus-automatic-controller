const task=await taskSpace(2),page=task.page('p1');
for(const format of ['svg','csv']){const download=page.waitForEvent('download',{timeout:30000});await page.click(`[data-rv-export="equipment"][data-rv-format="${format}"]`);await(await download).saveAs(`C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/native-energy-zh.${format}`);}
await page.click('button[aria-label="Switch to English"]');
console.log('exports language',await page.evaluate(()=>[...document.querySelectorAll('[data-rv-export]')].map(e=>e.textContent)));
await page.click('[data-rv-view="cases"]');
console.log('case export',await page.evaluate(()=>[...document.querySelectorAll('[data-rv-export]')].map(e=>({kind:e.dataset.rvExport,disabled:e.disabled}))));
await page.click('.pipeline-tabs [data-tab="context"]');
console.log('basis controls',await page.evaluate(()=>[...document.querySelectorAll('section:not([hidden]) input')].map(e=>({id:e.id,value:e.value,type:e.type}))));
