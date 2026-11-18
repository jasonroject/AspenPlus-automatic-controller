# HTL v2: one adaptive extension

**The frozen model met its declared simulator-error checks; ordinary prediction is enabled within its declared training support.**

The combined project contains **37 unique native coordinates: 20 training, 3 legacy holdout and 14 verification**. All 37 passed the declared execution and accounting gates. The original 17-run pilot, the nine-run local check and the 12-run extension retain **38 native execution records** because the local center repeats original holdout `case-008`. That repeat remains in the local comparison and is not an extra dataset row. Original warnings remain available.

This was one adaptive extension after reviewing v1, with eight new training locations and four fresh prospective verification locations. The original two verification locations and eight local locations are already-known development evidence for v2. They are not relabeled as fresh independent tests. One frozen fit used only the original 12 plus new 8 training cases. The original 5% maximum-relative-error policy and unit-specific denominator floors are unchanged; no validation case moved into training. All groups remain in the overall check; fresh-four results cannot mask another group's failure.

| Maximum relative error | Legacy holdout (3) | Legacy verification (2) | Local verification (8) | Fresh prospective (4) |
|---|---:|---:|---:|---:|
| Purchased energy / kWh per kg target | 1.543734% | 1.239009% | 2.174724% | 0.344730% |
| Target/feed mass ratio | 0.854587% | 1.052598% | 1.086882% | 1.352620% |
| Climate impact / kg CO2-eq per kg target | 0.836843% | 1.037590% | 1.211707% | 1.108113% |

MAE, RMSE, completeness, pass flags, every native/predicted pair and the original v1 failure are retained in `cohort-evaluation.json`. The v1 package remains unchanged at [the original pilot](../generic-htl-pilot/README.md). `local-perturbation-comparison.json` is the separate comparison against **v1**, not the v2 local-group error shown above. Its eight new locations had maximum errors of 2.005058%, 1.347822% and 1.850088% for energy, yield and climate impact. The center's native metrics matched the prior run at exported precision; no repeatability acceptance limit was preregistered.

## Use and accounting basis

Open [Local Aspen models](../../models.html) and use the reviewed v2 example/version when available, or import `project.json` and the model-result JSON files directly. The website reads derived data; it does not run Aspen or authenticate native execution from JSON labels.

The source is the same HR model at 25 MPa and 100 kg/h wet feed. Energy is declared purchased electricity per kg outlet catechol + o-cresol before separation; yield is target/feed mass ratio; climate impact uses the same target denominator and fixed foreground factors. Heater/reactor positive duties use efficiency 1 plus fixed pump inventory 2.172 kWh/h. Separator B6 heating and cooling-service burdens remain excluded. This is not whole-plant or independently validated background LCA. The older HTL lab uses a separate reference model and a per-100-kg-wet-feed energy display.

Native checks, prediction-error checks and physical validation are separate. No physical validation is claimed. The 81 finite scenario queries are rebound to v2; the v1 queries/rankings remain in their original package. Scenario/preference shares are not probabilities, continuous-region guarantees, or an operating-performance pass threshold.

## Files and source identities

- `profile.json`, `extension-plan.json`, `criteria.json`, `cohorts.json`, `scan-preregistration.json`: unchanged reviewed mapping, new 12-point plan, original criteria, full 37-point assignment and frozen design identities.
- `native-checks.json`, `project.json`, `dataset.json`: 38 source/check summaries, 37 unique process cases and audited response labels. Every retained warning and all source-batch identities remain visible.
- `model.bundle.json`, `evaluation.json`, `cohort-evaluation.json`, `summary.json`: frozen model, complete reserved-point evaluation, separate legacy/local/fresh reports and actual final status.
- `predictions.json`, `queries.json`, `robustness.json`, `scenario-config.json`, `scenario-preregistration.json`: v2-bound queries and finite scenarios using the existing design. The scenario preregistration records its original v1 origin; current v2 identity is in the result and summary.
- `local-perturbation-comparison.json`, `local-plan.json`, `local-mapping.json`, `local-preregistration.json`: separate frozen-v1 local evidence, including the center repeat.
- `index.json`: SHA256 and size of **every released JSON file except itself**. The source-derived JSON bytes were copied unchanged. The finalizer summary's `artifact_sha256` describes a different set of original local finalizer artifacts, including private audits that are not distributed here.

Relative `outputs/workspace-bilingual-20261117` and `runs/.../raw.json` strings are evidence namespaces, **not public download URLs**. Native `.bkp`/`.apw` archives, raw captures, source-hash files containing private paths, fit markers, local accounts and credentials are not included. File hashes bind artifacts; they do not independently certify native execution.

## Reproduce derived checks

Install the repository's Python/Node dependencies and run from the repository root. Choose new output names. These commands evaluate the frozen model; they do not fit again or execute Aspen.

```powershell
python -m process_pipeline.surrogate evaluate analysis_web/data/generic-htl-extension/model.bundle.json --output outputs/reproduced-v2.evaluation.json
python -m process_pipeline.robustness analysis_web/data/generic-htl-extension/model.bundle.json --config analysis_web/data/generic-htl-extension/scenario-config.json --output outputs/reproduced-v2.robustness.json
```

中文说明：**冻结模型通过声明的仿真误差检查，可在声明的训练支持域内进行常规预测。** 共 37 个唯一工况，按 20/3/14 分组；其中全新前瞻复核 4 点单列，不能以混合平均值掩盖某组失败。38 次原生记录包含中心重复工况，重复记录不增加独立坐标数。v1 与局部复核保留，原 5% 标准不变。运行/核算通过不代表物理验证；产率为目标产物与进料质量比，能耗和气候影响按每 kg 出口目标产物计。上述相对路径是证据命名空间，不是公开下载地址，数据包不含原生档案、原始运行文件或账户资料。
