const task=await taskSpace(10);const page=task.page('p2');
await page.goto('https://help.autodesk.com/view/ACD/2026/ENU/?caas=caas/documentation/ACD/2014/ENU/files/GUID-E8C1190C-A26C-484C-ADDD-DDF81666F69F-htm.html');
console.log(await page.snapshot({scope:'full_page'}));
