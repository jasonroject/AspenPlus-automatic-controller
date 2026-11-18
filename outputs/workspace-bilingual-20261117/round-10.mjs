const task=await taskSpace(2),page=task.page('p2');
await page.fill('@34', `请作为资深科学软件 UX writer，帮我改写 Process Studio 网站上的中英文界面文案。用户喜欢简洁的 OpenAI 风格首页，现在主要优化分析工作区。只处理文案，不生成代码，不修改计算方法。请用清晰自然、专业但容易理解的文字，避免口号和过度拟人化；按钮用明确动词，说明告诉首次用户下一步做什么。中文不要生硬翻译，英文不要堆术语。

产品实际能力与边界（不可改变）：浏览器本地导入 Aspen 导出的 CSV/Excel/JSON；五表为物流、设备、工况/产品、环境清单、影响因子。先映射，再确认单位、系统边界、1 kg 产品功能单位和分配，再算稳态质量/能量衡算、已提供因子的环境影响。缺数据不能视为0，衡算闭合不是物理验证。三角模糊输入给出 alpha-cut 可能性支持区间，不是置信区间。已算结果可导出。切换语言不会改变输入；工作内容保留在当前标签页，下载项目文件才是长期副本。

独立 HTL 预测模块：已有原生 Aspen 样本的冻结 GP 模型，浏览器读取预计算网格；不调用 Aspen，不用新导入数据重新训练。同源、未修改原生导出可以带着参考工况进入。显示原生点和预测线、STD/HR 对照、碳足迹贡献。鲁棒性使用1024组给定扰动情景比较266候选的能耗、碳足迹、产率波动及排名稳定性，不设达标门槛，不等于真实工厂可靠性。当前环境模型是固定背景的气候影响计算，不能承诺完整多类别 LCA。

请针对下列现有文案逐项给出 old_en / new_en / zh 三列表（约30项，优先短文案；长提示1-2句），然后给出5条具体文案原则：
1 Your analysis, connected.
2 Start with your data. Follow a clear path to energy and impact.
3 Import your data / Choose, map and review tables
4 Check your basis / Units, boundaries and factors
5 Explore the results / Energy, impacts and comparison
6 Bring your export.
7 Choose CSV, Excel or a saved JSON project. English and Chinese headers are supported.
8 Try it with an example.
9 Try the worked example
10 Load the verified HTL example
11 Review the suggested mapping.
12 Apply reviewed mapping
13 Five tables. One connected model.
14 A quick project check.
15 Calculation basis.
16 Inventory & factor coverage.
17 Calculate balances & impacts
18 Your results, at a glance.
19 Balance check / Closed
20 Purchased energy
21 Target / feed yield
22 See what the numbers mean.
23 What drives the impact?
24 How wide are the input supports?
25 Equipment energy / Across cases
26 Explore the trade-offs.
27 From this case to operating variation.
28 Continue to HTL prediction
29 Prediction & Robustness
30 Show prediction
31 Explore operating variation
32 Candidate ranking stability
33 Native observations and prediction
34 Retained in this tab. Download a copy to keep it.

特别说明：如果某个旧文案会让用户误以为已完成物理验证或自动全范围 LCA，请温和纠正。保留 STD、HR、Aspen、LCA、alpha 等必要术语但中文解释。不要说“已验证全部模型”“一键任意Aspen预测”。`);
await page.click('@39',{label:'Request bilingual website copy review'});
console.log(await page.snapshot());
