# Public wording consistency review — cb8ce67

只读检查；受检源文件与 cb8ce67 无差异。未运行测试、COM、浏览器或修改源码。
未发现题述六项科学/功能边界的明确互相矛盾。发现 2 处会影响实际操作的旧指南说明：

1. **P2 — v1 入口说明会让用户进入错误版本。** `analysis_web/data/generic-htl-pilot/README.md:17` 仍要求点击已不存在的 “Try the 17-case HTL pilot”。当前 `analysis_web/models.mjs:56` 改为版本选择 + “Load selected example”，且 `models.mjs:10` 默认 v2。需要先明确选择 v1，才能打开其 17 工况失败证据。
2. **P2 — 刷新清除数据的旧说明与会话恢复相反。** `analysis_web/universal-guide.html:3` 写 “local uploads disappear on reload”。当前 `analysis_web/universal.js:217`、`:223`、`:249` 会在刷新后恢复项目、工作表和草稿；`docs-content.mjs:8` 已正确说明保留。该旧指南仍由 `docs-content.mjs:47` 直接链接，可能被用户误作清除导入数据的方法。

以下范围未发现需报告的矛盾：

- 通用导入是明确五表映射后的稳态衡算、已提供清单和因子的环境影响表征，不自动理解任意 Aspen 输出。
- 原生执行在本地授权 Aspen；公开 v2 字节核对后只做冻结均值试算，其他上传模型仍走本地 CLI。
- v1 335 °C / 8.5 m 失败保留；v2 一次扩点、一次拟合，37 唯一工况/38 运行、20/3/14、fresh4 单列、旧点是开发证据均一致。
- 5% 是声明预测误差标准，不是工况性能阈值或物理验证；情景份额不是概率。
- LCA 因子来源、缺失因子不完整、无背景数据库、固定泵与 η=1、分离器/冷却排除、产物基与旧页湿进料基的区别均有说明。
- 外部模型需逐一核查节点、原生单位、范围、拓扑、产品与 LCA 映射，未承诺任意模型即导即算。

不把 README 404 作为运行阻断；不将模型声明摘要与文件字节哈希的不同验证范围当作矛盾。详细依据见同名 JSON。
