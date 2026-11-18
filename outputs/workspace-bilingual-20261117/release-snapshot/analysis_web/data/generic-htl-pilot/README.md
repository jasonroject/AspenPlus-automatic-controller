# HTL native pilot: inspect the full workflow

This public package exercises the generic local Aspen adapter and the browser workflow with **17 copied-model native runs**. All 17 passed the declared control-readback, solver, numerical-balance, factor-coverage and metric-input checks. Retained warnings concern COOLER, REACTOR and VALVE; this is simulation evidence, not experimental or physical validation.

**The frozen surrogate remains exploratory.** In the two-point independent verification group, the 335 °C / 8.5 m point exceeded the prospective 5% relative-error criterion for all three responses; 345 °C / 17.5 m passed all three. Regular prediction is disabled. The prediction and finite-scenario files were generated with explicit exploratory opt-in; that does not make the model qualified.

| Maximum relative error | Reserved holdout, 3 points | Independent verification, 2 points |
| --- | ---: | ---: |
| Purchased-energy intensity | 1.4443% | 5.7618% |
| Target/feed yield | 0.7308% | 9.7716% |
| Declared climate impact | 1.3345% | 9.5367% |

The 12 training points alone determine the GP. The 3 holdout points and 2 off-grid verification points were assigned before the scan. Their assignments, criteria and floors were not changed after seeing results. The implementation uses a fixed Matérn 5/2 family with training-only hyperparameter optimization; there was no holdout-based model selection.

## Try it in the website

1. Open [Local Aspen models](../../models.html), select **Already have results?**, then **Try the 17-case HTL pilot**.
2. Review the five reported check counts. Select **Open this scan in analysis** and calculate balances and impacts. The 17-case selector and source tables remain available.
3. Return to **Local Aspen models → Explore models, predictions and scenarios**. **Model checks** shows observations, frozen groups, supplied/predicted pairs and the failed independent checks. **Mean predictions** and **Scenario ranges** remain explicitly exploratory.

The website reads derived JSON; it does not execute Aspen, authenticate uploaded run claims, fit a new model or infer missing LCA factors.

## Accounting basis

The source is an HR flowsheet at 25 MPa with 100 kg/h wet feed. The two scanned controls are reactor temperature (native K; 310–350 °C) and tube length (5–20 meter). Heater temperature is identity-linked to the reactor; integration settings are fixed and read back. These are the profile's reviewed controls, not an automatic interface for every Aspen model.

The generic response `purchased_energy_kWh_kg` is the declared electricity inventory divided by target-product mass. The inherited inventory uses nonnegative heater and reactor duties as electricity with efficiency 1, plus a fixed 2.172 kWh/h pump inventory. It excludes separator B6 heating and cooling-service burdens. The target is outlet catechol plus o-cresol, without purification. Climate accounting uses the profile's fixed feed/electricity/direct-emission/wastewater factors; it is not complete whole-plant LCA or a newly queried background database.

Equipment diagrams show signed heat/work in kW. Those duties and purchased-energy inventory have distinct boundaries. The older HTL reference lab also shows energy per 100 kg wet feed over 1 h; its frozen model is separate from this 17-point generic pilot.

## Files and reproducibility

- `project.json`: all normalized process tables and the imported run ledger.
- `dataset.json`, `profile.json`, `plan.json`: model inputs, responses, mappings and frozen split.
- `model.bundle.json`, `evaluation.json`: portable mean-only GP and all validation records.
- `predictions.json`: three declared queries, retained with exploratory labels.
- `robustness.json`, `scenario-config.json`: 9 candidates × 9 shared deterministic offsets, with 3 preference sets. Ranges and first-place shares are properties of these finite scenarios, not probabilities, guaranteed extrema or physical reliability.
- `native-checks.json`: recorded local execution/check summaries, report hashes, original-source/copy identity and cleanup status.
- `scan-preregistration.json`, `scenario-preregistration.json`: original prospective manifests. Subsequent software fixes reject contradictory bundle declarations and treat floating-point-equivalent scoring anchors as constant; they do not change training labels, GP predictions, frozen points or criteria.
- `index.json`: byte hashes of the released JSON files. Hashes link files; they do not independently certify native execution.

With the repository's Python dependencies and Node installed, run these commands **from the repository root** to reproduce the derived analysis from `dataset.json`. Choose new output names if those files already exist:

```powershell
python -m process_pipeline.surrogate fit analysis_web/data/generic-htl-pilot/dataset.json --config analysis_web/data/generic-htl-pilot/criteria.json --output outputs/reproduced.bundle.json
python -m process_pipeline.surrogate evaluate outputs/reproduced.bundle.json --output outputs/reproduced.evaluation.json
python -m process_pipeline.robustness outputs/reproduced.bundle.json --config analysis_web/data/generic-htl-pilot/scenario-config.json --allow-exploratory --output outputs/reproduced.robustness.json
```

Native `.bkp` archives, commercial licenses and local raw execution directories are not distributed here. A native rerun requires the exact source archive named by the profile hash, a compatible licensed Windows Aspen installation, and the local adapter. Preserve the original failed error checks when extending this pilot.

中文说明：17 个原生点均通过声明的运行与核算检查，但通用代理模型的独立复核误差未达到预设标准。因此保留探索性标记、全部失败记录与有限情景结果，不将其宣传为已验证的通用预测模型，也不把情景占比解释成概率。
