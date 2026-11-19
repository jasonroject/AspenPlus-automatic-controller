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
  results/<case_id>.json   # 单工况明细（同一 schema），按需加载
  surrogate/*.json         # 可选：代理模型网格等大文件分片
```

- 网页首页只读 `manifest.json` + `results/summary.json`；其余按 `manifest.shards` / `manifest.cases[].file` 的**相对路径**懒加载（不允许绝对路径或 `..`）。
- HTL 现有 `pipeline.json` 的拆分（Coding 负责）建议直接落成一个 `aspen-study/2` 研究包：grid / robustness 放 `surrogate/`，扫描变量写进 `manifest.variables`，取代 `pipeline.js` 里写死的 `temperature_C` / `length_m`。
- 版本规则：`schema` 字段写成“名称/主版本”。读取方遇到不认识的主版本必须拒绝；同一主版本内只新增可选字段。

## 各文件要点

| 文件 | schema 标识 | 说明 |
| --- | --- | --- |
| manifest.json | `aspen-study/2` | 模型身份（SHA-256）、契约版本、变量、gate 结论、工况索引、分片路径 |
| graph.json | `aspen-model-graph/1` | 块（类型、端口、负荷/功率读数）、流股（类别、起止、总量、组分质量流）、组分（CAS）、收敛状态 |
| roles.json | `aspen-roles/1` | 流股角色（feed/product/emission/waste/…）、设备角色与公用工程、功能单位、分配、置信度与来源（auto/override） |
| cases/*.json | `schema_version: 1` | 与 `universal-core.mjs` 的 `TABLES` 完全一致 |
| results/*.json | `aspen-results/1` | gates、`energy_edges`、`internal_loops`、`balance`、`completeness`、`contributions`、`case_params`、`method` |
| factors | `aspen-factor-library/1` | 按 CAS / 别名 / 公用工程 / 地区匹配；带 `source`、`year`、`status` |

## 约定

- **符号**：块的 heat/work 以进入块为正，冷却与对外做功为负（与现有核心一致）。`energy_edges.value` 是非负的流量大小，方向由 `source → target` 表达。
- **单位**：graph 与 case 分片保留原生值和原生 `UnitString`，只在 universal-core 中换算一次；results 中已换算的量在字段名或 `unit` 中写明。
- **桑基图**：`energy_edges` 必须无环（只含公用工程→设备→产品/损失）；内部换热（HeatX 两侧都在流程内）和循环物流放进 `internal_loops` 并附 `annotation`。
- **缺失因子**：类别标 `complete: false`，列出 `missing`，已知部分之和只作为 `lower_bound`，**绝不补 0**。
- **占位因子**：因子库中 `value: null` / `status: "placeholder"` 的条目不参与计算；`proxy: true` 的贡献需要在界面上单独标出。
- **人工确认**：产品流股与功能单位无法可靠推断，`roles.review.state` 必须是 `reviewed` 才输出 LCA 结果（G4）。

## Python 模块

| 模块 | 作用 |
| --- | --- |
| `schema_check.py` | 标准库实现的 JSON Schema 子集校验器（无需 jsonschema 依赖） |
| `classifier.py` | 基于 graph.json 的角色自动分类（带置信度与理由） |
| `overrides.py` | 合并 `roles.yaml` / `roles.json` 用户覆盖 |
| `factors.py` + `factors/library.json` | 因子库加载与匹配 |
| `validation.py` | G1 收敛/无错、警告、G2 完整性、G3 块级与边界衡算、G5 因子覆盖 |
| `build.py` | graph + roles + 因子 → 五表 project 与 results（含可视化字段） |
| `adapters/` | 仿真器适配器接口；`mock.py` 读取 graph 夹具，`aspen_com.py` 为待真机验证的桩 |

运行测试（Linux 即可，不需要 Aspen）：

```bash
python -m unittest discover -s aspen_study/tests -t .
```
