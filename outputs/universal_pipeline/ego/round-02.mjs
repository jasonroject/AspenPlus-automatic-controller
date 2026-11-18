const task=await taskSpace(2);const page=task.page("p1");await page.click("#load-demo");console.log(await page.snapshot());
