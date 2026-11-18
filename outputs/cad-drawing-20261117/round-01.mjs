const entry=(await listTaskSpaces()).find(s=>s.id===10);
const task=!entry?await taskSpace('CAD 绘制交互测试'):entry.ownership==='user'?await claimTaskSpace(10):entry.ownership==='agentDelegatedToUser'?await takeOverTaskSpace(10):await taskSpace(10);
const tabs=await task.tabs();
const found=tabs.find(t=>t.url.includes('localhost:5180/ExtrudeCAD_Studio.html'));
const page=found?(found.label?task.page(found.label):await task.adopt(found.page)):(await task.pages())[0]??await task.newPage();
if(!found)await page.goto('http://localhost:5180/ExtrudeCAD_Studio.html');
console.log({space:task.spaceId,page:page.label,tabs:await task.tabs()});
console.log(await page.snapshot());
