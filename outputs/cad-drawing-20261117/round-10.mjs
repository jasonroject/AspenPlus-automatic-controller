const task=await taskSpace(10);const ref=task.page('p2');console.log(await ref.snapshot({scope:'full_page'}));
console.log(await task.page('p3').snapshot({scope:'full_page'}));
