const task=await taskSpace(2),page=task.page('p1');
await page.reload();
await page.waitForSelector('#tab-results:not([hidden])');
console.log('restored',await page.evaluate(()=>({lang:document.documentElement.lang,title:document.title,summary:document.querySelector('#results-summary').innerText,href:document.querySelector('#open-prediction').getAttribute('href')})));
await page.click('[data-tab="import"]',{label:'Test pending draft recovery'});
console.log(await page.snapshot());
