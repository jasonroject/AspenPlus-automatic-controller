const task=await taskSpace(10);const page=task.page('p1');
await page.click('loc=role:button[name="撤销上一步操作"]');await page.waitForFunction(()=>document.querySelectorAll('.object-row').length===2);
await page.click('loc=css:.object-select[title="圆柱 Ø10×20"]');
await page.click('loc=role:button[name="打开变换与阵列菜单"]');
console.log(await page.evaluate(()=>({text:document.querySelector('#cad-command-panel')?.innerText,inputs:[...document.querySelectorAll('#cad-command-panel input')].map(x=>({name:x.name,label:x.getAttribute('aria-label'),value:x.value,type:x.type}))})));
