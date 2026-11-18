const task=await taskSpace(10);const gem=task.page('p3');
const fs=await import('node:fs/promises');await fs.writeFile('C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/cad-drawing-20261117/gemini-review.txt',await gem.snapshot({scope:'full_page'}),'utf8');
console.log({reviewUrl:await gem.url(),text:await gem.evaluate(()=>[...document.querySelectorAll('message-content')].map(x=>x.innerText).join('\n').slice(-9000))});
const ref=task.page('p2');await ref.click('loc=href:/view/ACD/2023/ENU/?guid=GUID-0A0135DB-3216-482B-81DD-74E6DB8CA3E3');
