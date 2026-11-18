const task=await taskSpace(2),page=task.page('p9');await page.click('@55');
await page.evaluate(()=>document.querySelector('#visual-section').scrollIntoView({block:'start',behavior:'instant'}));
console.log(await page.snapshot());
await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/production-native37-visual-comparison-zh.png'});
