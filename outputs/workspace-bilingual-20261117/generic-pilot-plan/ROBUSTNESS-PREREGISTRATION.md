# 通用 HTL 均值模型情景分析：预注册补充

本补充冻结内部候选、共享扰动情景和偏好权重，不修改原17点的训练/留出/验证分组或5%预测误差检验。它不触发原生运行、不拟合模型，也不根据拟合结果选择有利候选。

- 9个候选：T=320/330/340℃ × L=8.5/12.5/17.5m，温度原生K=℃+273.15。
- 输入半宽：2K和0.25meter；它们是本次明确设定的情景宽度，不是实测操作波动或概率参数。
- 共享 normalized offsets：[-1,0,1]²的全部9种组合，包括中心；每种偏移同时应用于全部候选。共81个预测查询，不增加Aspen运行点，不赋予概率分布。
- 按真实响应ID映射三套权重，顺序为购能、产率、气候影响：equal=[1,1,1]；energy-focused=[2,1,1]；climate-focused=[1,1,2]。产率方向必须继承模型的max，购能与气候影响为min。
- 所有扰动坐标落在T=318–342℃、L=8.25–17.75m内；这在计划矩形域内，但仍须逐查询通过实际接受训练点的凸包和响应域门禁。
- 任何candidate/scenario失败都保留，且全局rank_complete=false；不能裁剪情景、删候选或只排名幸存结果。原生失败记录与原17点分组独立完整保留。
- 固定名义候选min/max归一化，clamp到[0,1]；常数指标=.5；绝对分数并列阈值1e-12、平均名次、并列平分首位情景份额。各偏好份额和为100%仅表示本次选定情景列表，不能称为概率。
- 模型若未通过预注册预测误差检验，普通预测仍关闭；仅明确--allow-exploratory时可输出探索结果。该步骤只计算冻结GP均值的情景敏感性，不更新LCA背景、不给出模型概率置信带或物理鲁棒性保证。

`robustness.config.json`直接作为CLI配置。`robustness-manifest.json`绑定设计/原扫描manifest/profile/原生模型的哈希；拟合模型哈希暂留null，实际结果将在模型存在后绑定model_sha256，而不回写或调整此设计。

```powershell
python -m process_pipeline.robustness <frozen-model.bundle.json> --config outputs/workspace-bilingual-20261117/generic-pilot-plan/robustness.config.json --output <new-robustness-result.json>
```

若模型仅可探索，显式追加`--allow-exploratory`，结果必须保留探索标签。
