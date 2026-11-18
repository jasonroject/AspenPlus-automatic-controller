const task=await taskSpace(2),page=task.page('p2');
await page.snapshot();
await page.fill('loc=css:textarea[placeholder="Start typing a prompt to see what our models can do"]',`请继续担任科学软件UX writer，只审新手流程和中英文微文案，不新增计算功能。我们新增Local Aspen models子页面，三步：
1 Review model / 检查模型。上传JSON profile，包含模型hash、两独立输入、原生units/ranges、linked heater温度、fixed积分controls、输出/LCA映射。只有结构核查完成可下一步。缺失仍有明确review错误。旁边提供一次性的本地read-only discovery CLI，在licensed Windows Aspen上打开副本，无Run。普通用户可加载已有HTL profile。
2 Plan a scan / 规划扫描。输入下限/上限/点数，用原生K和m单位；每次预览网格，不直接运行Aspen。可选择仅verification或固定training+holdout；更改输入立刻作废旧计划。100点上限。已reviewed固定/关联控制不作为独立维度。用户确认review后下载profile+plan。
3 Run & analyze / 运行与分析。复制本地CLI用隔离副本串行运行，保存所有失败和源文件hash。将combined project.json导入网站，进入已有能量/LCA/模糊比较。五类检查分别显示：控制回读、原生求解、数值闭合、LCA覆盖、指标完整。预测需额外训练+留出校验，上传bundle可查看样本覆盖/预测vs仿真，失败点保留。浏览器不运行Aspen，也不会声称仅看JSON即可认证真实运行。
已有结果文件也可以在步骤1下方直接导入，免走配置流程。页面按简洁黑白/Inter，与现有主页一致。请指出最多4个最影响第一次使用的具体断点，以及对应短文案/布局修正（中英）。尤其避免“verified”夸张称呼，减少命令步骤恐惧，但不能暗示自动读懂任意模型。限600字，别写泛泛设计原则。`);
await page.click('@39',{label:'Review first-time native-model workflow copy'});
console.log(await page.snapshot());
