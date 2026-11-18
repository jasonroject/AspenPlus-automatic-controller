const task = await taskSpace(9);
const page = task.page('p1');
await page.keyboard.down('Control');
await page.mouse.click(616,400,{label:'测试三维多选反馈'});
await page.keyboard.up('Control');
console.log(await page.evaluate(()=>({selected:[...document.querySelectorAll('.object-select[aria-pressed="true"]')].map(x=>x.textContent),viewport:{width:innerWidth,height:innerHeight}})));
await page.click('loc=role:button[name="打开布尔运算菜单"]');
console.log(await page.snapshot());
console.log(await task.page('p2').snapshot({scope:'full_page'}));
