const task=await taskSpace(13);const page=task.page('p1');const base='C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/cad-drawing-20261117/';
const cp=page.waitForFileChooser({timeout:10000});await page.click('loc=role:menuitem[name*="打开工程"]');await(await cp).setFiles(base+'empty.extrudecad.json');
await page.setInputFiles('loc=css:input[aria-label="选择 DXF 文件"]',[base+'browser-reference.dxf']);console.log(await page.snapshot());
