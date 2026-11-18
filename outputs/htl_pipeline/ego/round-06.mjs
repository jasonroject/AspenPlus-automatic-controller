const task=await taskSpace(2);const page=task.page("p1");
await page.click('a[href="pipeline.html"]');await page.waitForSelector("#predict-button:not([disabled])");
await page.cdp("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
const checks=[];
for(const section of ["predict","robust","evidence"]){await page.click('[data-section="'+section+'"]');checks.push(await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,section:document.querySelector('[data-section][aria-pressed="true"]').dataset.section}))); }
console.log({mobileLayouts:checks});
await page.click('[data-section="predict"]');await page.fill("#predict-temperature","400");
console.log({staleResultCleared:await page.evaluate(()=>!document.querySelector("#prediction-result").textContent),invalid:await page.evaluate(()=>!document.querySelector("#predict-temperature").validity.valid)});
await page.fill("#predict-temperature","330");await page.click("#predict-button");
await page.evaluate(()=>document.querySelector("#prediction-form").scrollIntoView({block:"center"}));
console.log({screenshot:await page.screenshot({path:"C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/htl_pipeline/mobile-prediction.png"})});
