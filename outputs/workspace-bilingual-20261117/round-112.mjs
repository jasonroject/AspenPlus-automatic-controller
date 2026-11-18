const task=await taskSpace(2),page=task.page('p9');await page.click('@42');
await page.waitForFunction(()=>Boolean(document.querySelector('#result-case option')),undefined,{timeout:10000});
console.log(await page.snapshot());
