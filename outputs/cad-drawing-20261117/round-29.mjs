const page=(await taskSpace(13)).page('p1');const base='C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/cad-drawing-20261117/';
await page.setInputFiles('loc=css:input[aria-label="选择 DXF 文件"]',[base+'browser-reference.dxf']);await page.waitForSelector('loc=role:dialog[name="导入 DXF 图元"]');console.log(await page.snapshot());
