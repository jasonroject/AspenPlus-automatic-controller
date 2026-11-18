const task=await taskSpace(2),page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
console.log(await page.evaluate(()=>({url:location.href,title:document.querySelector('#preview-title')?.textContent,scrollY,top:document.querySelector('button[data-id="24"]')?.getBoundingClientRect().top})));
if(await page.evaluate(()=>document.querySelector('#preview-title').textContent!=='Trace')){await page.focus('button[data-id="24"]');await page.press('button[data-id="24"]','Enter');}
console.log(await page.evaluate(()=>({brandMobile:document.querySelector('#preview-title').textContent,overflow:document.documentElement.scrollWidth>innerWidth,previewTop:document.querySelector('.brand-preview').getBoundingClientRect().top})));
console.log(await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/site-refresh-20261117/brand-mobile.png'}));
