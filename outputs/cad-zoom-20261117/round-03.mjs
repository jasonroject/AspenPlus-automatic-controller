const entry=(await listTaskSpaces()).find(s=>s.id===13);
console.log({entry});
if(!entry) throw new Error('Previous CAD task space missing');
const task=entry.ownership==='user'?await claimTaskSpace(13):entry.ownership==='agentDelegatedToUser'?await takeOverTaskSpace(13):await taskSpace(13);
const p=(await task.pages())[0]??await task.adopt((await task.tabs())[0].page);
console.log({page:p.label,tabs:await task.tabs()});
console.log(await p.snapshot());
