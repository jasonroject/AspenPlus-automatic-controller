const task=await taskSpace(2),page=task.page('p1');
console.log(await page.evaluate(()=>({axis:document.querySelector('#trend-axis').value,visible:!document.querySelector('#prediction-visuals').hidden})));
await page.selectOption('#trend-axis','length_m');
await page.selectOption('#trend-metric','carbon');
await page.click('#next-robust',{label:'Review scenario ranking stability'});
await page.waitForSelector('#section-robust:not([hidden])');
console.log(await page.snapshot());
await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/robustness-zh-initial.png'});
