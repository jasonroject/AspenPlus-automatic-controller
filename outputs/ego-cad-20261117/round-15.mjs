const task=await taskSpace(10);const page=task.page('p1');
console.log(await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/ego-cad-20261117/selection-investigate.png'}));
console.log(await page.evaluate(()=>({selected:[...document.querySelectorAll('.object-select[aria-pressed="true"]')].map(x=>x.textContent),canvas:[...document.querySelectorAll('canvas')].map(x=>{const r=x.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}),state:document.querySelector('.viewport-grid')?.className})));
