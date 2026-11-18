const task=await taskSpace(10);const page=task.page('p1');
await page.click('loc=role:tab[name="旋转 XY"]');
console.log(await page.evaluate(()=>({text:document.querySelector('#cad-command-panel')?.innerText,inputs:[...document.querySelectorAll('#cad-command-panel form input')].map(x=>({label:x.getAttribute('aria-label'),name:x.name,value:x.value,type:x.type}))})));
