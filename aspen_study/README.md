# aspen-study/2 数据契约与通用模型接入

目标：任何**收敛、无错误**的稳态 Aspen Plus 模型，都能经过“发现 → 自动角色草稿 → 人工确认 → 校验 → universal-core 计算”得到能量与 LCA 结果。计算核心仍是 `analysis_web/universal-core.mjs`，本目录只定义数据契约和前后处理。

> 状态：契约 v1 草案。Aspen COM 节点路径中标注“推断”的部分尚未在真机验证，见文末清单。

## 研究包目录（aspen-study/2）

```
study/
  manifest.json            # 入口（几 KB），schemas/manifest.schema.json
  graph.json               # 模型发现结果，schemas/graph.schema.json
  roles.json               # 已确认的角色映射，schemas/roles.schema.json
  factors.json             # 本研究用到的因子（从因子库抽取），schemas/factor-library.schema.json
  cases/<case_id>.json     # 每工况一个五表 project（schema_version 1，原样交给 universal-core），schemas/case.schema.json
  results/summary.json     # 全部工况的汇总与校验结论，schemas/results.schema.json
  results/<case_id>.json   # 单工况明细（同一 schema），按需加载；非默认情景为 <case_id>__<scenario>.json
  factors.json             # 因子快照：本研究实际用到的因子值（schemas/factors-snapshot.schema.json）
  surrogate/surrogate.json # 可选：代理模型描述（schemas/surrogate.schema.json），引用 surrogate/ 下的网格文件
```

- `manifest.cases[]` 每项自带 `case_params`、`kpi`（`energy_per_fu`、`gwp_per_fu`、`efficiency`、`max_balance_ratio`）与按类别的 `completeness` 摘要，工况 × 指标热图和刷选**不需要加载分片**；`energy_edges`、`contributions`、`internal_loops`、逐块 `balance` 只在 `results/<case_id>.json`，选中工况时再加载。
- 网页首页只读 `manifest.json`（必要时加 `results/summary.json`）；其余按 `manifest.shards` / `manifest.cases[].file` 的**相对路径**懒加载（不允许绝对路径或 `..`）。
- HTL 现有 `pipeline.json` 的拆分（Coding 负责）建议直接落成一个 `aspen-study/2` 研究包：grid / robustness 放 `surrogate/`，扫描变量写进 `manifest.variables`，取代 `pipeline.js` 里写死的 `temperature_C` / `length_m`。
- 版本规则：`schema` 字段写成“名称/主版本”。读取方遇到不认识的主版本必须拒绝；同一主版本内只新增可选字段。

## 情景、结果来源与完整度（2026-11-19 补充）

- **工况身份 = `id` + `scenario`**。manifest 必须给出 `scenarios`（如 `[{"id":"HR"},{"id":"STD"}]`）和 `default_scenario`；同一工况的不同情景是 `cases[]` 里的两条记录。**不要用 `gwp_per_fu_STD` 这类带情景后缀的字段**，校验器会拒绝。
- **`has_results`** 严格表示“五表结果文件存在”：`true` 时必须有 `file`（`cases/<id>.json`），`false` 时不得有 `file`（例如代理模型网格点或只有归档数值）。`result`（结果分片）与它无关，可选。可以用 `source` 注明来源：`aspen` / `surrogate` / `archived` / `manual`。
- **`evidence`**（可选）：`[{kind, file, sha256?, note?}]`，`kind` 如 `gate` / `observation`，即使 `has_results=false` 也可以指向校验或观测证据。
- **代理模型数据溯源**（可选）：`split`（`train` / `validation` / `test` / `fresh`）与 `source_record`（源数据中的记录标识）。
- **分配**：`method.allocation` 可以为 `null`（未声明或不适用），此时应写 `allocation_note` 说明。
- **模型身份**：`model.sha256`（Aspen 模型文件）与 `model.source_sha256`（没有模型文件时，源数据文件的哈希，例如归档的 pipeline.json）至少给一个；`model.version` 可以为 `null`。
- **代理模型**：预测网格不是 Aspen 结果。`shards.surrogate` 指向 `surrogate.json` 描述文件，网格文件由它的 `grid_files` 列出。旧写法（网格文件数组）暂时兼容，建议迁移。
- **completeness.status**：`complete` / `incomplete` / `unknown`。
  - `complete`：每个清单行都有可用因子且有分项，`contribution_coverage = 1`、没有缺失项。
  - `incomplete`：已知缺因子，只给 `lower_bound`。
  - `unknown`：只有总值、没有分项，或因子覆盖未核实（`contribution_coverage` 为 `null`）。**这种情况绝不能标为 complete**（例如从归档 GWP 总值转换来的数据）。
  - **总值规则**：`completeness.total` 和 `kpi.gwp_per_fu` 在 `complete` 或 `unknown`（已知总值、无分项）时可以填写；只有 `incomplete` 时禁止填写，改用 `lower_bound`。
  - 保留布尔字段 `complete` 以兼容，必须等于 `status == "complete"`。
- 以上跨字段规则由 `schema_check.manifest_rules` / `results_rules` 检查，`validate(x, "manifest")` 会一并执行。

## manifest 体积

manifest 随工况数线性增长：每个工况条目约 0.5–1 KB（参数 + KPI + 完整度摘要）。约 50 个工况（每个两种情景）在几十 KB 内是正常的，不必为了压缩体积而删掉热图需要的字段；超过约 1000 条记录时再考虑按情景拆分 manifest 或把摘要移到 `results/summary.json`。大块数据（桑基边、贡献、逐块衡算、代理网格）始终放在分片里。

## 各文件要点

| 文件 | schema 标识 | 说明 |
| --- | --- | --- |
| manifest.json | `aspen-study/2` | 模型身份（SHA-256）、契约版本、变量、gate 结论、工况索引、分片路径 |
| graph.json | `aspen-model-graph/1` | 块（类型、端口、负荷/功率读数）、流股（类别、起止、总量、组分质量流）、组分（CAS）、收敛状态 |
| roles.json | `aspen-roles/1` | 流股角色（feed/product/emission/waste/…）、设备角色与公用工程、功能单位、分配、置信度与来源（auto/override） |
| cases/*.json | `schema_version: 1` | 与 `universal-core.mjs` 的 `TABLES` 完全一致 |
| results/*.json | `aspen-results/1` | gates、`energy_edges`、`internal_loops`、`balance`、`completeness`、`contributions`、`case_params`、`method` |
| factors.json | `aspen-factors-snapshot/1` | 实际使用的因子：id、value、unit、impact_unit、source、year；results 只写 `factor_id` |
| surrogate/surrogate.json | `aspen-surrogate/1` | 代理模型类型、输入范围、目标、训练/验证划分与指标、数据来源、网格文件；**与 Aspen 结果分开** |
| 因子库 | `aspen-factor-library/1` | 按 CAS / 别名 / 公用工程 / 地区匹配；带 `source`、`year`、`status` |

## 约定

- **符号**：块的 heat/work 以进入块为正，冷却与对外做功为负（与现有核心一致）。`energy_edges.value` 是非负的流量大小，方向由 `source → target` 表达。
- **单位**：graph 与 case 分片保留原生值和原生 `UnitString`，只在 universal-core 中换算一次；results 中已换算的量在字段名或 `unit` 中写明。
- **桑基图**：`energy_edges` 必须无环（只含公用工程→设备→产品/损失）；内部换热（HeatX 两侧都在流程内）和循环物流放进 `internal_loops` 并附 `annotation`。
- **缺失因子**：类别标 `status: "incomplete"`，列出 `missing`，`total` 为空，已知部分之和只作为 `lower_bound`，**绝不补 0**。
- **占位因子**：因子库中 `value: null` / `status: "placeholder"` 的条目不参与计算；`proxy: true` 的贡献需要在界面上单独标出。
- **人工确认**：产品流股与功能单位无法可靠推断，`roles.review.state` 必须是 `reviewed` 才输出 LCA 结果（G4）。

## Python 模块

| 模块 | 作用 |
| --- | --- |
| `schema_check.py` | 标准库实现的 JSON Schema 子集校验器（无需 jsonschema 依赖） |
| `classifier.py` | 基于 graph.json 的角色自动分类（带置信度与理由） |
| `overrides.py` | 合并 `roles.yaml` / `roles.json` 用户覆盖 |
| `factors.py` + `factor_library/library.json` | 因子库加载与匹配 |
| `validation.py` | G1 收敛/无错、警告、G2 完整性、G3 块级与边界衡算、G5 因子覆盖 |
| `build.py` | graph + roles + 因子 → 五表 project 与 results（含可视化字段） |
| `adapters/` | 仿真器适配器接口；`mock.py` 读取 graph 夹具，`aspen_com.py` 为待真机验证的桩 |

运行测试（Linux 即可，不需要 Aspen）：

```bash
python -m unittest discover -s aspen_study/tests -t .
```

## 命令行

```bash
# 自动分类 + 合并覆盖（roles.yaml 需要 PyYAML；也可用 roles.json）
python -m aspen_study.cli classify --graph graph.json --override roles.yaml --out roles.json
# 生成 aspen-study/2 研究包（需要 Node.js 调用 universal-core）
python -m aspen_study.cli assess --graph graph.json --roles roles.json --study-id demo --out-dir study/ [--factors my-factors.json] [--calorie-J 4.1868]
```

## 自动分类规则（摘要）

- **块**：按 Aspen 块模型名映射（Heater/HeatX/Flash2/RadFrac/RStoic…/Pump/Compr/Mixer/Valve）。HeatX 有两股物料进口 → `internal_recovery`（外部 Q=W=0，交换热只进 `internal_loops`）。正负荷按出口温度 + 10 K 推荐 LP/MP/HP 蒸汽或加热炉，负负荷推荐冷却水或冷冻，置信度 0.55–0.6，**必须确认**。泵/压缩机 → 电力；负轴功 → 透平（默认不抵扣）。
- **流股**：来自 BOUNDARY → 进料；两端都在同一块循环内 → 循环（经过双侧换热器的环路视为热集成，不算循环）；出口按名称关键词与组成判断排放（不凝气 ≥ 50%）/ 废水（水 ≥ 80%）/ 产品候选。**产品与功能单位永远需要人工确认**。
- **冷却公用工程**按“服务”计入 `material` 类清单，不计入外购能量强度（外购热 + 电）。
- 排放流按组分拆分；N2/O2/Ar/H2O/He 视为惰性跳过，其余组分没有因子就进入 `missing`。CO2/CH4 需要声明 `carbon_origin`（fossil/biogenic），否则不匹配任何因子。

## 待真机（Windows + Aspen）验证

`adapters/aspen_com.py` 目前是桩，`status/components/blocks/streams` 抛出 `NotImplementedError`。以下内容需要在装有 Aspen 的机器上核实：

1. 块模型名（RecordType 属性）与端口连接（`Connections` / `Ports\SOURCE|DEST`）的节点。
2. 流股类别（MATERIAL/HEAT/WORK）与非 MIXED 子物流（CISOLID/NC）的节点；汽相分率节点。
3. RadFrac `COND_DUTY` / `REB_DUTY`、HeatX `HX_DUTY` 等负荷节点名称。
4. 组分别名与 CAS 的读取方式；公用工程对象节点。
5. `CVSTAT` 与 `BLKSTAT` 的可接受代码（HTL 用过 BLKSTAT ∈ {0,2}，CVSTAT 接受值尚未确认）。
6. HEAT/WORK 流股与块负荷是否会重复计算。
7. `.apw` 能否直接打开（目前仍只接受 `.bkp`）。
8. 至少一个非 HTL 的真实模型跑通发现 → 分类 → 研究包，并保存回放夹具。

## 夹具

- `tests/fixtures/htl.graph.json`：HTL 流程形状，数值取自 `analysis_web/data/universal-htl.json`（原生运行 T325p00_L8p50）；组分质量拆分为夹具假设。
- `tests/fixtures/distillation.graph.json`：苯/甲苯精馏，人工配平的算术夹具，不是 Aspen 运行结果。
- `tests/fixtures/errored.graph.json`：同一精馏但未收敛，用于验证拒绝。
