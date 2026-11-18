const task=await taskSpace(2);const page=task.page("p1");
console.log({evidence:await page.evaluate(()=>document.querySelector("#section-evidence").innerText)});
await page.cdp("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
console.log({mobile:await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll("main *")].filter(x=>x.offsetWidth&&x.getBoundingClientRect().right>innerWidth+1&&!x.closest(".table-scroll")).slice(0,8).map(x=>x.tagName+"."+x.className)}))});
console.log({screenshot:await page.screenshot({path:"C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/htl_pipeline/mobile-evidence.png"})});
console.log(await page.snapshot());
