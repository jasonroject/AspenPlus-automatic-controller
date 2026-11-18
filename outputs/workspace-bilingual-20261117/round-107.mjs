const task=await taskSpace(2);const page=await task.newPage();
await page.goto('https://vercel-pi-ten-59.vercel.app/?lang=zh');
console.log({page:page.label,title:await page.title(),url:await page.url()});
console.log(await page.snapshot());
