const task=await taskSpace(2),page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
for(let i=0;i<5;i++){
  await page.focus('#apply-table');await page.press('#apply-table','Enter');
  await page.waitForFunction(n=>document.querySelector('#workflow-description').textContent.startsWith(n+' of 5'),i+1);
  if(i<4){await page.click('#worksheet-next');}
}
console.log(await page.evaluate(()=>({applied:document.querySelector('#workflow-description').textContent,counts:document.querySelector('#table-counts').innerText,nextDisabled:document.querySelector('#worksheet-next').disabled})));
await page.click('#import-next');
for(const [id,value] of [['project-name','Imported workbook QA'],['boundary','Synthetic feed and electricity'],['allocation-method','Single target, share 1'],['enthalpy-basis','Complete material streams, common reference, Q/W positive inward']])await page.fill('#'+id,value);
await page.click('#inventory-complete');await page.click('#comparable');await page.click('#calculate');
console.log(await page.evaluate(()=>({summary:document.querySelector('#results-summary').innerText,sidebar:{position:getComputedStyle(document.querySelector('.sidebar')).position,top:document.querySelector('.sidebar').getBoundingClientRect().top,navTop:document.querySelector('.sidebar nav').getBoundingClientRect().top,scroll:document.querySelector('.sidebar').scrollTop}})));
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
console.log(await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,wide:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&getComputedStyle(e).display!=='none').slice(0,8).map(e=>e.className)})));
await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-refresh-20261117/results-mobile.png'});
await page.click('[data-tab="import"]');await page.reload();await page.waitForFunction(()=>document.querySelector('#import-next').disabled);
await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-refresh-20261117/import-mobile.png'});
console.log(await page.snapshot());
