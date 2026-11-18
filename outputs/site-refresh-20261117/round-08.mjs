const task=await taskSpace(2),page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
console.log(await page.evaluate(()=>({url:location.href,scrollY,height:innerHeight,total:document.documentElement.scrollHeight,top:document.querySelector('#helpers')?.getBoundingClientRect().top,bottom:document.querySelector('#helpers')?.getBoundingClientRect().bottom,focus:document.activeElement.tagName})));
await page.goto('http://127.0.0.1:8766/');await page.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
console.log(await page.evaluate(()=>({reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,animation:getComputedStyle(document.querySelector('.label-track')).animationName})));
await page.cdp('Emulation.setEmulatedMedia',{features:[]});
await page.click('.hero a[href="universal.html"]');await page.waitForSelector('#load-demo');await page.click('#load-demo');await page.waitForFunction(()=>document.querySelector('#project-name').value.includes('Synthetic'));await page.focus('#calculate');await page.press('#calculate','Enter');await page.waitForSelector('#balance-body tr');
console.log(await page.evaluate(()=>({title:document.title,balance:document.querySelector('#balance-status').textContent,impact:document.querySelector('#impact-results').textContent.slice(0,250),docs:document.querySelector('.pipeline-top a').getAttribute('href')})));
console.log(await page.snapshot());
