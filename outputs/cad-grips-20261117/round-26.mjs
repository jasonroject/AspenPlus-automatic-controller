import {setup,xy,save,assert,base,fs,undo,toggle,drag,graph} from './helpers.mjs';
const p=(await taskSpace(1)).page('p1');await setup(p);
await toggle(p,'切换网格吸附',false);await toggle(p,'切换智能对齐参考线',false);await toggle(p,'切换对象捕捉',false);
const checks=[];const ok=s=>{checks.push(s);console.log('PASS '+s);};
const click=async(x,y)=>{const a=await xy(p,x,y);await p.mouse.click(a.x,a.y);};
const move=async(x,y)=>{const a=await xy(p,x,y);await p.mouse.move(a.x,a.y);};
const select=async(name)=>{await p.click('.object-select[title="'+name+'"]');};
const activate=async(name,x,y)=>{await select(name);await click(x,y);await p.waitForSelector('[data-testid="grip-edit-bar"]');};
const input=async(v)=>{await p.fill('[aria-label="夹点命令输入"]',v);await p.keyboard.press('Enter');};
const idle=()=>p.waitForFunction(()=>!document.querySelector('[data-testid="grip-edit-bar"]'),undefined,{timeout:3000});
const baseline=await save(p,'core-baseline');
await activate('AB',0,0);await move(20,15);
assert.deepEqual(await save(p,'core-preview-save'),baseline);await idle();ok('保存取消夹点预览，文件保留原几何');
await activate('AB',0,0);await move(20,15);await p.keyboard.press('Escape');await idle();
assert.equal(await p.evaluate(()=>document.querySelector('.object-row.is-selected .object-select')?.getAttribute('title')),'AB');ok('Esc取消预览并保留直线选择');
await activate('AB',0,0);
for(const label of ['移动 Move','旋转 Rotate','缩放 Scale','镜像 Mirror','拉伸 Stretch']){
 await p.keyboard.press('Enter');await p.waitForFunction(label=>document.querySelector('[data-testid="grip-edit-bar"] strong')?.textContent.includes(label),label,{timeout:3000});
}ok('空回车顺序循环五种夹点模式');
await input('@10,20');await idle();let result=await save(p,'core-stretch');graph(result);
assert.deepEqual(result.find(s=>s.id==='B').points[0],{x:10,y:20});ok('夹点精确拉伸带动两条相连直线');
await undo(p);assert.deepEqual(await save(p,'core-stretch-undo'),baseline);ok('夹点提交一次，全局撤销恢复完整图');
await activate('AB',-25,0);assert.ok(await p.evaluate(()=>document.querySelector('[data-testid="grip-edit-bar"] strong').textContent.includes('Move')));
await input('@0,10');result=await save(p,'core-midpoint');assert.deepEqual(result.find(s=>s.id==='A').points[0],{x:-50,y:10});assert.deepEqual(result.find(s=>s.id==='B').points[0],{x:0,y:10});graph(result);ok('中点默认整体移动，邻边随节点变化');
await undo(p);
for(const [label,value,expected] of [['旋转 Rotate','90',{x:0,y:-50}],['缩放 Scale','2',{x:-100,y:0}],['镜像 Mirror','90',{x:50,y:0}]]){
 await activate('AB',0,0);await p.click('[aria-label="夹点'+label+'"]');await input(value);await idle();result=await save(p,'core-'+label.split(' ')[1]);
 const a=result.find(s=>s.id==='A').points[0];assert.ok(Math.abs(a.x-expected.x)<1e-8&&Math.abs(a.y-expected.y)<1e-8);graph(result);
 await undo(p);assert.deepEqual(await save(p,'core-'+label.split(' ')[1]+'-undo'),baseline);ok(label+'精确输入及单步撤销');
}
await activate('AB',0,0);await move(15,20);await p.keyboard.press('Control+z');await idle();assert.deepEqual(await save(p,'core-preview-undo'),baseline);ok('预览中的Ctrl+Z仅取消当前夹点');
await select('AB');await drag(p,[0,0],[20,10]);await idle();result=await save(p,'core-direct-drag');assert.deepEqual(result.find(s=>s.id==='B').points[0],{x:20,y:10});graph(result);await undo(p);assert.deepEqual(await save(p,'core-direct-undo'),baseline);ok('按住直接拖拽仍可联动且一次撤销');
await fs.writeFile(base+'checks-grip-core.json',JSON.stringify(checks,null,2));console.log(await p.evaluate(()=>({objects:document.querySelectorAll('.object-select').length,grip:!!document.querySelector('[data-testid="grip-edit-bar"]')})));
