const task=await taskSpace(2),page=task.page('p3');
await page.goto('https://observablehq.github.io/plot/marks/crosshair');
console.log(await page.snapshot());
