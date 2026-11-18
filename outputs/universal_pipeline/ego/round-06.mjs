const task=await taskSpace(2);const page=task.page("p1");
await page.click("#rank");console.log({ranking:await page.evaluate(()=>document.querySelector("#rank-results").innerText)});
const wait=page.waitForEvent("download",{timeout:30000});await page.click("#export-results");await(await wait).saveAs("C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/universal_pipeline/generic-result.json");
await page.click('[data-tab="import"]');await page.setInputFiles("#files",["C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/universal_pipeline/generic-import.xlsx"]);
await page.waitForSelector("#mapping-panel:not([hidden])");console.log(await page.snapshot({scope:"full_page"}));
