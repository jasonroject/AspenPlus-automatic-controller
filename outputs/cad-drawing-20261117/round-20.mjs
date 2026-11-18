const task=await taskSpace(10);const page=task.page('p2');await page.goto('https://help.autodesk.com/view/ACD/2025/CHS/?guid=GUID-3F5861A1-9A63-42A6-8F12-3395771BAA6D');
const cad=task.page('p1');await cad.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
await cad.click('loc=role:button[name="绘制直线墙"]');
console.log(await cad.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,command:(()=>{const e=document.querySelector('[data-testid="exact-size-input-bar"]');const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,text:e.textContent}})(),input:(()=>{const e=document.querySelector('[data-testid="exact-size-input"]');const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()})));
await cad.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/cad-drawing-20261117/narrow-command.png'});
