const task=await taskSpace(2),page=task.page('p1');
await page.click('loc=href:/pipeline.html',{label:'Open HTL prediction lab'});
await page.waitForSelector('#predict-button:not([disabled])');
console.log(await page.snapshot());
