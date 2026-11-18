const task=await taskSpace(2),page=task.page('p2');
const review=await page.evaluate(()=>({text:document.body.innerText,rows:[...document.querySelectorAll('table tr')].map(row=>[...row.querySelectorAll('th,td')].map(cell=>cell.innerText))}));
const fs=await import('node:fs/promises');
await fs.writeFile('C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/argon-copy-review.json',JSON.stringify(review,null,2),'utf8');
console.log({rowCount:review.rows.length,textLength:review.text.length,rows:review.rows});
