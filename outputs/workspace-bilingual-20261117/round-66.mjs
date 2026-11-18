const task=await taskSpace(2),page=task.page('p4');
await page.goto('file:///C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/response-slice.svg');
console.log(await page.snapshot());
await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/exported-response-svg-preview.png'});
