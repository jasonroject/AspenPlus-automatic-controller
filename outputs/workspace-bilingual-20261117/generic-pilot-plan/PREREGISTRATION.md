# 通用适配器 HTL 小型真实扫描：预注册

冻结时间（UTC）：2026-11-17T15:41:28.874211+00:00。本目录只准备计划、误差检验标准和查询，不运行 Aspen、不拟合模型，也不包含新的模拟结果。

## 冻结对象与研究边界

- `profile.json` 原样复制当前已审阅配置，canonical SHA-256：`07f292a36262a52104a565b981a904cd0129e33b965c782824db466d170e02be`。
- 原生 `.bkp` SHA-256：`4c93329ad8d44a44857ee63e18b4a1567aa7762aa1c4b9929b09d325e7021bed`。执行时必须使用匹配的原文件；每点另建副本，原文件不保存、不修改。
- 当前 profile 的 review 文字保留当时状态，不为本次计划修改其哈希。既有单点验证证据在相邻 `native-pilot-01`，它不加入本次训练集。
- 本次仅 HR、原有 HTL 反应/物性模型与压力约束；只扫描反应器温度和管长。加热器温度等于反应器温度；固定积分控制保留 profile 声明和逐点回读。
- 产率为目标组分出口质量/原料质量，并非分离回收率。能耗按该 profile 的受限购能清单、每 kg 目标组分计；气候影响继承既定前景清单与因子，不扩称完整全厂 LCA 或物理验证。

## 在看到本次结果之前冻结的设计

15 点为 T=310/320/330/340/350 ℃ × L=5/12.5/20 m。原生温度精确按摄氏温度+273.15表示为 K，长度保持原生 `meter`。直接调用当前 `analysis_web/model-plan.mjs` 的 `buildPlan(...,'frozen')`，不手工重分组：12 training、3 holdout，四个角点均为训练点。追加两点 verification，不进入拟合。

| ID | ℃ | K | m | 冻结 split |
| --- | ---: | ---: | ---: | --- |
| case-001 | 310 | 583.15 | 5 | training |
| case-002 | 310 | 583.15 | 12.5 | training |
| case-003 | 310 | 583.15 | 20 | training |
| case-004 | 320 | 593.15 | 5 | holdout |
| case-005 | 320 | 593.15 | 12.5 | training |
| case-006 | 320 | 593.15 | 20 | holdout |
| case-007 | 330 | 603.15 | 5 | training |
| case-008 | 330 | 603.15 | 12.5 | holdout |
| case-009 | 330 | 603.15 | 20 | training |
| case-010 | 340 | 613.15 | 5 | training |
| case-011 | 340 | 613.15 | 12.5 | training |
| case-012 | 340 | 613.15 | 20 | training |
| case-013 | 350 | 623.15 | 5 | training |
| case-014 | 350 | 623.15 | 12.5 | training |
| case-015 | 350 | 623.15 | 20 | training |
| verify-T335-L8p5 | 335 | 608.15 | 8.5 | verification |
| verify-T345-L17p5 | 345 | 618.15 | 17.5 | verification |

独立维度为2，训练点为12，满足现有工程准备检查最少6点；四角完整且无共线，计划训练凸包覆盖声明矩形。17个ID/坐标均唯一，3个holdout和2个verification不与训练重复。只有3个留出点和2个验证点，不能据此宣称全域准确。若训练角点失败，实际可预测域会收缩，由接受的训练坐标重新计算。

## 预注册预测误差检验

所有响应、每个声明的验证 split 均要求最大相对误差不超过0.05：

`max_i(abs(predicted_i - native_i) / max(abs(native_i), relative_floor)) <= 0.05`

| 响应 | 单位 | relative_floor | 最大相对误差 |
| --- | --- | ---: | ---: |
| purchased_energy_kWh_kg | kWh/kg | 0.01 | 0.05 |
| yield_fraction | 1 | 0.001 | 0.05 |
| impact:Climate change | kg CO2-eq/kg | 0.01 | 0.05 |

这些是预测对原生模拟输出的误差检验，不是工况达标门槛；floor 与响应同单位，只处理接近零的分母，不是排除低响应点的筛选线。MAE、RMSE仍报告。每个失败的holdout/verification保留并使该验证组不完整，不能仅用幸存点通过检验。

拟合只使用合格 training 行。固定 Matérn 5/2 核族，固定归一化白噪声方差1e-8、alpha=1e-10、random_state=20261117、优化器重启0次；超参数只由训练数据的边际似然优化。响应普通中心化/缩放，不对holdout/verification拟合，不借用旧HTL模型或既有单点数值。配置未通过不得据结果改核、调门槛、重分组或把失败点悄悄换成新点；若要新一轮，须另立计划。

## 失败、预测与执行规则

每点运行副本，保留原始readout、输入前后回读、报告、警告及五个独立gate。普通求解不通过且明确关闭的案例留为失败，可继续安全点；soft/hard timeout、Stop失败、清理未知或源身份变化停止剩余原生批次，剩余计划保留为not attempted。

预测仅在声明范围与实际接受训练凸包内。若任何预注册响应/验证组不通过，默认不开放普通预测；可明确 `--allow-exploratory` 输出标记探索性的均值，仍禁止外推，不生成概率置信带。所有失败保留，无工况达标门槛，无物理可靠性结论。

`queries.json` 预先包含325℃/10m以及两条verification坐标；前者为后续演示查询，后两者便于与原生验证值对照。查询不增加原生执行点，不参与拟合，不代替全部holdout/verification检验。

从仓库根目录运行：

```powershell
python -m process_pipeline.cli validate-profile --profile "C:\Users\Administrator\Documents\Codex\2026-09-16\project1jason\automatic\outputs\workspace-bilingual-20261117\generic-pilot-plan\profile.json" --plan "C:\Users\Administrator\Documents\Codex\2026-09-16\project1jason\automatic\outputs\workspace-bilingual-20261117\generic-pilot-plan\plan.json"
python -m process_pipeline.cli scan --profile "C:\Users\Administrator\Documents\Codex\2026-09-16\project1jason\automatic\outputs\workspace-bilingual-20261117\generic-pilot-plan\profile.json" --plan "C:\Users\Administrator\Documents\Codex\2026-09-16\project1jason\automatic\outputs\workspace-bilingual-20261117\generic-pilot-plan\plan.json" --model "<匹配上述SHA-256的原生bkp绝对路径>" --output "<新的运行目录绝对路径>"
python -m process_pipeline.surrogate fit "<运行目录>/dataset.json" --config "C:\Users\Administrator\Documents\Codex\2026-09-16\project1jason\automatic\outputs\workspace-bilingual-20261117\generic-pilot-plan\criteria.json" --output "<运行目录>/surrogate.bundle.json"
python -m process_pipeline.surrogate evaluate "<运行目录>/surrogate.bundle.json" --output "<运行目录>/surrogate.evaluation.json"
python -m process_pipeline.surrogate predict "<运行目录>/surrogate.bundle.json" --points "C:\Users\Administrator\Documents\Codex\2026-09-16\project1jason\automatic\outputs\workspace-bilingual-20261117\generic-pilot-plan\queries.json" --output "<运行目录>/surrogate.predictions.json"
```

`manifest.json` 同时记录文件字节哈希和Python canonical JSON哈希，以及当前web分组函数/拟合代码的文件哈希。`prepare.py`会拒绝覆盖已冻结目录。执行前确认本目录各文件哈希仍与manifest一致；原生运行由主任务另外触发。
