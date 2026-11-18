const task=await taskSpace(2),page=task.page('p2');
await page.waitForSelector('textarea');
console.log(await page.snapshot());
