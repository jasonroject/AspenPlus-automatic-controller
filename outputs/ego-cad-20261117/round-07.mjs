const task = await taskSpace(9);
const page=task.page('p1');
console.log(await page.evaluate(()=>({panel:document.querySelector('#cad-command-panel')?.innerText,controls:[...document.querySelectorAll('#cad-command-panel button,#cad-command-panel select')].map(x=>({tag:x.tagName,text:x.textContent,label:x.getAttribute('aria-label'),test:x.getAttribute('data-testid')}))})));
const gemini=task.page('p2');
const fs=await import('node:fs/promises');
await fs.writeFile('C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/ego-cad-20261117/gemini-review.txt',await gemini.evaluate(()=>document.body.innerText),'utf8');
console.log({geminiUrl:await gemini.url()});
