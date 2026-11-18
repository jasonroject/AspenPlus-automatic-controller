const task = await taskSpace(9);
const page = task.page('p1');
await page.goto('http://localhost:5180');
console.log(await page.snapshot());
const gemini = await task.newPage();
await gemini.goto('https://gemini.google.com/app');
console.log({geminiPage:gemini.label});
console.log(await gemini.snapshot());
