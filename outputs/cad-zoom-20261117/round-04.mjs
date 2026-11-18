const task=await claimTaskSpace(1);
const tabs=await task.tabs();
const tab=tabs.find(t=>t.title.includes('ExtrudeCAD'));
if(!tab) throw new Error('CAD tab missing');
const p=await task.adopt(tab.page);
console.log({space:task.spaceId,page:p.label,url:await p.url()});
console.log(await p.snapshot());
