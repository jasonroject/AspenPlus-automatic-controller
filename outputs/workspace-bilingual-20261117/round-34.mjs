const task=await taskSpace(2),page=task.page('p1');
console.log(await page.evaluate(()=>({sheets:[...document.querySelector('#sheet').options].map(x=>({value:x.value,text:x.text})),mapping:[...document.querySelectorAll('#mapping-body tr')].map(x=>x.innerText),type:document.querySelector('#table-type').value})));
await page.focus('#apply-table');await page.press('#apply-table','Enter');
for(let i=0;i<4;i++){
  await page.focus('#worksheet-next');await page.press('#worksheet-next','Enter');
  console.log('worksheet',await page.evaluate(()=>({sheet:document.querySelector('#sheet').selectedOptions[0].textContent,type:document.querySelector('#table-type').value,mapped:[...document.querySelectorAll('#mapping-body select')].filter(x=>x.value!=='-1').length})));
  await page.focus('#apply-table');await page.press('#apply-table','Enter');
}
console.log('applied',await page.evaluate(()=>({progress:document.querySelector('#workflow-description').innerText,counts:document.querySelector('#table-counts').innerText})));
await page.click('#import-next');
console.log(await page.snapshot());
