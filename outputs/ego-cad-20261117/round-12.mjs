const task=await taskSpace('CAD optimization verification 20261117');
const page=task.page('p1');
await page.goto('http://localhost:5180/ExtrudeCAD_Studio.html');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
await page.waitForSelector('.object-select');
console.log({spaceId:task.spaceId});
console.log(await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/ego-cad-20261117/reopened-1366.png'}));
