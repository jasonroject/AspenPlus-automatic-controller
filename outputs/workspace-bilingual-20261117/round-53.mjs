const task=await taskSpace(2),page=task.page('p4');
console.log(await page.snapshot());
console.log(await page.evaluate(()=>({url:location.href,hash:location.hash,menu:document.querySelector('#docs-menu').getAttribute('aria-expanded'),nav:[...document.querySelectorAll('#docs-nav a')].map(a=>({text:a.textContent,href:a.getAttribute('href'),active:a.getAttribute('aria-current')}))})));
await page.focus('#docs-nav a[href="#quickstart"]');
await page.press('#docs-nav a[href="#quickstart"]','Enter');
console.log(await page.snapshot());
