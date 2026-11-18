const task=await taskSpace(10);const page=task.page('p1');const dir='C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/cad-expansion-20261117/';
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
await page.mouse.move(280,768);await page.mouse.wheel(450,0,{label:'横向滚动建模工具栏'});console.log(await page.evaluate(()=>{const x=document.querySelector('[role="toolbar"][aria-label="建模工具"]');return{scrollLeft:x.scrollLeft,clientWidth:x.clientWidth,scrollWidth:x.scrollWidth}}));
await page.click('loc=role:button[name="添加基础几何体"]');await page.waitForSelector('loc=css:#cad-command-panel');
console.log(await page.evaluate(()=>{const r=document.querySelector('#cad-command-panel').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,overflow:document.documentElement.scrollWidth>innerWidth}}));await page.screenshot({path:dir+'layout-390-create.png'});await page.click('loc=role:button[name="收起编辑面板"]');
await page.click('loc=role:button[name="打开文件菜单"]');await page.screenshot({path:dir+'layout-390-file-menu.png'});await page.keyboard.press('Escape');
await page.setInputFiles('loc=css:input[aria-label="选择 DXF 文件"]',[dir+'fixture-inch.dxf']);await page.waitForSelector('loc=role:dialog[name="导入 DXF 轮廓"]');await page.screenshot({path:dir+'layout-390-dxf.png'});await page.keyboard.press('Escape');
