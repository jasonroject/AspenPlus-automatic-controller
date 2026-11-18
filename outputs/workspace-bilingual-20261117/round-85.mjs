const task=await taskSpace(2),page=task.page('p1');
await page.click('.sidebar a[href="universal.html"]');await page.waitForSelector('[data-language="en"]');
console.log('return restored',await page.evaluate(()=>({selected:document.querySelector('#result-case').value,summary:document.querySelector('#results-summary').textContent})));
await page.click('.sidebar a[href="models.html"]');await page.waitForSelector('#example-profile');
await page.click('#example-profile');
await page.waitForFunction(()=>!document.querySelector('.model-steps [data-step="2"]').disabled,undefined,{timeout:10000});
await page.click('.model-steps [data-step="2"]');
const inputs=await page.evaluate(()=>{
  const rows=[];
  for(const element of document.querySelectorAll('[data-variable]')){
    rows.push({variable:element.dataset.variable,fields:[...element.querySelectorAll('input')].map(input=>({setting:input.dataset.setting,value:input.value}))});
  }
  return rows;
});console.log('planning inputs',inputs);
await page.selectOption('#split-mode','frozen');await page.click('#generate-plan');
console.log('plan result',await page.evaluate(()=>document.querySelector('#plan-preview').textContent));
console.log(await page.snapshot());
