const task=await taskSpace(2),page=task.page('p1');
console.log({url:await page.url(),title:await page.title()});
console.log(await page.snapshot());
console.log('basis',await page.evaluate(()=>({entry:document.querySelector('#reference-context')?.textContent,pair:document.querySelector('#pair-context')?.textContent,native:document.querySelector('#native-match')?.textContent,basis:document.querySelector('#accounting-basis-body')?.textContent})));
