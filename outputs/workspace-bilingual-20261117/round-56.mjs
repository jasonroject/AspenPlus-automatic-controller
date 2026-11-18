const task=await taskSpace(2),page=task.page('p4');
await page.click('[aria-label="选择设备"] [data-equipment="separator"]');
console.log('separator zh',await page.evaluate(()=>({active:[...document.querySelectorAll('[data-equipment]')].filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.dataset.equipment),hash:location.hash})));
await page.click('button[aria-label="Switch to English"]');
await page.snapshot();
console.log('archive en',await page.evaluate(()=>({url:location.href,lang:document.documentElement.lang,active:[...document.querySelectorAll('[data-equipment]')].filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.dataset.equipment)})));
await page.click('[aria-label="Select equipment"] [data-equipment="pump"]');
await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/archive-equipment-en.png'});
const ai=task.page('p2');console.log(await ai.snapshot());
