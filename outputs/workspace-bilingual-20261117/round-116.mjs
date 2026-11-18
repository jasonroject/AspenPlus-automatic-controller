const task=await taskSpace(2),page=task.page('p9');
const value=await page.evaluate(()=>document.querySelector('#result-case option:last-child').value);await page.selectOption('#result-case',value);
console.log('later selected case absent from fixed first-20 chart',await page.evaluate(()=>({selected:document.querySelector('#result-case').value,selectedBars:document.querySelectorAll('.rv-comparison-grid .rv-bar-row.is-selected').length,firstColumnRows:[...document.querySelectorAll('.rv-comparison-grid .rv-chart-card:first-child .rv-bar-label>span')].map(n=>n.textContent),note:document.querySelector('#visual-section').textContent.includes('20')})));
console.log(await page.snapshot());
