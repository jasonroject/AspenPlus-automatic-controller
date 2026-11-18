const task=await taskSpace(2),page=task.page('p1');
console.log(await page.snapshot());
console.log(await page.evaluate(()=>({url:location.href,language:document.documentElement.lang,message:document.querySelector('#model-status')?.innerText,artifact:document.querySelector('#artifact-message')?.innerText,view:document.querySelector('#artifact-view')?.innerText.slice(0,1200),summary:document.querySelector('#results-summary')?.innerText})));
