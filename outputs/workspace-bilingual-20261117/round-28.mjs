const task=await taskSpace(2),page=task.page('p3');
await page.goto('https://observablehq.github.io/plot/getting-started');
console.log(await page.snapshot());
console.log(await page.evaluate(()=>[...document.querySelectorAll('a[href]')].filter(a=>/crosshair|pointer|interaction/i.test(a.textContent)).map(a=>({text:a.textContent,href:a.href}))));
