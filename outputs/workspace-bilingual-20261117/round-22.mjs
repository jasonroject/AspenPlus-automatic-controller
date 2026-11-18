const task=await taskSpace(2),page=task.page('p2');
await page.snapshot();
const response=await page.evaluate(()=>document.body.innerText);
const fs=await import('node:fs/promises');
await fs.writeFile('C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/argon-model-review.txt',response,'utf8');
console.log(response.slice(-18000));
