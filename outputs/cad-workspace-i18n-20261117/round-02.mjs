const task=await taskSpace(1);const g=await task.newPage();await g.goto('https://gemini.google.com/app/3a2d25d752740980');console.log({page:g.label});console.log(await g.snapshot());
