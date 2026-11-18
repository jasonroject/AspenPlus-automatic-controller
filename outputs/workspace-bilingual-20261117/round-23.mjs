const task=await taskSpace(2),page=task.page('p2');
await page.fill('loc=css:textarea[placeholder="Start typing a prompt to see what our models can do"]',`请先纠正上一轮的三点：
1. kW/(kg/h)=kWh/kg，网页和文档实际标注就是kWh/kg，所以这个反例没有量纲错误。可以建议给输出添加机器可读单位，但不能乘3.6后仍按kWh/kg。
2. rank使用明确声明的[0,1]饱和偏好函数和固定名义锚点，并非对原始物理指标做线性外推。支持区间应是此同一评分函数在输入支持域上的范围。请在此定义下重新判断截断是否真是bug，不能擅自改成另一套评分。
3. product先通过triangle()验证、再除以确定性feed，已保证顺序；不要只看yield最后一行推断未验证。孤立热媒循环也可能是真实闭合公用工程，应先提示拓扑而不是一概判失败。

本轮只回答以下统计方案，限600中文字，避免复述产品背景：
266候选×1024共同情景，独立均匀输入，固定名义min/max评分，等权，原生验证集完全留出。新增每候选的std/mean(CV)、(P95-P05)/P50；每个抽样情景的名义vs扰动排名Spearman；前缀128/256/512/1024第一名频率变化。哪些定义或tie处理必须写清？哪些结论不能据此声称？如何用独立简单例子检查正确性？
另外网页将明确：原生复核点、预测点、三角可能性区间、输入扰动分位范围是四类不同证据；暂不添加GP后验置信带。请用专业精确的回答，不要把理论上的额外功能说成当前代码bug。`);
await page.click('@39',{label:'Refine statistical method review'});
console.log(await page.snapshot());
