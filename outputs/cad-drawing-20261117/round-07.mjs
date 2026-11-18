const task=await taskSpace(10);const page=task.page('p2');
await page.goto('https://www.google.com/search?q=site%3Ahelp.autodesk.com+%22About+Direct+Distance+Entry%22');
console.log(await page.evaluate(()=>[...document.querySelectorAll('a')].filter(a=>a.href.startsWith('https://help.autodesk.com/')&&a.innerText.length>10).map(a=>({text:a.innerText,url:a.href})).slice(0,8)));
const gem=await task.newPage();await gem.goto('https://gemini.google.com/app');console.log({gemini:gem.label});console.log(await gem.snapshot());
