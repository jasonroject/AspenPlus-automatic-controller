const task=await taskSpace(2),page=task.page('p3');
await page.click('loc=href:https://observablehq.com/@observablehq/plot-crosshairx',{label:'Study chart interaction example'});
console.log(await page.snapshot());
await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/reference-plot-crosshair.png'});
