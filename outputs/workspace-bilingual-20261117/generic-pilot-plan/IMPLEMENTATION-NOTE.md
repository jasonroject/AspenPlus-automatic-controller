# 预注册后的实现一致性修补

时间（UTC）：2026-11-17T16:01:58.303670+00:00

独立代码审查复现：将offline bundle的prediction_enabled改为true并重算JSON哈希，可以形成与evidence/validation/status矛盾的常规预测声明。主任务批准修补check_bundle，拒绝enabled=true但非native_simulation、validation.passed非true、status非declared_simulator_error_checks_passed，以及disabled却声明qualified的组合。

- 预注册时 surrogate.py 文件 SHA-256：`717a21f29c79399849af3be48d15179a336e89fb7ceb9c5177cc860e00d3f527`
- 修补后文件 SHA-256：`db07bc5fdd11d68ed0eee0c9983318e47d7c7952056c91fd4ab01a8791b27086`
- 变更只涉及bundle内部声明一致性校验；不改GP核、缩放、拟合数据、超参数优化过程、均值数值公式、误差标准或计划分组。
- 原profile、17点扫描plan、criteria、queries及81点情景设计均保持冻结，原manifest保留，不覆盖历史哈希。
- 这是软件门禁修补，不依据本次原生结果调参；JSON所有声明即使互相一致也仍不能独立认证Aspen执行或物理有效性。

修补后代理模型/鲁棒性/独立审查共33项测试通过。本说明不声明本次17点模拟完成或模型误差检验通过。

## 数值常量评分修补（2026-11-17T16:23:43.096515+00:00）

独立单位换算手算复现了等价值1.5177297297297296与1.5177297297297299被严格min/max评分放大为0与1的问题。主任务批准通用鲁棒性模块将数值常量定义为`nominal span <= 16 * machine epsilon * max(abs(min),abs(max))`，其效用统一0.5，不使用`max(1,scale)`，因此1e-20与2e-20等真实近零差异仍保留。并列平均排名/1e-12分数并列阈值本身不变。

这不是工况达标阈值，也不更改GP拟合、预测、5%误差检验或冻结设计。输出methods字段显式记录规则；viewer只做便宜的导出内部一致性检查，不执行GP、不认证JSON来源。新增跨尺度回归及12/3/2独立分组回归均通过。

当前robustness.py SHA-256：`e5ee935eb5021ee18bb33557749176861e3f9e17dff3e95ad675d62909c6d0d7`。
