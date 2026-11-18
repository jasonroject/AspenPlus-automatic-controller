const task=await taskSpace(10);const page=task.page('p1');
console.log(await page.evaluate(()=>[...document.querySelectorAll('.header-actions button')].map(x=>({text:x.textContent,title:x.title,label:x.getAttribute('aria-label')}))));
