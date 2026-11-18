const task=await taskSpace(2),page=task.page('p1');
await page.cdp('Page.reload',{ignoreCache:true});
await page.waitForSelector('.inspection-slider');
console.log(await page.evaluate(()=>({rule:[...document.styleSheets].filter(s=>s.href?.includes('pipeline')).flatMap(s=>[...s.cssRules].filter(r=>r.selectorText?.includes('main > section')||r.selectorText?.includes('prediction-visuals')).map(r=>r.cssText)),lang:document.documentElement.lang})));
await page.focus('.inspection-slider');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
console.log('mobile settled',await page.evaluate(()=>({width:innerWidth,client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,grid:getComputedStyle(document.querySelector('#section-predict')).gridTemplateColumns,visual:getComputedStyle(document.querySelector('#prediction-visuals')).minWidth})));
await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/pipeline-mobile-fixed-zh.png'});
