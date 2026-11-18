const task=await taskSpace(10);const page=task.page('p2');
await page.fill('loc=role:textbox[name="为 Gemini 输入提示"]','第二轮，请审核我们收敛的实现方案和风险。你上轮的四孔法兰超出了单内孔数据结构，本轮不会假装实现四个贯通孔；闭环改为100×50×10底板+两个独立圆柱定位件，测圆心距、公共中心旋转、整体平移、导出。你的“禁止Z向等比缩放”判断不适用：对XY轮廓和内孔、Z标高与高度按公共XYZ中心同比缩放仍是合法拉伸体；我们明确提供XYZ等比缩放，体积×8用无倒角模型验收。锁定采用可选可测/可隐藏但禁止几何修改删除和布尔消耗，便于查看属性；不会禁止点选。实现：精确创建box/cylinder(中心XYZ、宽深或直径、高度)、XYZ相对移动和复制、XY旋转和复制、XYZ等比缩放、XY两点测量、对象搜索/锁/隐藏其他/全部显示、CtrlK命令面板及V/R/C/L/P/M/F/CtrlD/CtrlS，完整拖动一次撤销和Esc回退。请针对这个明确方案列出最易漏掉的8个具体边界条件，以及1130×650下如何放新增控件但不挡画布。不要建议新大功能，约600字。');
await page.press('loc=role:textbox[name="为 Gemini 输入提示"]','Enter');
console.log({submitted:'Gemini round 2'});
