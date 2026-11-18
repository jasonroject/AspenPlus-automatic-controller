const task=await taskSpace(2),page=task.page('p1');
await page.snapshot();
console.log(await page.evaluate(()=>({title:document.title,lang:document.documentElement.lang,storage:localStorage.getItem('process-studio-language'),sheets:[...document.styleSheets].filter(s=>s.href?.includes('pipeline')).map(s=>({href:s.href,first:[...s.cssRules].slice(0,4).map(x=>x.cssText)})),grid:getComputedStyle(document.querySelector('#section-predict')).gridTemplateColumns,inner:innerWidth,scroll:document.documentElement.scrollWidth})));
await page.click('button[aria-label="切换为中文"]');
console.log(await page.snapshot());
