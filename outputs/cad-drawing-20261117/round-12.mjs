const task=await taskSpace(10);const page=task.page('p1');
await page.reload();await page.waitForSelector('loc=role:button[name="打开文件菜单"]');
await page.click('loc=role:button[name="打开文件菜单"]');const cp=page.waitForFileChooser({timeout:10000});await page.click('loc=role:menuitem[name*="打开工程"]');await(await cp).setFiles('C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/cad-drawing-20261117/empty.extrudecad.json');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1130,height:750,deviceScaleFactor:1,mobile:false});
await page.click('loc=role:button[name="绘制直线"]');
console.log(await page.snapshot());
await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/cad-drawing-20261117/new-line-command.png'});
