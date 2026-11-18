const task=await taskSpace(2),page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await page.click('#docs-nav a[href="#contract"]');await page.waitForFunction(()=>document.querySelector('h1').textContent==='Data contract');
console.log(await page.evaluate(()=>({mobileMenu:document.querySelector('#docs-menu').getAttribute('aria-expanded'),overflow:document.documentElement.scrollWidth>innerWidth,tableScroll:[...document.querySelectorAll('.table-wrap')].every(t=>t.scrollWidth>=t.clientWidth)})));
console.log(await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/site-refresh-20261117/docs-mobile.png'}));
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
await page.click('#docs-nav a[href="#api"]');await page.waitForFunction(()=>document.querySelector('h1').textContent==='JavaScript reference');
await page.click('.copy-button');
try{await page.waitForFunction(()=>document.querySelector('.copy-button').textContent!=='Copy',undefined,{timeout:3000});console.log(await page.evaluate(()=>({copy:document.querySelector('.copy-button').textContent})));}catch(error){console.log({copyWait:error.message});}
await page.click('#docs-toc a[href="#api/helpers"]');await page.waitForFunction(()=>document.querySelector('#helpers').getBoundingClientRect().top<200);
console.log(await page.evaluate(()=>({anchor:location.hash,top:document.querySelector('#helpers').getBoundingClientRect().top})));
await page.goto('http://127.0.0.1:8766/');await page.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
console.log(await page.evaluate(()=>({reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,animation:getComputedStyle(document.querySelector('.label-track')).animationName})));
await page.cdp('Emulation.setEmulatedMedia',{features:[]});
await page.click('.hero a[href="universal.html"]');await page.waitForSelector('#load-demo');await page.click('#load-demo');await page.waitForFunction(()=>document.querySelector('#project-name').value.includes('Synthetic'));await page.click('#calculate');await page.waitForSelector('#balance-body tr');
console.log(await page.evaluate(()=>({title:document.title,balance:document.querySelector('#balance-status').textContent,impact:document.querySelector('#impact-results').textContent.slice(0,250),docs:document.querySelector('.pipeline-top a').getAttribute('href')})));
console.log(await page.snapshot());
