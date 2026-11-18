const entry = (await listTaskSpaces()).find(s => s.id === 2);
const task = !entry ? await taskSpace('HTL Studio workflow audit') : entry.ownership === 'user' ? await claimTaskSpace(2) : entry.ownership === 'agentDelegatedToUser' ? await takeOverTaskSpace(2) : await taskSpace(2);
const tabs = await task.tabs();
const result = tabs.find(t => /vercel-pi-ten-59\.vercel\.app|127\.0\.0\.1:8766/.test(t.url));
const page = (await task.pages())[0] ?? await task.adopt((result ?? tabs[0]).page);
console.log({spaceId:task.spaceId,page:page.label,tabs});
await page.goto('https://vercel-pi-ten-59.vercel.app/universal.html');
console.log({title:await page.title(),url:await page.url()});
console.log(await page.snapshot());
