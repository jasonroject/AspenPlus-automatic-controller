const task=await taskSpace(2),page=task.page('p1');
console.log(await page.evaluate(()=>({summaries:[...document.querySelectorAll('#tab-import summary')].map(s=>s.textContent),panels:[...document.querySelectorAll('#tab-import details')].map(d=>({open:d.open,summary:d.querySelector('summary').textContent}))})));
console.log(await page.snapshot());
