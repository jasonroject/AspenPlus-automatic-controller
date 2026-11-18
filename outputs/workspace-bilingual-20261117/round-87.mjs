const task=await taskSpace(2),page=task.page('p1');
await page.click('.pipeline-tabs [data-tab="import"]');
await page.click('.table-chip[data-edit-table="cases"]');
const before=await page.evaluate(()=>{const p=JSON.parse(document.querySelector('#project-json').value);return {product:p.cases[0].product_rate,evidence:p.meta.evidence_type,audit:p.meta.scan_audit?.accepted};});
await page.fill('#data-editor [data-field="product_rate"]','2.8');
const after=await page.evaluate(()=>{const p=JSON.parse(document.querySelector('#project-json').value);return {product:p.cases[0].product_rate,evidence:p.meta.evidence_type,audit:p.meta.scan_audit?.accepted,changed:p.meta.locally_modified};});
console.log('source metadata after real edit',{before,after});
console.log(await page.snapshot());
