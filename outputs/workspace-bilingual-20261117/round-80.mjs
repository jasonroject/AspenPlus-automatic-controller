const task=await taskSpace(2),page=task.page('p1');
await page.click('[data-language="zh"]');
await page.click('loc=href:/universal.html >> nth=0');
await page.waitForSelector('#files');
console.log(await page.snapshot());
