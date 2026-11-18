const task=await taskSpace(2),page=task.page('p1');
for(const path of ['docs.html#models','models.html']){
  await page.goto('http://127.0.0.1:8766/'+path);await page.snapshot();
  for(const width of [1440,390]){
    await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width===390});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    console.log('controls',await page.evaluate(()=>({url:location.href,width:innerWidth,controls:[...document.querySelectorAll('.copy-button,.model-code-block .text-button,#open-existing-results')].filter(el=>el.getClientRects().length).map(el=>({text:el.textContent,aria:el.getAttribute('aria-label'),height:el.getBoundingClientRect().height})),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth})));
  }
  await page.click('[data-language="en"]');
  console.log('English controls',await page.evaluate(()=>[...document.querySelectorAll('.copy-button,.model-code-block .text-button,#open-existing-results')].filter(el=>el.getClientRects().length).map(el=>({text:el.textContent,aria:el.getAttribute('aria-label')}))));
  await page.click('[data-language="zh"]');
}
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await page.click('#open-existing-results');
console.log(await page.snapshot());
