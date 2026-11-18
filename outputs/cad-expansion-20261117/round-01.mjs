const entry=(await listTaskSpaces()).find(s=>s.id===10);
const task=!entry?await taskSpace('CAD functional expansion 20261117'):entry.ownership==='user'?await claimTaskSpace(10):entry.ownership==='agentDelegatedToUser'?await takeOverTaskSpace(10):await taskSpace(10);
const pages=await task.pages();const page=pages[0]??await task.adopt((await task.tabs())[0].page);
console.log({spaceId:task.spaceId,page:page.label,tabs:await task.tabs()});
const gemini=await task.newPage();
await gemini.goto('https://gemini.google.com/app/ef99eb212e2e4aee');
console.log({gemini:gemini.label});
console.log(await gemini.snapshot());
