const task=await taskSpace(10);const page=task.page('p1');
await page.click('loc=css:[data-testid="boolean-preview-cancel"]');
await page.click('loc=role:link[name="ExtrudeCAD 工作台"]');
await page.click('loc=role:button[name="重置三维相机视角"]');
await page.cdp('Emulation.clearDeviceMetricsOverride');
await page.waitForFunction(()=>document.querySelector('.save-state')?.textContent==='已自动保存');
console.log(await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/ego-cad-20261117/final-workspace.png'}));
console.log(await page.evaluate(()=>({layout:document.querySelector('.viewport-grid')?.className,objects:document.querySelectorAll('.object-row').length,hidden:document.querySelectorAll('.object-row.is-hidden').length,width:document.querySelector('.inspector input[aria-label="宽度 X"]')?.value,save:document.querySelector('.save-state')?.textContent})));
