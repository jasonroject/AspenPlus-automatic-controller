const task=await taskSpace(2),page=task.page('p9');await page.click('@9');
await page.waitForURL('**/universal.html');
console.log('fresh project state',await page.evaluate(()=>({url:location.href,language:document.documentElement.lang,title:document.title,sessionKeys:Object.keys(sessionStorage)})));
console.log(await page.snapshot());
