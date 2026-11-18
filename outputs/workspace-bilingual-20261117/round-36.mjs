const task=await taskSpace(2),page=task.page('p1');
await page.goto('http://127.0.0.1:8766/models.html');
console.log(await page.snapshot());
await page.click('#example-profile');
console.log(await page.evaluate(()=>({status:document.querySelector('#model-status').innerText,planDisabled:document.querySelector('[data-step="2"]').disabled,content:document.querySelector('#models-app').innerText.slice(0,2200)})));
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/models-draft-review-en.png'});
