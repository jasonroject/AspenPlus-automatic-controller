const task=await taskSpace(10);const page=task.page('p1');const dir='C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/cad-expansion-20261117/';const checks=[];
for(const [w,h] of [[1000,650],[768,700],[390,844]]){
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});await page.click('loc=role:button[name="添加基础几何体"]');
 await page.waitForSelector('loc=css:#cad-command-panel');
 const box=await page.evaluate(()=>{const r=document.querySelector('#cad-command-panel').getBoundingClientRect();const c=document.querySelector('.viewport-grid').getBoundingClientRect();return {width:innerWidth,panel:{x:r.x,y:r.y,w:r.width,h:r.height},canvas:{x:c.x,w:c.width},overflow:document.documentElement.scrollWidth>innerWidth,header:[...document.querySelectorAll('.brand,.view-switch,.header-actions')].map(x=>({class:x.className,left:x.getBoundingClientRect().left,right:x.getBoundingClientRect().right}))};});checks.push(box);
 await page.screenshot({path:dir+`layout-${w}-create.png`});await page.click('loc=role:button[name="收起编辑面板"]');
}
await page.click('loc=role:button[name="打开文件菜单"]');await page.screenshot({path:dir+'layout-390-file-menu.png'});await page.keyboard.press('Escape');
await page.setInputFiles('loc=css:input[aria-label="选择 DXF 文件"]',[dir+'fixture-inch.dxf']);await page.waitForSelector('loc=role:dialog[name="导入 DXF 轮廓"]');await page.screenshot({path:dir+'layout-390-dxf.png'});await page.keyboard.press('Escape');
console.log(checks);await(await import('node:fs/promises')).writeFile(dir+'checks-layout.json',JSON.stringify(checks,null,2));
