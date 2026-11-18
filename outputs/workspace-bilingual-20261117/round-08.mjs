const task=await taskSpace(2),page=await task.newPage();
await page.goto('https://aistudio.google.com/');
console.log({page:page.label,url:await page.url(),title:await page.title()});
console.log(await page.snapshot());
