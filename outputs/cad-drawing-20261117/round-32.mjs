const page=(await taskSpace(13)).page('p1');const fs=await import('node:fs/promises');const assert=(await import('node:assert/strict')).default;const base='C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/cad-drawing-20261117/';
await page.reload();await page.waitForSelector('loc=role:button[name="绘制点线"]');await page.cdp('Emulation.setDeviceMetricsOverride',{width:1130,height:750,deviceScaleFactor:1,mobile:false});
await page.click('loc=css:.view-switch button >> nth=1');
const count=()=>page.evaluate(()=>document.querySelectorAll('.object-select').length);
const enter=async text=>{await page.fill('loc=role:textbox[name="绘图命令输入"]',text);await page.keyboard.press('Enter')};
const line=async()=>{await page.focus('loc=css:[data-testid="cad-2d-canvas"]');await page.keyboard.press('l');await page.keyboard.press('Enter');assert.ok(await page.evaluate(()=>!!document.querySelector('[data-testid="exact-size-input-bar"]')))};
assert.equal(await count(),0);await line();await enter('0,0');assert.equal(await count(),1);await page.keyboard.press('Escape');assert.equal(await count(),1);
await line();await enter('0,0');assert.equal(await count(),1);await enter('30,0');assert.equal(await count(),3);await enter('u');assert.equal(await count(),1);await enter('u');assert.equal(await count(),1);
await enter('10,10');assert.equal(await count(),2);await enter('u');assert.equal(await count(),1);await page.keyboard.press('Escape');
await line();await enter('0,0');await enter('30,0');await enter('30,40');assert.equal(await count(),5);await enter('c');assert.equal(await count(),6);
assert.equal(await page.evaluate(()=>!!document.querySelector('[data-testid="exact-size-input-bar"]')),false);
const dp=page.waitForEvent('download',{timeout:30000});await page.click('loc=css:.header-actions button[title="下载可继续编辑的工程文件"]');await(await dp).saveAs(base+'linked-triangle.extrudecad.json');
const shapes=JSON.parse(await fs.readFile(base+'linked-triangle.extrudecad.json','utf8')).shapes;const points=shapes.filter(s=>s.type==='point');const segments=shapes.filter(s=>s.type==='segment');assert.equal(points.length,3);assert.equal(segments.length,3);
assert.deepEqual(points.map(p=>p.points[0]),[{x:0,y:0},{x:30,y:0},{x:30,y:40}]);for(const s of segments){assert.equal(s.endpointIds.length,2);assert.deepEqual(s.points,s.endpointIds.map(id=>points.find(p=>p.id===id).points[0]))}
assert.equal(segments.at(-1).endpointIds[1],points[0].id);
await page.screenshot({path:base+'linked-triangle.png'});await fs.writeFile(base+'checks-linked-drawing.json',JSON.stringify({lEnterWaitsForPoint:true,firstPointPersistsOnEscape:true,reusesExistingPoint:true,pointAndLineAtomicUndo:true,undoReusedAnchorPreservesPoint:true,undoNewFirstPoint:true,closeReusesFirstNode:true,points:3,segments:3},null,2));console.log({checks:'linked drawing passed'});console.log(await page.evaluate(()=>[...document.querySelectorAll('.object-select')].map(b=>b.title)));
