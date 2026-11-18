const task=await taskSpace(9);const page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
await page.reload();
await page.waitForSelector('.object-select');
console.log(await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/ego-cad-20261117/updated-1366.png'}));
console.log(await page.evaluate(()=>({selected:[...document.querySelectorAll('.object-select[aria-pressed="true"]')].map(x=>x.textContent),canvas:[...document.querySelectorAll('canvas')].map(x=>{const r=x.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}),labels:[...document.querySelectorAll('[role="toolbar"][aria-label="建模工具"] button')].slice(-4).map(x=>x.textContent)})));
