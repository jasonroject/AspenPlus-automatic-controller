const task=await taskSpace(2),page=task.page('p1');
console.log(await page.info());console.log(await page.snapshot());
