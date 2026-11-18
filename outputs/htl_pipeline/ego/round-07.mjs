const task=await taskSpace(2);const page=task.page("p1");
await page.goto("https://vercel-pi-ten-59.vercel.app/pipeline.html");
await page.waitForSelector("#predict-button:not([disabled])");
console.log({title:await page.title(),url:await page.url(),status:await page.evaluate(()=>document.querySelector("#pipeline-status").innerText)});
await page.click('[data-section="robust"]');
console.log({first:await page.evaluate(()=>document.querySelector("#robust-body tr").innerText)});
await page.cdp("Emulation.setDeviceMetricsOverride",{width:1440,height:1040,deviceScaleFactor:1,mobile:false});
await page.evaluate(()=>scrollTo(0,360));
console.log({screenshot:await page.screenshot({path:"C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/htl_pipeline/published-robustness.png"})});
