const task = await taskSpace(2), page = task.page('p1');
await page.setInputFiles('#files', ['C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/analysis_web/data/universal-htl.json']);
await page.waitForSelector('#tab-context:not([hidden])');
console.log(await page.snapshot({scope:'full_page'}));
