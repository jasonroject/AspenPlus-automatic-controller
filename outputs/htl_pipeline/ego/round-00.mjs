const entry=(await listTaskSpaces()).find(s=>s.id===2);
const task=!entry?await taskSpace("HTL prediction and robustness"):entry.ownership==="user"?await claimTaskSpace(2):entry.ownership==="agentDelegatedToUser"?await takeOverTaskSpace(2):await taskSpace(2);
const page=(await task.pages())[0]??await task.adopt((await task.tabs())[0].page);
console.log({spaceId:task.spaceId,page:page.label});
await page.goto("http://127.0.0.1:8766/pipeline.html");
console.log(await page.snapshot({scope:"full_page"}));
