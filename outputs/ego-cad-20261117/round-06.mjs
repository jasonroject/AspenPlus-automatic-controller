const task = await taskSpace(9);
const page=task.page('p1');
console.log(await page.snapshot({scope:'subtree',root:'loc=role:region[name="CAD绘图工具栏"]'}));
