const task=await taskSpace(10);const page=task.page('p1');
const dp=page.waitForEvent('download',{timeout:30000});await page.click('loc=css:.header-actions button[title="下载可继续编辑的工程文件"]');await(await dp).saveAs('C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/cad-expansion-20261117/precision-example.extrudecad.json');
await page.reload();await page.waitForSelector('loc=role:button[name="打开文件菜单"]');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1130,height:650,deviceScaleFactor:1,mobile:false});
await page.click('loc=role:button[name="打开文件菜单"]');console.log(await page.snapshot());
