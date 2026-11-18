const task=await taskSpace(2),page=task.page('p1');
await page.goto('http://127.0.0.1:8766/universal.html');
console.log(await page.evaluate(()=>({title:document.title,step:document.querySelector('#workflow-title').innerText,summary:document.querySelector('#results-summary').innerText,reference:document.querySelector('#reference-lab-link')?.href,language:document.documentElement.lang})));
console.log(await page.snapshot());
