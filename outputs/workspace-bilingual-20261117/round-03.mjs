const task=await taskSpace(2),page=task.page('p1');
await page.click('#calculate',{label:'Calculate imported Aspen data'});
await page.waitForSelector('#tab-results:not([hidden])');
console.log(await page.snapshot({scope:'full_page'}));
await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/before-native-results.png'});
