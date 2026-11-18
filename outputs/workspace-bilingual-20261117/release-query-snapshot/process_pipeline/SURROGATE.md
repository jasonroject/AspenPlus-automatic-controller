# Generic mean-only surrogate pilot

Use this module after a reviewed model profile and scan runner have produced a canonical `dataset.json`. It does not run Aspen, infer missing units, split data automatically, or turn one imported flowsheet into a qualified predictor. The existing HTL surrogate and its training split remain separate.

## Run it

From the repository root, use Python 3.12 or later and install the scientific stack in [requirements.txt](requirements.txt):

```powershell
python -m pip install -r process_pipeline/requirements.txt
```

```powershell
python -m process_pipeline.surrogate fit path/to/dataset.json --config path/to/criteria.json --output outputs/model.bundle.json
python -m process_pipeline.surrogate evaluate outputs/model.bundle.json --output outputs/model-evaluation.json
python -m process_pipeline.surrogate predict outputs/model.bundle.json --points path/to/queries.json --output outputs/predictions.json
```

`evaluate --dataset another-dataset.json` checks additional declared holdout/verification records against the frozen model without fitting. Its profile/model identity, variable declarations, units and evidence type must match; validation coordinates cannot overlap training. `--config criteria.json` changes only the reported evaluation policy, not the fitted model or its previously issued qualification. A new evaluation report does not silently promote the original bundle.

The callable API is `fit(dataset, config)`, `evaluate(bundle, dataset=None, criteria=None)` and `predict(bundle, points, allow_exploratory=False, units=None)` in `process_pipeline.surrogate`. Invalid contracts raise `SurrogateError` with an explicit `issues` list. CLI failures return exit code 2 and a JSON error to stderr.

## Input contract

The module consumes the adapter's version 1 dataset:

```json
{
  "dataset_version": 1,
  "profile_id": "my-process",
  "profile_sha256": "<64 lowercase hex characters>",
  "model_sha256": "<source Aspen archive SHA-256>",
  "evidence_type": "native_simulation",
  "inputs": [{"id": "temperature", "unit": "K", "min": 580, "max": 620}],
  "responses": [{"id": "heat", "unit": "kW", "direction": "min", "value_domain": "signed"}],
  "rows": [{
    "id": "case-001", "split": "training",
    "inputs": {"temperature": 580}, "outputs": {"heat": -2.5},
    "gates": {"control_succeeded": true, "solver_accepted": true,
      "numerical_closure": true, "lcia_complete": true, "metric_inputs_complete": true},
    "accepted": true, "source": "runs/case-001/raw.json",
    "evidence_type": "native_simulation", "error": null, "warnings": []
  }],
  "dataset_sha256": "<canonical hash excluding this field>"
}
```

This abbreviated example illustrates fields, not a sufficiently large fitting dataset. Use `process_pipeline.profile.canonical_hash` to compute digests: sorted keys, compact separators, UTF-8 with non-ASCII preserved, and no NaN/Infinity. Dataset checks confirm internal consistency. A declared source hash or `native_simulation` label in an arbitrary JSON file does **not** independently prove that Aspen ran; preserve runner logs and original exports for that evidence.

Cases retain their explicit frozen `training`, `holdout` or `verification` split. Duplicate IDs or input coordinates are blocked, including cross-split duplicates; repeated runs require reviewed consolidation before this first surrogate version. Predictions cannot enter the native training dataset. Failed runs remain in the observations and exclusion ledger with reasons. Failed holdout/verification runs prevent qualification, so it cannot pass on surviving cases alone. Missing or invalid values on an accepted row block fitting instead of silently removing that row.

Response domains are explicit: `positive`, `nonnegative` or `signed`, with optional finite `min`/`max`. Signed heat and zero responses are supported through ordinary response normalization. The current adapter's purchased-energy, yield and factor-impact responses declare `nonnegative`; its impact calculation does not implement avoided-burden credits. This surrogate does not relax those declarations.

## Acceptance criteria and bounds

Every response requires an explicit unit-matched prediction-error criterion to enable normal predictions:

```json
{
  "criteria": {
    "heat": {"unit": "kW", "max_mae": 0.2, "max_rmse": 0.3,
             "max_relative_error": 0.1, "relative_floor": 0.05}
  }
}
```

These numbers are illustrative, not recommended acceptance limits. Choose limits for the intended use before reviewing validation errors. Supply at least one of `max_mae`, `max_rmse`, or `max_relative_error`; if several are supplied, all must pass. Relative error is `abs(prediction-actual) / max(abs(actual), relative_floor)`, with an explicitly supplied positive denominator floor in response units. Zero actual values are never dropped. Without criteria for every response, the bundle remains `exploratory` and ordinary prediction is disabled.

Minimum training size is `max(6, 2*d+2)` complete unique cases for `d` declared inputs; at least two reserved holdout cases are required. Training must span all declared dimensions. These are engineering readiness checks, not accuracy or physical guarantees. This pilot caps training at 500 points and supports at most six continuous inputs. Categorical variables, automatic model search and high-dimensional extrapolation are outside this version.

Every prediction must lie within both the declared input bounds and the actual training convex hull. Convex-combination feasibility is checked with a linear program rather than treating a bounding box as data coverage. Unsupported requests stay in the result with errors; they are not rounded, clipped or extrapolated. Predicted responses are also checked against their declared domains without clipping.

Query files contain numeric values interpreted in the declared model units:

```json
{"units": {"temperature": "K"}, "points": [{"temperature": 600}]}
```

Explicit units, when provided, must match exactly. No implicit conversion occurs.
An explicitly declared empty input unit (`""`) from a dimensionless Aspen node is preserved and must be queried as `""`, not silently relabeled as `"1"`. Response units remain explicit non-empty strings.

## Model, output and demonstration

Each response uses a fixed Matérn 5/2 kernel family with a constant amplitude and fixed WhiteKernel numerical nugget. Input standardization, response normalization and hyperparameter optimization use **training rows only**; no holdout-based family selection occurs. Optimizer warnings remain in the bundle. The default normalized-output nugget variance is `1e-8`; an explicit `noise_level` changes this numerical assumption, not a reported physical uncertainty.

The bundle stores plain JSON kernel parameters, normalized training coordinates, dual coefficients, response scales, source identity, observations, failed cases and validation results. `model_sha256` covers the model state; `bundle_sha256` covers the entire bundle. Hash changes block loading unless a producer deliberately regenerates a consistent bundle; these hashes provide integrity, not an external signature. Restored posterior means are checked against scikit-learn, including training-coordinate queries where WhiteKernel must not contribute to cross-covariance. No confidence bands are exported.

For web visualization, use `observations` for native/synthetic input points and `validation.records` for the paired `actual` and `predicted` values with `split`, `source`, constraints and errors. Never relabel the latter as new native simulations. Prediction result records carry `kind: prediction`, the model hash, input coordinates, declared response units, and `constraints_passed`. An energy or impact predictor approximates the supplied response labels; it does not independently enforce a fresh energy balance or rerun LCA at each query.

`examples/surrogate-demo.dataset.json`, `.criteria.json` and `.queries.json` provide a small arithmetic **offline fixture**. It can pass its illustrative error tests but cannot be qualified as a native model. To inspect its means explicitly:

```powershell
python -m process_pipeline.surrogate fit process_pipeline/examples/surrogate-demo.dataset.json --config process_pipeline/examples/surrogate-demo.criteria.json --output outputs/surrogate-demo.bundle.json
python -m process_pipeline.surrogate predict outputs/surrogate-demo.bundle.json --points process_pipeline/examples/surrogate-demo.queries.json --output outputs/surrogate-demo.predictions.json --allow-exploratory
python -m unittest process_pipeline.test_surrogate -v
```

The `--allow-exploratory` flag preserves all bounds/response constraints and marks every output as exploratory. It does not bypass malformed data, digest failures, unit mismatches or extrapolation checks.
