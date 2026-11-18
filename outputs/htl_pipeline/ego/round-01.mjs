const task=await taskSpace(2);const page=task.page("p1");
await page.cdp("Emulation.setDeviceMetricsOverride",{width:1440,height:1040,deviceScaleFactor:1,mobile:false});
console.log({screenshot:await page.screenshot({path:"C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/htl_pipeline/prediction-desktop.png"})});
console.log(await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,font:getComputedStyle(document.body).fontFamily})));
