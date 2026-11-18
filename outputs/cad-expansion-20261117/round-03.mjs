const task=await taskSpace(10);const page=task.page('p2');
await page.fill('loc=role:textbox[name="为 Gemini 输入提示"]','继续我们的 ExtrudeCAD 工作台。上一轮已落实三维多选/同步高亮、二维布尔预览与失效检查、数值一次提交撤销、窄屏面板、离页自动保存。用户认为相比 CAD 还缺很多功能，授权两小时做多轮功能完善。请你作为 CAD 产品经理和工程师，先做第一轮功能缺口与优先级评审。实际技术边界：React/Three.js，数据结构是XY多边形+至多一个内孔+Z高度与标高，没有BRep实体内核。已支持矩形/圆/直线墙/多边形、顶点和边拖改、网格与几何吸附、框选、多选、镜像/阵列/对齐、基础截面布尔、STL/OBJ/DXF/SVG/JSON导出。本轮候选：1精确XYZ相对平移、绕公共中心XY旋转、等比缩放和复制；2XY两点测量(距离、ΔX/ΔY、角度，捕捉端点/中心)；3锁定、隐藏其他/全部显示、对象搜索；4命令搜索与快捷键；5修正一次拖动一次撤销和移出画布松手；6参数化创建圆/矩形的明确坐标和尺寸。请给出建议顺序，指出已有功能不应该重复做的地方，建议一个闭环例子和6条最重要验收标准。哪些专业CAD功能应留到真正更换内核阶段？避免列巨大功能清单，回答约700字。');
await page.press('loc=role:textbox[name="为 Gemini 输入提示"]','Enter');
console.log(await page.snapshot());
