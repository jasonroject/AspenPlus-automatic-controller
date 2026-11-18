const task=await taskSpace(2),page=task.page('p1');
console.log(await page.snapshot());
await page.waitForSelector('#main h1');await page.fill('#doc-search','data contract');await page.press('#doc-search','Enter');await page.waitForFunction(()=>document.querySelector('h1')?.textContent==='Data contract');
console.log({docsURL:await page.url(),title:await page.title()});
await page.click('.site-nav a[href="brand.html"]');await page.waitForSelector('.logo-card');await page.waitForFunction(()=>document.querySelector('.logo-card img')?.naturalWidth>0);console.log(await page.evaluate(()=>({logos:document.querySelectorAll('.logo-card').length,first:document.querySelector('.logo-card img').naturalWidth})));
