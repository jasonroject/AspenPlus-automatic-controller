const task=await taskSpace(10);const page=task.page('p2');
await page.goto('https://www.google.com/search?q=site%3Ahelp.autodesk.com+AutoCAD+%22POINT+(Command)%22+%22Node%22');
console.log(await page.evaluate(()=>[...document.querySelectorAll('a')].filter(a=>a.href.startsWith('https://help.autodesk.com/')&&a.innerText.length>10).map(a=>({text:a.innerText,url:a.href})).slice(0,6)));
const cad=task.page('p1');await cad.reload();await cad.waitForSelector('loc=role:button[name="打开文件菜单"]');
console.log(await cad.evaluate(()=>({buttons:[...document.querySelectorAll('button')].filter(x=>/绘制.*直线/.test(x.getAttribute('aria-label')||'')).map(x=>({label:x.getAttribute('aria-label'),text:x.textContent})),count:document.querySelectorAll('.object-select').length})));
