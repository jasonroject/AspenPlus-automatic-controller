const task=await taskSpace(2),page=task.page('p2');
await page.snapshot();
const content=await page.evaluate(()=>document.body.innerText);
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/argon-onboarding-review.txt',content,'utf8');
console.log(content.slice(-9500));
