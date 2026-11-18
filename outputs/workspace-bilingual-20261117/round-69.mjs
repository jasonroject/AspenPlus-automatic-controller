const task=await taskSpace(2),page=task.page('p1');await page.snapshot();
console.log('controls',await page.evaluate(()=>[...document.querySelectorAll('[data-rv-export]')].map(e=>({kind:e.dataset.rvExport,format:e.dataset.rvFormat,text:e.textContent}))));
