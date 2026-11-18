const task=await taskSpace(10);const gem=task.page('p3');console.log(await gem.snapshot());
const ref=task.page('p2');await ref.goto('https://help.autodesk.com/view/ACD/2023/ENU/?guid=GUID-BF4A06D8-2D66-427D-9460-B62A479B22B4');
