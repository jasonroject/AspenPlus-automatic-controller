const task=await taskSpace(10);console.log(await task.pages());
const page=task.page('p2');
await page.goto('https://gemini.google.com/app/ef99eb212e2e4aee',{timeout:60000});
console.log(await page.snapshot());
