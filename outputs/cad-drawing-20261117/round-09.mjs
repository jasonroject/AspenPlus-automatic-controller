const task=await taskSpace(10);const gem=task.page('p3');
await gem.fill('loc=css:[contenteditable="true"][role="textbox"]','请做一次 CAD 绘图交互审查，不写代码。用户反馈一个 React/Canvas 的2.5D建模工具画线很难用，要求参考AutoCAD。已复现旧版：按下起点松开就自动造40mm直线墙；需要一直拖着鼠标，数值输入被全局快捷键拦；矩形鼠标按角点、数值按中心不一致。现计划：LINE点击起点再逐点续画，每段独立实体；Enter/Space/右键结束，Esc只取消预览保留已画段，U/CtrlZ撤本条线最近段，C闭合至少两段。矩形两角点/圆心+半径（D直径）完成后退出，Enter/Space重复最近工具。输入x,y绝对，@dx,dy相对，@长度<角度，单数沿鼠标方向。F8正交、F3对象捕捉、F9网格分离；中键/Alt左平移。点选与预览共用落点算法。模型仍以闭合面拉伸，LINE对应8mm厚墙，P工具明确是闭合多边形非AutoCAD开放PLINE。请指出这里最易遗漏的5个实际交互回归，尤其焦点、按键、撤销、捕捉，并提出具体可执行测试。简洁中文。');
await gem.keyboard.press('Enter');
const ref=task.page('p2');console.log(await ref.evaluate(()=>document.querySelector('main')?.innerText));
console.log(await gem.snapshot());
