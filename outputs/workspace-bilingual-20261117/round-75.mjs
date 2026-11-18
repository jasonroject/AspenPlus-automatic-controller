const task=await taskSpace(2),page=task.page('p1'),fs=await import('node:fs/promises');
const audit=[];
for(const path of ['index.html','universal.html','models.html','pipeline.html','docs.html#models/pilot']){
  await page.goto('http://127.0.0.1:8766/'+path);await page.snapshot();
  for(const width of [1440,390]){
    await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const row=await page.evaluate(()=>{
      const visible=el=>Boolean(el.getClientRects().length)&&getComputedStyle(el).visibility!=='hidden';
      const name=el=>el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')?.split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ')||[...el.labels||[]].map(l=>l.textContent).join(' ')||el.getAttribute('title')||el.textContent?.trim()||(el.tagName==='INPUT'&&['button','submit'].includes(el.type)?el.value:'');
      const controls=[...document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea')].filter(visible);
      const unlabeled=controls.filter(el=>!name(el)).map(el=>({tag:el.tagName,type:el.type,id:el.id,outer:el.outerHTML.slice(0,260)}));
      const small=controls.filter(el=>el.tagName==='BUTTON'&&el.getBoundingClientRect().height<28).map(el=>({name:name(el),height:el.getBoundingClientRect().height}));
      return {url:location.href,width:innerWidth,client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,unlabeled,small,headings:[...document.querySelectorAll('h1')].map(el=>el.textContent),activeLanguage:document.documentElement.lang};
    });audit.push(row);
  }
}
await fs.writeFile('C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/workspace-bilingual-20261117/browser-layout-control-audit.json',JSON.stringify(audit,null,2));
console.log(audit);console.log(await page.snapshot());
