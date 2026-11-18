# Base44 水热液化研究工作台重设计

日期：2026-11-17

- 草稿预览：https://preview-sandbox--6afbc89a38fc0e64f1beeb52.base44.app/
- 编辑页面：https://app.base44.com/apps/6afbc89a38fc0e64f1beeb52/editor/preview
- 项目名称：HTL Studio｜水热液化研究工作台
- 状态：完成首次搭建和一轮集中修正；未点击发布，未升级付费套餐。原本地前端没有被替换。

## 页面和数据

包含项目概览、工况与流程、生命周期评价、工况筛选、工况数据五个页面。使用石墨色侧栏、浅色分析区、青绿色操作按钮、琥珀色热回收标识和统一设备线描符号。

上传的数据为 `htl-design-data.json`，来自本项目 `analysis_web/data/study.json` 的整理副本，包含 20 组工况及其 STD/HR 配对，共 40 条记录。上传内容保留必要字段、单位、来源文件名及行号，没有上传完整论文、原生 Aspen 文件或本机路径。

这是归档数据交互原型，没有连接实时 Aspen 或 LCA 求解。HR 产物继承配对 STD 的产物核算；图中的配对加热需求差不等同于独立测得的换热器负荷。过程核算基准为 100 kg 湿进料 / 1 h，碳足迹归一化为 1 kg 出口所含目标单体，未假定已经分离为纯产品。

## 已实际检查

- 工况、STD/HR 切换及设备参数抽屉；抽屉可用 Escape 关闭。
- LCA 工况切换、核算基准文字和 T330-L10 的 CF 展示。
- 筛选权重：20/60/20 的首位为 T310-L15；60/20/20 的首位为 T350-L5。
- 数据搜索 T330-L10 返回 STD 和 HR 两条记录。
- 导出的全部 40 条 JSON 记录按 ID 与上传数据逐字段比对一致。
- 完成修正后，工况、搜索条件和筛选权重在刷新后保留；从候选工况进入流程页再使用浏览器返回，筛选结果保留。
- 检查桌面、1130×532 和 390×844 视口；后两种视口未出现文档横向溢出。

## 免费额度

共提交两轮 AI 请求。第一轮完成后，账户明确显示已使用 1/25 消息额度。第二轮也已完成，没有遇到额度限制。收尾复查时原 Ego 任务 Space 已不在可用列表中，因此没有取得第二轮后的最终余额；不能将请求次数直接当作最终计费数。未购买额度或升级套餐。

## 本地交付

- `base44-home-final.png`：最终首页截图。
- `base44-flow-final.png`、`base44-flow-small.png`：最终流程页及较小桌面视口。
- `base44-mobile-final.png`：最终移动视口。
- `design-brief.md`：首次搭建要求。
- `review-feedback.md`：集中修正要求。
- `htl-design-data.json`：上传的数据副本。
- `exported-all-40.json`：在预览中实际导出的全部记录。

预览为 Base44 草稿地址，其长期可用性由平台控制。收尾时浏览器任务 Space 已关闭，不能确认结果页仍在用户屏幕前台，可使用上面的链接重新打开。

## 后续 UI 优化：本地 v6

2026-11-17 再次核对账户：编辑器的“0 credits remaining”对应每日额度限制。菜单显示月度已用 **5.5/25**，每日已用 **5.5/5**，集成额度 **0/100**；月度仍有 **19.5**，不能笼统表述为所有额度已用完。截图为 `base44-credit-limits.png`。

在向用户说明后，继续优化本地前端，没有提交新的 Base44 AI 请求。新版地址：http://127.0.0.1:8766/?design=6#view=overview&case=T330-L10-HR&weights=33%2C33%2C33 。Base44 草稿未同步这轮本地改动。

新增 `studio-home-v6.png`、`studio-flow-v6.png`、`studio-lca-v6.png`、`studio-screening-v6.png` 和两张手机截图。`studio-export-v6.json` 为实际导出的 T330-L10-HR，case 与原始数据完全一致。40 个热图值逐一核对通过，工况切换、刷新、搜索、筛选预设、清单弹窗和设备参数已实际检查。

本轮额外通过 Ego 浏览 Tremor 的真实模板预览，借鉴 Overview 的指标/图表/明细层级与 Insights 的固定导航、筛选布局。参考截图为 `reference-tremor-overview.png`、`reference-tremor-insights.png`；完整链接及实现记录见 `../../analysis_web/README.md`。
