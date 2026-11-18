const task=await taskSpace(10);const ref=task.page('p2');
console.log(await ref.snapshot({scope:'full_page'}));
console.log(await ref.evaluate(()=>[...document.querySelectorAll('iframe')].map(x=>({src:x.src,title:x.title}))));
const page=task.page('p1');
await page.click('loc=role:button[name="打开文件菜单"]');const cp=page.waitForFileChooser({timeout:10000});await page.click('loc=role:menuitem[name*="打开工程"]');await(await cp).setFiles('C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/cad-drawing-20261117/user-project-before.extrudecad.json');
await page.click('loc=css:.view-switch button >> nth=1');await page.keyboard.press('f');
console.log({restoredObjects:await page.evaluate(()=>document.querySelectorAll('.object-select').length)});
