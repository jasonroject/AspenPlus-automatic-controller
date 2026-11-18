const task=await taskSpace(2),page=task.page('p1');
await page.goto('http://127.0.0.1:8766/universal.html');
await page.setInputFiles('#files',['C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/analysis_web/data/universal-htl.json']);
await page.waitForSelector('#tab-context:not([hidden])');
await page.click('#calculate',{label:'Check native data workflow'});
await page.waitForSelector('#result-visuals button');
console.log(await page.snapshot({scope:'full_page'}));
