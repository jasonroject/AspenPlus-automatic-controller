const task=await taskSpace(2);const page=task.page("p1");
await page.reload();await page.waitForSelector("#predict-button:not([disabled])");
const checks=[];
for(const section of ["predict","robust","evidence"]){await page.click('[data-section="'+section+'"]');checks.push(await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,section:document.querySelector('[data-section][aria-pressed="true"]').dataset.section}))); }
await page.click("#scan-body summary >> nth=0");
console.log({layouts:checks,warnings:await page.evaluate(()=>document.querySelector("#scan-body details").innerText)});
const download=page.waitForEvent("download",{timeout:30000});await page.click("#download-analysis");await (await download).saveAs("C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/htl_pipeline/browser-analysis.json");
await page.cdp("Emulation.setDeviceMetricsOverride",{width:1130,height:780,deviceScaleFactor:1,mobile:false});
await page.click('[data-section="robust"]');
console.log({midWidth:await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}))});
await page.cdp("Emulation.setDeviceMetricsOverride",{width:1440,height:1040,deviceScaleFactor:1,mobile:false});
await page.evaluate(()=>scrollTo(0,400));
console.log({screenshot:await page.screenshot({path:"C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/htl_pipeline/robustness-desktop.png"})});
await page.goto("http://127.0.0.1:8766/index.en.html#view=cases");
console.log(await page.snapshot());
