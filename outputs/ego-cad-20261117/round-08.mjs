const task=await taskSpace(9);const page=task.page('p1');
await page.click('loc=css:[data-testid="boolean-op-union"]');
console.log(await page.evaluate(()=>({layout:document.querySelector('.viewport-grid')?.className,status:[...document.querySelectorAll('[role="status"]')].map(x=>x.textContent),preview:!!document.querySelector('[data-testid="boolean-preview-commit"]')})));
console.log(await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/ego-cad-20261117/before-preview.png'}));
