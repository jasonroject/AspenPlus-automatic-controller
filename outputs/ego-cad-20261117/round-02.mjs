const task = await taskSpace('CAD workspace optimization 20261117');
const page = task.page('p1');
console.log({spaceId:task.spaceId,tabs:await task.tabs()});
await page.goto('http://localhost:5173');
console.log(await page.snapshot());
