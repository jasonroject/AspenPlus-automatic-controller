const task=await taskSpace(2),page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
console.log(await page.evaluate(()=>({step:document.querySelector('#workflow-count').textContent})));
await page.focus('[data-tab="import"]');await page.press('[data-tab="import"]','Enter');await page.focus('#load-htl');await page.press('#load-htl','Enter');await page.waitForFunction(()=>!document.querySelector('#calculate').disabled&&!document.querySelector('#tab-context').hidden);await page.focus('#calculate');await page.press('#calculate','Enter');
console.log(await page.evaluate(()=>({nativeSummary:document.querySelector('#results-summary').innerText,compareHint:document.querySelector('#comparison-hint').textContent})));
await page.click('.sidebar a[href="pipeline.html"]');await page.waitForFunction(()=>document.querySelector('#evidence-stats')?.children.length>0);console.log(await page.evaluate(()=>({title:document.title,error:document.querySelector('#pipeline-error').textContent})));
await page.goto('http://127.0.0.1:8766/index.en.html#view=process');await page.waitForSelector('canvas');console.log(await page.evaluate(()=>({title:document.title,canvas:!!document.querySelector('canvas')})));
