# V2 publication copy — integration draft

Draft only. No production source changes. Read inputs: the frozen v2 preregistration/cohort map and the completed local comparison. No v2 native responses, fitted results, or qualification outcome were read or filled in. Exact checked values and source byte hashes are in `v2-copy-evidence-draft.json`.

## 1. Keep one compact example area

Use the existing model-example disclosure on `models.html`. Add one **Version / 版本** selector, then reuse the existing project/model/prediction/scenario actions for the selected version. Do not repeat a full action row for each version.

| Control or note | English | 中文 |
|---|---|---|
| Disclosure | HTL example and evidence | HTL 示例与依据 |
| Version selector | Version | 版本 |
| Existing option | v1 · 17 points | v1 · 17 工况 |
| Future option, once data are reviewed | v2 · One adaptive extension | v2 · 一次自适应扩点 |
| Draft status only | Awaiting completed checks | 等待完整检查结果 |
| Link to documentation | How the versions were checked | 各版本如何核查 |
| Local-comparison detail | Local check of the frozen v1 model | v1 冻结模型的局部复核 |

The nine local runs are an evidence group, not a third fitted model version. Put their summary under the documentation link or one compact details element. Version changes must update the visible status, source identity, and action targets together. Never leave a v1 plot under a v2 label; if an artifact is not available for the selected version, disable only that action and explain it. Do not infer a pass from the version number or planned point count.

Keep the v1 option, v1 failed verification, and local comparison reachable after v2 is added. The existing older HTL lab remains a separate reference model, outside this version selector. No new home-page card is needed.

## 2. Documentation section drafts

Place two small sections after the existing `models/pilot` section. Keep the existing v1 anchor unchanged. Use the same IDs in English and Chinese: `pilot-local` and `pilot-v2`. Main text stays short; provenance and per-cohort errors belong in expandable details or the package README.

### `pilot-local` — English

**A local check of v1**

Nine copied-model runs checked the neighborhood around 330 °C and 12.5 m: temperatures 328, 330 and 332 °C crossed with lengths 12.25, 12.5 and 12.75 m. Eight coordinates were new. Their maximum relative errors against the frozen v1 predictions were **2.005058% for purchased energy, 1.347822% for target/feed yield, and 1.850088% for climate impact**, below the unchanged 5% criterion.

The center repeated the original holdout `case-008`; its three native metrics matched the earlier run exactly at the exported precision. This is a descriptive repeat, not a ninth new verification location. No repeatability acceptance limit was preregistered. The local check did not refit or qualify v1: its original failed verification remains, and ordinary v1 prediction stays disabled. It does not establish global rankings, probabilities, a validated LCA background, or physical reliability.

### `pilot-local` — 中文

**v1 的局部复核**

在 330 °C、12.5 m 附近完成了 9 次模型副本运行：温度 328、330、332 °C 与管长 12.25、12.5、12.75 m 交叉组合，其中 8 个坐标此前未运行。与冻结 v1 预测相比，这 8 点的最大相对误差分别为：**购入能耗 2.005058%、目标产物/进料产率 1.347822%、气候影响 1.850088%**，均低于未改变的 5% 标准。

中心点重复原留出工况 `case-008`；三项原生指标在导出精度下与先前运行完全一致。该点用于描述重复执行结果，不计作第 9 个新增复核坐标，也没有预先设定重复性验收限。局部复核没有重新拟合或使 v1 合格：原复核失败仍保留，v1 常规预测仍未启用。这些结果不能证明全局排序、概率、背景 LCA 有效性或物理可靠性。

### `pilot-v2` — English, before final results

**One adaptive extension**

The v2 plan adds eight training locations and four newly reserved verification locations after reviewing v1. It plans **37 unique coordinates: 20 training, 3 legacy holdout and 14 verification**. The verification set contains the 2 original locations, 8 local locations and **4 fresh prospective locations**, which will be reported separately. The repeated local center is retained as evidence and counted only once in the combined dataset.

This is one adaptive extension, not a newly independent test of every retained point. The original and local groups are already-known development evidence for v2. The 5% response-error criteria and denominator floors remain unchanged; no verification point moves into training. Final native completeness, per-cohort errors and model status are **pending**. A result is not qualified by omitting failed or unattempted points. These checks assess reproduction of the Aspen model, not physical validation.

### `pilot-v2` — 中文，最终结果前

**一次自适应扩点**

v2 在审阅 v1 后，计划新增 8 个训练坐标和 4 个预先保留的新复核坐标。合并计划共 **37 个唯一坐标：20 个训练点、3 个历史留出点和 14 个复核点**。复核组由原 2 点、局部 8 点和 **4 个全新前瞻复核点**组成，各组单独报告。局部中心点的重复运行作为证据保留，在合并数据中只计一次。

这是一次自适应扩点，不能把所有保留点都称为全新独立验证。对 v2 而言，原结果和局部结果属于已经知晓的开发依据。三项响应的 5% 误差标准与分母下限不变，复核点不转入训练。完整原生记录、分组误差与模型状态目前均为**待完成**；不能删去失败或未尝试工况后宣称合格。这些检查衡量对 Aspen 模型的复现，不代表物理验证。

### Final-result integration rule

Replace only the pending-result sentence after final evidence is reviewed. Show explicit counts for every planned cohort, failed/unattempted rows and the actual qualification flags. Do not use the planned 37 as an achieved count before checking completeness. Keep the pre-adaptive nature of the old evidence visible even if all subsequent criteria pass.

For each response, report MAE, RMSE and maximum relative error for **legacy holdout 3, legacy verification 2, local verification 8, and fresh prospective 4** separately; the combined verification-14 gate may also be shown. Fresh-4 success cannot hide failure in any older group, and a pooled result cannot hide fresh-4 failure. Keep raw and predicted values available. V2 values for the local-eight group must be newly computed against v2; the figures above are specifically v1-versus-local-native errors.

Do not write a v2 success statement, a new error percentage, a new ranking, or a new leading share in this draft. Prediction and scenario files are conditional on their final explicit enabled/exploratory status.

## 3. Exact local facts for a compact expandable table

The response denominator is unchanged: energy and climate impact per kg outlet target (catechol + o-cresol before separation); yield is target/feed mass ratio. It is not yield per kg product, and it is not the older HTL lab's per-100-kg-wet-feed energy basis.

| Response / 响应 | Unit / 单位 | Eight-new maximum relative error / 新 8 点最大相对误差 | Relative denominator floor / 相对误差分母下限 |
|---|---|---:|---:|
| Purchased energy / 购入能耗 | kWh/kg | 2.005058% | 0.01 |
| Target/feed yield / 目标产物与进料质量比 | 1 | 1.347822% | 0.001 |
| Climate impact / 气候影响 | kg CO2-eq/kg | 1.850088% | 0.01 |

| Center repeat / 中心重复：`local-05` vs `case-008` | Original / 原值 | Repeated / 重复值 | Difference / 差值 |
|---|---:|---:|---:|
| Purchased energy (kWh/kg) | 2.6261657378409473 | 2.6261657378409473 | 0 |
| Target/feed yield (1) | 0.06060042552121615 | 0.06060042552121615 | 0 |
| Climate impact (kg CO2-eq/kg) | 10.547501675749563 | 10.547501675749563 | 0 |

The center's native-vs-native difference is zero; its native-vs-v1 prediction error is not zero. Do not conflate these two comparisons. All nine native records and their warnings stay in the source comparison.

## 4. Public package README outline

Use a new versioned package; do not overwrite `data/generic-htl-pilot/`. The precise future directory/file names below are proposed, not existing public links. Finalize them only after the curator emits the actual package.

Suggested order, with matching English/Chinese headings:

1. **Status and scope / 状态与范围** — short actual final status, model version, source archive identity, 37 planned unique points, achieved/failed/unattempted counts, no physical validation. Separate native gates from model qualification.
2. **What changed / 本次变化** — one adaptive extension, original 12 plus new 8 training points, unchanged units/boundary/factors/5% policy, one frozen fit; original and local evidence are development evidence for v2.
3. **Cohorts and exclusions / 分组与重复点** — exact 20/3/14 assignment, legacy 2/local 8/fresh 4 distinction, excluded center repeat with source ID, no hidden failure deletion.
4. **Results by cohort / 分组结果** — final native and predicted values, MAE/RMSE/max-relative-error for each response/group, explicit complete/pass flags, retained failures. All v2 numbers pending in this draft.
5. **Files and provenance / 文件与来源** — the manifest below, byte hashes and canonical artifact identities clearly distinguished.
6. **Reproduce / 复现** — repository-root CLI commands using the actual public paths; no private `outputs/` dependency for public examples. Preserve fixed cohort mapping, criteria, fit configuration and source hashes. Re-fit reproducibility is not a new native run.
7. **Limits / 使用范围** — frozen Aspen simulation and declared foreground inventory; no physical or background-LCA validation, no probabilities from scenario shares, no continuous-domain guarantee, no operating-performance threshold.

### Proposed file inventory and provenance duties

| File or group | What must be disclosed |
|---|---|
| `README.md`, `index.json` | Human scope + byte SHA256/size for every shipped JSON; no unlisted extra JSON. Maintain byte-preserving Git attributes. |
| `profile.json`, `criteria.json` | Reviewed mapping, units, native source SHA, unchanged factor/target definitions and exact 5% policy/floors. No local username paths or native binary. |
| `extension-plan.json`, `cohorts.json`, `preregistration.json` | The new 12 requested cases, all 37 planned source/cohort IDs, excluded center repeat, freeze timing/hash and one-adaptation/one-fit policy. Retain original preregistration identity if a public sanitized representation is made. |
| `native-checks.json` | All 37 unique planned cases with source batch, raw/report identity, warnings, five gates and failure/unattempted state. Link the separate repeat evidence; do not publish private full execution directories. |
| `project.json`, `dataset.json` | Combined five-table results and audited responses; original/current split and source batch identity remain traceable. No predicted labels substituted for native rows. |
| `model.bundle.json`, `evaluation.json` | Actual frozen v2 model/source hashes, policy and qualification flags. Original v1 artifacts remain in their original package. |
| `cohort-evaluation.json`, `summary.json` | Explicit legacy holdout 3, legacy verification 2, local 8, fresh 4, combined verification 14; completeness and final status, no pooled-only conclusion. Proposed filenames; use curator's exact names. |
| Local comparison package or `local-perturbation-comparison.json` | Completed 8-new + 1-repeat comparison against frozen v1, exact v1 model binding and center repeat; retain local plan/mapping hashes and original evidence identity. Do not relabel this file as a v2 comparison. |
| Conditional `predictions.json`, `robustness.json`, scenario config/preregistration | Only if generated and reviewed. Bind the new v2 model hash; preserve the v1 81-query scenario artifact. Mark exploratory status explicitly if qualification fails. Scenario/preference shares are finite-grid shares, not probabilities. |

The three source batches are the original 17-run pilot, the nine-run local check, and the planned 12-run extension. Together they plan 38 run records but 37 unique coordinates because the center repeats `case-008`. This does not assert that the new 12 have already completed. Keep the repeat outside the merged fitting dataset and available in its own evidence. A final browser import may show 37 unique project cases while documentation separately discloses all planned executions and their achieved/failed/unattempted status.

## 5. Integration checks before publishing the draft

- Fill only from final artifacts; verify the three source batches, cohort counts, excluded repeat, all failure rows and every displayed rounded error against exact JSON.
- Confirm criteria identity and no holdout/verification-to-training reassignment. Do not present known legacy/local groups as fresh independent validation.
- Ensure a version switch cannot mix a title, status or chart from another version; make all visible UI notes bilingual with stable anchors and unchanged data IDs.
- Recheck public JSON byte hashes after a clean Git checkout and ordinary production HTTP, plus private-path/credential exclusion. Update the existing manifest regression to cover the actual new package without relaxing the v1 checks.
- Keep v1/local evidence intact. Do not promote a model or remove a failure based on this copy draft.
