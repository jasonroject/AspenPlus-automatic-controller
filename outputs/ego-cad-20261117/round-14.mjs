const task=await taskSpace(10);const page=task.page('p1');
const checks=[];
async function check(label,count){const selected=await page.evaluate(()=>[...document.querySelectorAll('.object-select[aria-pressed="true"]')].map(x=>x.textContent));checks.push({label,selected});if(selected.length!==count)throw Error(label+': '+JSON.stringify(selected));}
await page.keyboard.down('Control');await page.mouse.click(663,400,{label:'验证三维追加选择'});await page.keyboard.up('Control');await check('Ctrl append sleeve',2);
await page.keyboard.down('Shift');await page.mouse.click(714,500,{label:'验证 Shift 多选'});await page.keyboard.up('Shift');await check('Shift append hex cap',3);
console.log(await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/ego-cad-20261117/multiselect.png'}));
await page.keyboard.down('Control');await page.mouse.click(663,400,{label:'验证再次点击取消'});await page.keyboard.up('Control');await check('Ctrl toggle sleeve off',2);
await page.keyboard.down('Control');await page.mouse.click(340,180,{label:'验证空白保留多选'});await page.keyboard.up('Control');await check('Ctrl blank preserves selection',2);
await page.mouse.click(340,180,{label:'验证空白清除选择'});await check('Blank clears selection',0);
await page.click('loc=css:.object-select[title="圆角底板"]');
await page.click('loc=role:button[name="打开布尔运算菜单"]');
await page.click('loc=css:[data-testid="boolean-op-union"]');
const preview=await page.evaluate(()=>({layout:document.querySelector('.viewport-grid')?.className,panel:!!document.querySelector('#cad-command-panel'),status:[...document.querySelectorAll('[role="status"]')].map(x=>x.textContent),count:document.querySelectorAll('.object-row').length}));
checks.push({label:'Visible uncommitted preview',...preview});if(!preview.layout.includes('2d-only')||preview.panel||preview.count!==6)throw Error('Preview failed');
console.log(checks);
console.log(await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/ego-cad-20261117/preview-after.png'}));
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/ego-cad-20261117/checks-selection.json',JSON.stringify(checks,null,2));
