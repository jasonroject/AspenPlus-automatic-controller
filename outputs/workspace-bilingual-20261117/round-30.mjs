const task=await taskSpace(2),page=task.page('p2');
console.log(await page.snapshot());
const review=await page.evaluate(()=>document.body.innerText);
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/argon-statistical-review.txt',review,'utf8');
console.log(review.slice(-14000));
