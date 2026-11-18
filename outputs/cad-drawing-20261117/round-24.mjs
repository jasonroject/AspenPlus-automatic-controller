const task=await taskSpace('CAD point and line verification');const page=task.page('p1');
await page.goto('http://localhost:5180/ExtrudeCAD_Studio.html');
await page.waitForSelector('loc=role:button[name="创建定位点"]');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1130,height:750,deviceScaleFactor:1,mobile:false});
console.log({taskSpaceId:task.spaceId,page:page.label});console.log(await page.snapshot());
