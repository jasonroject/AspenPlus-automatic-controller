const task=await taskSpace(2),page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
console.log(await page.evaluate(()=>({inner:innerWidth,client:document.documentElement.clientWidth,visual:visualViewport.width,screen:screen.width,outer:outerWidth,wide:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().width>392&&getComputedStyle(e).display!=='none').map(e=>({tag:e.tagName,id:e.id,class:e.className,width:e.getBoundingClientRect().width,min:getComputedStyle(e).minWidth,display:getComputedStyle(e).display})).slice(0,28)})));
await page.click('[data-section="predict"]');
console.log(await page.evaluate(()=>['.workspace','main','#section-predict','#prediction-visuals','#response-chart','.chart-grid','.panel'].map(s=>{const e=document.querySelector(s),c=getComputedStyle(e);return{s,width:e.getBoundingClientRect().width,min:c.minWidth,grid:c.gridTemplateColumns,padding:c.padding}})));
