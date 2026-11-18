const task=await taskSpace(2),page=task.page('p2');
await page.fill('textarea[placeholder="Start typing a prompt to see what our models can do"]',"继续审一个真实的新结果页。无需新增算法或功能，只给科学软件的层级/文案建议。我们已做黑白界面、中英切换：\n导入 process_surrogate_bundle / process_surrogate_predictions / process_robustness JSON 后显示摘要卡、输入覆盖/预测对照/波动范围/排名范围图，下方保留每条查询及失败记录。\n通用鲁棒性当前是9候选×9共享确定性参数偏移（共81个查询），可选3种偏好权重。不定义分布，不称概率。输出每候选的 min/nominal/max、相对跨度、各共享情景下名次范围和并列首位份额，Spearman相对名义排序。只要任一查询不支持就不输出完整全局排序。真实原生模拟训练集、留出集、独立复核集提前冻结；误差达标只是预测校验，不是工况性能达标。JSON自报来源/哈希不等于认证原生执行。\n请用最多12行中英对照表：给新手最重要的6个标签/辅助解释（英文短一点）+3个应避免的误导词+3条信息层级建议。不要建议把确定性情景占比称概率，不要暗示经过物理/实验验证。");
await page.press('textarea[placeholder="Start typing a prompt to see what our models can do"]','Control+Enter');
console.log('Submitted bounded UX review prompt.');

