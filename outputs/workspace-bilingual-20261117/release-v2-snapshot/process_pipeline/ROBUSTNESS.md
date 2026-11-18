# Finite scenario analysis of frozen surrogate means

`robustness.py` compares operating perturbations and preference weights using an existing [surrogate bundle](SURROGATE.md). It never runs Aspen, fits a model, changes a training split or updates LCA factors. An impact response remains the quantity predicted by its frozen model under that model's original inventory and factor assumptions.

```powershell
python -m process_pipeline.robustness outputs/model.bundle.json --config scenarios.json --output outputs/scenario-results.json
```

The callable API is `analyze_robustness(bundle, config, allow_exploratory=False)`. A bundle whose ordinary prediction is disabled requires explicit `--allow-exploratory`; output remains marked `exploratory`. This opt-in never bypasses declared bounds, the actual training convex hull or response-domain checks. Invalid configuration/hash contracts stop with a structured error and CLI exit code 2. Valid requests containing unsupported queries return a diagnostic artifact with `rank_complete: false`.

## Configuration

```json
{
  "config_version": 1,
  "candidates": [
    {"id": "candidate-a", "inputs": {"temperature_K": 600, "length_m": 10}},
    {"id": "candidate-b", "inputs": {"temperature_K": 610, "length_m": 12}}
  ],
  "perturbations": {
    "temperature_K": {"unit": "K", "halfwidth": 1},
    "length_m": {"unit": "meter", "halfwidth": 0.25}
  },
  "scenarios": [
    {"id": "center", "offsets": {"temperature_K": 0, "length_m": 0}},
    {"id": "lower-both", "offsets": {"temperature_K": -1, "length_m": -1}},
    {"id": "higher-both", "offsets": {"temperature_K": 1, "length_m": 1}}
  ],
  "preferences": [
    {"id": "equal", "weights": {"energy": 1, "yield": 1, "climate": 1}}
  ],
  "max_total_queries": 1000
}
```

The names, units, widths and three-scenario design above are illustrative. Match the actual model declarations and choose scientifically justified perturbations for the intended use. The algorithm does not infer a tolerance, sampling distribution or all combinations from this list.

- Supply 2–50 candidates and all of the bundle's 1–6 continuous inputs. Every input requires an exact native-unit string and finite nonnegative `halfwidth`; zero is valid. An explicitly empty native input unit remains `""`, not a guessed `"1"`.
- Provide 1–256 unique normalized scenario vectors, each containing every input with offsets in `[-1,1]`, and exactly one all-zero center. Effective displacement vectors (`halfwidth × offset`) must also be distinct, including zeros caused by floating-point underflow. Duplicate effective scenarios are rejected, not silently merged or weighted; when all halfwidths are zero, only the center is allowed. For candidate `c`, scenario `s`, input `j`, the query is `c[j] + halfwidth[j] * offset[s,j]`. The same offset vector is applied to every candidate for that scenario comparison. This represents shared perturbations; it does not assert independent candidate fluctuations.
- Provide 1–256 preference sets, each assigning every model response a finite nonnegative weight; one or more weights must be positive. The explicit preference cap bounds scoring/output work separately from GP queries. Weights are normalized to sum to one. Minimize/maximize directions come from the model response declarations, not configuration guesses.
- Total queries are candidates × scenarios, including center. The default limit is 1,000; an explicit `max_total_queries` can raise it to 10,000. Requests over the budget stop rather than being silently subsampled. Every query follows the existing predictor's domain/hull/response checks.

The example [surrogate-demo.robustness.json](examples/surrogate-demo.robustness.json) matches the existing offline surrogate demo. It is an arithmetic/software demonstration, not Aspen or experimental evidence:

```powershell
python -m process_pipeline.robustness outputs/surrogate-demo.bundle.json --config process_pipeline/examples/surrogate-demo.robustness.json --output outputs/surrogate-demo.robustness.json --allow-exploratory
```

## What the statistics mean

Each candidate retains every scenario record, including errors. Complete candidates receive a per-response minimum, center prediction and maximum over exactly the supplied finite scenarios. The relative span is `100 × (max − min) / abs(nominal)`; a zero denominator returns `null` with a reason. Signed responses remain signed and valid zero responses remain zero. Incomplete coverage produces `null` min/max/span rather than a survivor-only interval. These sampled extrema are not guaranteed extrema of a continuous perturbation region, and they are not prediction/confidence intervals.

A nominal response close to zero can produce a very large finite relative span. This is a numerical description of width relative to that small denominator, not evidence of physical performance deterioration. Read it alongside the unit-bearing min/nominal/max values; the module adds no threshold or clipping. Unrepresentable relative spans return `null` with an explicit numerical reason.

For scoring, each response uses the **fixed nominal minimum and maximum across all requested candidates**. Utility increases with desirability according to the declared direction, is clamped to `[0,1]`, and is always `0.5` for a numerically constant response across nominal candidates. A nominal range is numerically constant when its span is at most `16 × machine epsilon × max(abs(min), abs(max))`. There is no unit-sized absolute floor: genuine differences such as `1e-20` versus `2e-20` remain distinguishable, while a few floating-point rounding units from equivalent unit conversions do not become an artificial full-scale preference. A preference score is the weighted sum of these utilities. Clamping can create ties at the fixed limits; both limits and the constant-metric convention are exported. Even if that numerically constant nominal response varies in perturbed scenarios, it stays at utility `0.5` because no nominal scoring range exists; its raw metric variation is still reported. Rankings are relative to this declared candidate set and weighting policy.

Scores within absolute tolerance `1e-12` form tied groups, ordered descending. Each group is anchored to its highest score, so a chain of near-equal neighboring values cannot merge scores farther apart than the tolerance. Tied candidates receive average ranks. For each preference, output includes nominal rank, minimum/maximum rank across selected scenarios, and scenario-wise Spearman agreement with the nominal ranking. Spearman is the Pearson correlation of these tie-aware average ranks; a constant rank vector returns `null`, not a perfect correlation.

Every scenario gives its tied leaders an equal fraction of one top-place credit. Those credits are averaged over the supplied scenario list and reported as `top_share_pct`; each preference sums to 100%, subject to floating-point display rounding. This is a fraction of the **selected deterministic scenarios**, not an operating success probability or physical reliability measure. High global Spearman agreement alone does not establish stable front ranks.

If **any** candidate/scenario is unsupported or invalid, the complete global ranking is withheld for **all** preferences (`rank_complete: false`, `preferences: []`). Candidate coverage and raw query errors remain visible. No candidate is silently removed and no “best robust option” is chosen from survivors. There is no pass/fail operating threshold.

## Result contract and lineage

The `kind: "process_robustness"` result includes:

- Model, source dataset, profile, source native model, bundle and effective configuration hashes; a canonical `result_sha256` binds the result payload excluding that field.
- Unchanged input/response declarations, effective configuration, center scenario ID, candidate coverage/metric summaries, and all candidate/scenario query identities and outputs.
- Fixed nominal scoring anchors, per-preference rank summaries, per-scenario scores/ranks/top IDs/Spearman, and explicit calculation conventions.
- `native_execution_performed: false`, `model_refitted: false`, `background_lca_recomputed: false`, `physical_validation: false`, and the inherited exploratory/evidence status.

Hashes establish internal linkage, not independent proof that uploaded JSON originated in a native simulation. Preserve the source runner ledger and raw exports. The means do not capture GP uncertainty; scenario sensitivity cannot validate the simulator, establish full-domain accuracy, or justify LCA backgrounds outside the source model's assumptions.

The site's **Local models → Explore models, predictions and scenarios** panel accepts this result through the same JSON picker as surrogate bundles and predictions. Choose a response for the min/center/max plot and a preference for rank ranges/leading shares. Candidate tables retain all candidates; the query table pages through all requests or all retained failures. Missing or inconsistent query identities/coverage reject the file and clear old results. This is display-contract validation, not a new model run, hash authentication or independent scientific validation.

Run the hand-computed and real-predictor regression checks with:

```powershell
python -m unittest process_pipeline.test_robustness -v
```
