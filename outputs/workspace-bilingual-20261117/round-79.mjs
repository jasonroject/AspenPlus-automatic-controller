const task=await taskSpace(2),page=task.page('p1');
await page.goto('https://vercel-pi-ten-59.vercel.app/');
console.log({url:await page.url(),title:await page.title()});
console.log(await page.snapshot());
