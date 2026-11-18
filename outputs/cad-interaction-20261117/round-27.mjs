const {base,fs,assert,open,save,graph}=await import('./helpers.mjs');const p=(await taskSpace(1)).page('p1');
const original=JSON.parse(await fs.readFile(base+'user-project-before.extrudecad.json','utf8')).shapes;
await open(p,'user-project-before',original.length);await p.reload();await p.waitForSelector('loc=role:button[name="绘制点线"]');await p.click('.view-switch button >> nth=1');await p.click('loc=role:button[name="适合二维视图"]');
const restored=await save(p,'user-project-after');assert.deepEqual(restored,original);graph(restored);
const served=await p.fetch('/ExtrudeCAD_Studio.html');assert.equal(served.body,await fs.readFile('C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/extrudecad-web/deliverables/ExtrudeCAD_Studio.html','utf8'));
await p.screenshot({path:base+'final-user-workspace.png'});await fs.writeFile(base+'checks-final.json',JSON.stringify({userShapesRestored:restored.length,allFieldsEqual:true,graphValid:true,servedArtifactMatches:true},null,2));console.log({restored:restored.length,fields:'exact match',artifact:'served final HTML matches'});
