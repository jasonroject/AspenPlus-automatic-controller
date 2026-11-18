# Aspen 与 LCA 分析数据结构 v1.0

`analysis_web/data/study.json` 是前端唯一工况数据入口。结构按 Aspen 的工况、物流、设备输出组织，LCA 通过工况 ID 和方案关联。现有控制台使用的原始结果格式继续由适配器读取。

## 生成和使用

在仓库根目录运行 `python analysis_data/build_study.py`，从 `analysis_data/source/` 的四张源表重建40条配对记录。运行 `python -m http.server 8766 --bind 127.0.0.1 --directory analysis_web`，浏览器打开 `http://127.0.0.1:8766`。

读取新 Aspen 导出时使用 `python analysis_data/aspen_adapter.py path/to/results.json --output normalized.json`。适配器生成物流和设备明细，研究摘要导入器生成本文的工况指标。两者以工况关联，摘要中的两种目标单体不能替代完整流股组成。

## 结构和字段

顶层包含 `schema_version`、`study`、`sources` 和 `cases`。工况键为 `T310-L5` 等名义温度/长度组合，方案记录ID增加 `-STD` 或 `-HR`。跨研究合并时须同时使用研究标识。

| 字段 | 存储单位 / 语义 | 界面单位 |
|---|---|---|
| study.basis.duration_s | s，核算时长3600 | h |
| study.basis.wet_feed_kg | kg，湿进料功能单位100 | kg |
| inputs.temperature_k | K，实际模型设定，如583 | °C，减273.15 |
| inputs.nominal_temperature_c | °C，论文工况标签，如310 | °C（名义） |
| inputs.pressure_pa | Pa，修订稿2.1节设定25 MPa | MPa |
| inputs.length_m | m，单根管长 | m |
| inputs.feed_kg_s | kg/s，进料流率 | kg/h |
| outputs.target_monomer_kg | kg，核算时段内目标单体质量 | kg/100 kg湿进料 |
| outputs.target_yield_fraction | kg目标单体/kg湿进料 | % |
| outputs.char_proxy_kg | kg，元素碳焦炭代理质量 | kg/100 kg湿进料 |
| outputs.residence_time_s | s | h |
| outputs.heater_w / reactor_w / pump_w | W，导出功率或热负荷 | kW |
| outputs.cooler_w / separator_w | W，保留Aspen负荷正负号 | kW |
| outputs.pump_inventory_j | J，LCA固定泵电量 | kWh |
| outputs.electricity_j | J，预热＋反应器＋清单泵电量 | kWh/100 kg湿进料 |
| outputs.components_kg_s | kg/s，CAT和O_CRESOL两个目标单体 | kg/h |
| lca.gwp_kg_co2e | kg CO₂-eq/功能单位，经尺度校正 | kg CO₂-eq/100 kg湿进料 |
| lca.reference_target_kg | kg，LCA归一化目标单体质量 | kg |
| lca.cf_kg_co2e_per_kg_target | GWP/reference_target_kg | kg CO₂-eq/kg所含目标单体 |
| lca.mc_mean_cf | 同CF单位，MC均值 | 同CF |
| lca.ci95_kg_co2e_per_kg_target | MC的2.5%和97.5%分位数 | 同CF |

物理量采用SI存储与常用工程单位显示。CO₂-eq为影响评价单位，需同时保留评价方法、时间尺度、系统边界和功能单位。当前气候指标采用100年时间尺度，ReCiPe 2016 v1.03 midpoint (H)，从摇篮到工厂大门。此处未进行国标逐条符合性认证。

`null` 表示缺失/无法确认，数值0表示已导出的零。所有JSON拒绝NaN和Infinity。`quality`保存导入状态、组件覆盖范围和物料衡算偏差。`sources`含文件名及SHA256，`provenance.rows`为含表头起算的CSV实际行号。原始单位与节点信息在Aspen明细适配器中保留。

## 版本和核算约定

- 数据来自2026-11-16修订稿资料包的归档结果，来源为四张本地CSV快照。HR反应产物共享对应STD结果。原始S4出口20工况×21组分已核对，两方案质量流率逐项一致。
- `energy-and-heat-recovery-v2.csv`提供40套方案的设备负荷。电耗为 `(heater_w + reactor_w) × 3600 + pump_inventory_j`。冷却与闪蒸热负荷不折算为额外电耗。
- 清单泵电量2.172 kWh与Aspen泵功率2.171721 kW单独保留。
- 330°C/5m的旧LCA输出存在尺度修正，使用`paired-inventory-accounting-v2.csv`校正后的100 kg基准GWP，除以该表对应目标单体基准。保留`export_target_scale`便于追溯。
- 确定性CF与MC均值为独立结果，MC区间不作为确定性计算的数值误差。
- Pareto筛选采用20个STD工况的目标单体最大、焦炭代理最小、确定性CF最小三目标。效用归一化范围为全部20工况，偏好评分用于Pareto候选。HR可用于配对分析。
- 物性替代情景及后续诊断模拟不混入当前论文归档数据。导入与计算一致性检查不代表实验或物性验证。

## 原始来源对应

四张快照来自用户指定论文包。`all_20_cases.csv`对应`research/data/`，能耗和配对清单对应`manuscript/_tools/source_data/`，MC表对应`research/supplementary/data/`。网页仅包含文件名与行号，私有文件绝对路径留在本地工作环境。

## 验证

`python -m unittest discover -s analysis_data -p 'test_*.py'`。
导入时校验主键唯一、20工况和40方案覆盖、功能单位、温度、能量计算和MC区间。Aspen适配器另检查旧导出格式、完整组分、子物流、零值、未知单位及非有限值。
