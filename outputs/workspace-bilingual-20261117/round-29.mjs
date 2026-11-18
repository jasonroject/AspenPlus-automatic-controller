const task=await taskSpace(2),page=task.page('p3');
await page.goto('https://observablehq.github.io/plot/interactions/crosshair');
console.log(await page.evaluate(()=>({title:document.title,text:document.querySelector('.vp-doc')?.innerText.slice(0,7000)})));
await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/reference-crosshair-docs.png'});
console.log(await page.snapshot());
