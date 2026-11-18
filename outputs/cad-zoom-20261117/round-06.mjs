const p=(await taskSpace(1)).page('p1');
console.log(await p.evaluate(()=>({zoom:document.querySelector('[aria-label="二维缩放百分比"]')?.value,buttons:[...document.querySelectorAll('.view-zoom-controls button')].map(e=>({name:e.getAttribute('aria-label'),disabled:e.disabled})),width:innerWidth,dpr:devicePixelRatio,lists:[...document.querySelectorAll('.model-sidebar *')].filter(e=>e.scrollHeight>e.clientHeight+10&&getComputedStyle(e).overflowY==='auto').map(e=>({class:e.className,top:e.scrollTop,height:e.clientHeight,scroll:e.scrollHeight}))})));
await p.click('loc=role:button[name="缩小二维视图"]');
await p.waitForFunction(()=>document.querySelector('[aria-label="二维缩放百分比"]').value!=='100',undefined,{timeout:5000});
console.log(await p.evaluate(()=>({zoom:document.querySelector('[aria-label="二维缩放百分比"]').value})));
