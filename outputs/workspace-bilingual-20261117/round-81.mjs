const task=await taskSpace(2),page=task.page('p1');
await page.waitForSelector('[data-language="zh"]');
console.log('language after scripts',await page.evaluate(()=>({lang:document.documentElement.lang,title:document.title,stored:localStorage.getItem('process-studio-language')})));
await page.click('#load-htl');
await page.waitForFunction(()=>document.querySelector('#table-counts').textContent.includes('1'),undefined,{timeout:10000});
console.log(await page.snapshot());
