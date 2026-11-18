const task=await taskSpace(2),page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
console.log(await page.evaluate(()=>({url:location.href,title:document.title})));
await page.click('.hero a[href="docs.html#quickstart"]');await page.waitForSelector('#docs-menu');await page.click('#docs-menu');console.log(await page.snapshot());
