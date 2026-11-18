const task = await taskSpace(9);
const page = task.page('p1');
await page.goto('http://localhost:5180/ExtrudeCAD_Studio.html');
console.log(await page.snapshot());
console.log(await page.screenshot({path:'C:/Users/Administrator/Documents/Codex/2026-09-16/project1jason/automatic/outputs/ego-cad-20261117/before.png'}));
const gemini = task.page('p2');
await gemini.fill('loc=role:textbox[name="为 Gemini 输入提示"]','请作为专业 CAD 产品交互设计师，帮我审阅一个中文轻量 CAD 网页工作台的优化方向。现有功能是 XY 草图沿 Z 拉伸，深炭灰界面，48px 顶栏，左侧构件树 220px，右侧属性栏 260px，中央支持草图/模型/双视图，底部悬浮绘图、布尔与阵列工具。默认显示法兰支座三维示例。请给出 5 条最值得落实的具体交互改进，重点 1366×768 和 1130×650，围绕三维多选反馈、布尔预览可见性、工具发现性与画布遮挡；不添加 AI 功能或虚构 CAD 内核能力。回答简短，列出验收标准。');
await gemini.press('loc=role:textbox[name="为 Gemini 输入提示"]','Enter');
console.log(await gemini.snapshot());
