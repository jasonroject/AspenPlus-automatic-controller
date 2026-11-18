const task=await taskSpace(2),page=task.page('p1');await page.snapshot();
console.log('after parse',await page.evaluate(()=>({message:document.querySelector('#message').textContent,source:document.querySelector('#mapping-source').textContent,options:[...document.querySelector('#sheet').options].map(o=>o.textContent),busy:document.querySelector('#files').disabled})));
await page.click('button[aria-label="切换为中文"]');
await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
console.log('leftover',await page.evaluate(()=>[...document.querySelectorAll('button,label,p,summary,h1,h2,h3')].filter(e=>e.getClientRects().length&&!e.closest('pre,code,[data-no-i18n]')&&e.children.length===0&&/[a-z]{3}/i.test(e.textContent)&&!/[\u3400-\u9fff]/.test(e.textContent)).map(e=>e.textContent.trim()).slice(0,25)));
