const task=await taskSpace(2),page=task.page('p9');
await page.setInputFiles('input[type="file"]',['C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/analysis_web/data/generic-htl-extension/project.json']);
await page.waitForFunction(()=>{const input=document.querySelector('#project-json');return input&&input.value.includes('htl-reference-hr');},undefined,{timeout:10000});
console.log(await page.snapshot({scope:'full_page'}));
