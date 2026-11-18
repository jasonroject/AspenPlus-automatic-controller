const task=await taskSpace(2),page=task.page('p1');
await page.goto('http://127.0.0.1:8766/docs.html#models');await page.cdp('Page.reload',{ignoreCache:true});await page.snapshot();
console.log('fresh assets',await page.evaluate(async()=>({ready:document.readyState,css:[...document.styleSheets].map(s=>({href:s.href,rules:s.cssRules.length,last:[...s.cssRules].slice(-2).map(r=>r.cssText)})),asset:(await (await fetch('docs.mjs',{cache:'no-store'})).text()).includes('复制')})));
for(const width of [1440,390]){
  await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width===390});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  console.log('docs controls refreshed',await page.evaluate(()=>({width:innerWidth,controls:[...document.querySelectorAll('.copy-button')].map(el=>({text:el.textContent,aria:el.getAttribute('aria-label'),height:el.getBoundingClientRect().height}))})));
}
console.log(await page.snapshot());
