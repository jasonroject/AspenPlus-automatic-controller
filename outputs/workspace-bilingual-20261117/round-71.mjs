const task=await taskSpace(2),page=task.page('p1');await page.goto('http://127.0.0.1:8766/universal.html');await page.snapshot();
await page.click('.pipeline-tabs [data-tab="import"]');await page.setInputFiles('#files',['C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/mixed-factor-context.json']);await page.snapshot();
await page.focus('#calculate');await page.press('#calculate','Enter');await page.snapshot();
console.log('incompatible factors',await page.evaluate(()=>({summary:document.querySelector('#impact-results').textContent.slice(0,1200),exports:[...document.querySelectorAll('[data-rv-export]')].map(b=>({kind:b.dataset.rvExport,format:b.dataset.rvFormat,disabled:b.disabled})),chart:[...document.querySelectorAll('.rv-chart-card')].map(e=>e.textContent.slice(0,220))})));
await page.click('button[aria-label="切换为中文"]');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
console.log('translated mismatch',await page.evaluate(()=>document.querySelector('#impact-results').textContent.slice(0,650)));
