const task=await taskSpace(2),page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await page.click('[data-language="zh"]',{label:'Switch workspace to Chinese'});
await page.click('[data-rv-view="energy"]',{label:'Inspect imported equipment duties'});
console.log(await page.evaluate(()=>({lang:document.documentElement.lang,case:document.querySelector('#result-case').value,category:document.querySelector('#rank-category').value,summary:document.querySelector('#results-summary').innerText,chart:document.querySelector('.rv-body').innerText,overflow:document.documentElement.scrollWidth>innerWidth})));
await page.click('[data-rv-view="impact"]',{label:'Inspect impact contribution charts'});
await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/native-charts-zh.png'});
console.log(await page.snapshot());
