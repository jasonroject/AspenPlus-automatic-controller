const task=await taskSpace(2),page=task.page('p1');
console.log(await page.evaluate(()=>({prediction:document.querySelector('#prediction-result').innerText,native:document.querySelector('#native-match').innerText,controls:[...document.querySelectorAll('#section-predict select')].map(s=>({id:s.id,value:s.value,options:[...s.options].map(o=>({value:o.value,label:o.label}))}))})));
await page.selectOption('#trend-axis','length');
await page.selectOption('#trend-metric','energy');
await page.click('#next-robust',{label:'Review scenario ranking stability'});
await page.waitForSelector('#section-robust:not([hidden])');
console.log(await page.snapshot());
await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/robustness-zh-initial.png'});
