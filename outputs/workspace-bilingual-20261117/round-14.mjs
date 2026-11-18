const task=await taskSpace(2),page=task.page('p2');
console.log({url:await page.url(),title:await page.title()});
console.log(await page.snapshot({scope:'full_page'}));
