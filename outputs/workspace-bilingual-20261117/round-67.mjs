const task=await taskSpace(2),page=task.page('p1');await page.goto('http://127.0.0.1:8766/universal.html');await page.snapshot();
await page.click('.pipeline-tabs [data-tab="import"]');await page.click('#load-htl');await page.snapshot();
await page.focus('#calculate');await page.press('#calculate','Enter');await page.snapshot();
console.log('universal export controls',await page.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>b.dataset.rvExport||b.textContent.includes('SVG')||b.textContent.includes('CSV')).map(b=>({text:b.textContent,attrs:[...b.attributes].map(a=>[a.name,a.value])}))));
