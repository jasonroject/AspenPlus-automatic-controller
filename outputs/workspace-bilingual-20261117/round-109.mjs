const task=await taskSpace(2),page=task.page('p9');await page.waitForSelector('button[aria-label="切换为中文"]',{state:'visible',timeout:10000});
console.log('settled first visit',await page.evaluate(()=>({lang:document.documentElement.lang,title:document.title,sessionKeys:Object.keys(sessionStorage),heading:document.querySelector('h1')?.textContent})));
console.log(await page.snapshot());
