# Local Aspen model workflow

This package connects a **reviewed steady-state Aspen Plus `.bkp` model** to the same energy/LCA calculation module used by Process Studio. It supports external process topologies, including closed recycle loops, after their input controls, stream connections, enthalpy basis, target product and external inventory have been mapped. It does not infer a valid LCA from an arbitrary native file.

The existing `htl_pipeline/` remains separate. The website prepares plans and displays exported data; it cannot execute `.bkp` or `.apw` files. Save an `.apw` model to a separate `.bkp` archive in Aspen before using this version.

## Requirements

- The core validator/normalizer uses Python 3.11+ standard-library features. **The pinned full scientific stack below requires Python 3.12+**, because its NumPy and SciPy releases do. The fresh-environment audit used Python 3.14.6 on Windows; Python 3.11 is not a compatible target for these pins.
- Install [Node.js](https://nodejs.org/en/download) separately and ensure `node --version` works in the terminal used to start Python. The shared calculation bridge invokes `node` from PATH. The audit used Node 26.3.0; Node is not installed by pip, and this static site has no npm build step.
- Native discovery/runs additionally need Windows and a locally installed, licensed Aspen Plus version compatible with the archive and with its COM class registered. Installing `pywin32` supplies the Python COM bindings; it does not install or license Aspen. `aspen_connection.create_aspen_document()` opens a new private document.
- The full requirement file includes NumPy, SciPy, scikit-learn, threadpoolctl and Windows pywin32, reusing the HTL requirements for pandas/joblib and the shared tooling. Pandas is needed by the existing HTL build tools, not the generic validator. Pip resolves their transitive dependencies; do not use `--no-deps` or install a package named `sklearn` in place of `scikit-learn`. See [SURROGATE.md](SURROGATE.md) for the prediction interface.

### Fresh Windows environment

From the repository root, use an existing Python 3.12+ interpreter. These commands deliberately invoke the new environment's executable directly, so no PowerShell activation-policy change is needed:

```powershell
python --version
node --version
python -m venv .venv-process
.\.venv-process\Scripts\python.exe -m pip install -r process_pipeline/requirements.txt
.\.venv-process\Scripts\python.exe -m pip check
.\.venv-process\Scripts\python.exe -c "import numpy, scipy, sklearn, pandas, threadpoolctl, pythoncom, win32com.client; print('Imports available; Aspen was not started')"
.\.venv-process\Scripts\python.exe -m process_pipeline.cli --help
```

Keep using `.\.venv-process\Scripts\python.exe` for the Python commands below, or activate that environment explicitly. Installing into another Python interpreter does not supply dependencies to this one. `pythoncom`/`win32com.client` are import names provided by pywin32, not separate pip packages. On non-Windows systems, requirements skip pywin32: validation, replay and surrogate analysis can be used, but native Aspen COM execution cannot.

The requirement file fixes the principal tested package versions; it is not an operating-system-independent lock of every transitive package. Record `python -m pip freeze` with a reproducible study. Instructions follow the official [venv](https://docs.python.org/3/library/venv.html) and [pip requirements-file](https://pip.pypa.io/en/stable/user_guide/#requirements-files) workflows.

Run commands from the repository root. Output paths below are illustrative absolute paths. Choose new or empty output directories; completed evidence is never deleted or overwritten.

## Support matrix

| Process/data feature | Current support and required mapping | Evidence boundary |
| --- | --- | --- |
| External steady-state `.bkp` model | Explicit node whitelist, units, ranges, status checks, topology and inventory. Discovery does not infer a complete profile. | Real native execution has been checked on the existing HTL model; an unrelated external model still needs its own copied-model pilot. |
| Closed recycle loop | Map every internal stream once with its actual endpoints. Internal transfers cancel at the external boundary; every block must also close. | The independent membrane/recycle fixture checks mixed units and local/boundary closure. The adapter does not select tear streams or repair Aspen convergence. |
| Multiple material substreams | Give each substream a distinct row/ID with its own mass and mass-specific enthalpy, or provide an explicitly reviewed total mass and total enthalpy flow. Include MIXED/CISOLID/NC only when their actual quantities and common basis are available. | An offline two-substream arithmetic check closes with one negative and one positive enthalpy rate. No automatic coverage or NC enthalpy-model validation. Never add TOTAL to its constituents, sum specific enthalpies, or claim MIXED means liquid phase. |
| Negative enthalpy reference | Signed total or mass-specific enthalpy is retained and converted. All connected rows need a compatible reference; mass rates remain nonnegative, with explicit endpoints. | Negative-reference core checks and the native HTL export cover arithmetic handling, not thermophysical accuracy. |
| Shaft work and cooling | Declare separate signed heat/work and units; positive means into the block, cooling/work export negative. A known zero must be explicit. | The external fixture has +2 kW work and −3 kW cooling. Purchased energy is a separately mapped inventory; negative-credit LCA is not implemented. |
| Multiple LCIA categories | Supply a sourced factor for each included inventory/category pair, with consistent method and impact unit. | Two-category arithmetic fixture; no bundled background database or automatic supply-chain inventory. Missing factors remain incomplete. |
| Scans and prediction | Independent numeric controls, identity-linked/fixed inputs, bounded plans and retained failures. Generic prediction requires enough accepted training data plus reserved validation, explicit criteria and covered query coordinates. | Numeric/contract checks and a model-specific native pilot are distinct. No automatic generalization to a new model or categorical/topology-changing controls. |
| Batch/transient, arbitrary scripts, direct browser `.bkp` execution | Outside this version; missing or incompatible mappings block acceptance. | No claim of support. |

For example, two incoming substreams at 8 kg/h × −450 kJ/kg and 2 kg/h × 1,800 kJ/kg have enthalpy rates −1 and +1 kW, totaling zero. Keep them as two rows, or map their total enthalpy rate. Adding the two specific enthalpies and multiplying by 10 kg/h would incorrectly give 3.75 kW. The quantity DSL has no implicit variable-by-variable product or mass-weighted averaging; the per-substream row representation lets the shared core perform each mass × specific-enthalpy conversion explicitly.

## 1. Inspect and review

```powershell
python -m process_pipeline.cli inspect-model --model "C:\models\process.bkp" --output "C:\analysis\discovery.json"
```

Discovery first copies the archive into `discovery-inspection/input.bkp`, then reads block/stream Input and Output branches and the global Run-Status Output branch. It does not call `Engine.Run`, write input nodes or save the source. Its node/depth budget is reported. Input leaves are candidates, not proof that writing them is safe or physically meaningful. The original hash is checked again after the private document closes.

The accompanying `discovery-profile-draft.json` has `review.state: "incomplete_draft"`; validation and planning reject it. Complete and review these declarations before changing the state to `"reviewed"`:

1. Model filename and its exact SHA-256; 1–20 numeric Input controls, exact case-sensitive native `UnitString`, and finite permitted ranges.
2. Required output readouts, explicit accepted solver codes, connections between named blocks/`BOUNDARY`, all material substreams, one common enthalpy basis, and signed external heat/work.
3. Target-product and feed rates, the 1 kg product functional unit, allocation, purchased-energy/material/emission/waste inventory, impact factors and their sources.

No arbitrary COM calls, expressions or executable snippets are accepted in profiles. A present review record must be `reviewed`. An omitted review record is permitted for a fully authored profile but does not bypass any metadata, path, unit or range check. A source hash establishes file identity, not model validity.

```powershell
python -m process_pipeline.cli validate-profile --profile "C:\analysis\profile.json" --model "C:\models\process.bkp"
```

`model.path` can be a portable filename in the profile. Native execution needs an absolute path, supplied with `--model` if necessary, and the declared hash must still match. The shipped HTL mapping was reviewed against a retained native export and copy-only inspection; its review record links both hashes and states the native adapter validation status. Its restricted inherited inventory is not whole-plant LCA. Fresh discovery always produces an incomplete draft.

## 2. Freeze a bounded plan

Use the site's **Local models** page (`analysis_web/models.html`) or author this JSON:

```json
{
  "plan_version": 1,
  "profile_id": "my-process",
  "model_sha256": "<the profile's 64-character lowercase SHA-256>",
  "points": [
    {"id": "case-001", "parameters": {"temperature_K": 590}, "split": "training"},
    {"id": "case-002", "parameters": {"temperature_K": 600}, "split": "holdout"}
  ]
}
```

Every point supplies exactly the reviewed independent variables in their declared native units. Assign `training`, `holdout` or `verification` before running. There is a hard cap of 100 points per job; a profile can lower it. Plan validation rejects invalid numbers, out-of-range values and duplicate case IDs. It does not infer operating constraints: prepare only a scientifically reviewed plan. A tiny example like this is not enough to train a surrogate.

Optional `linked_inputs` copy an independent input value to another declared Input node; the exact native unit must match. Optional `fixed_inputs` write one explicit finite constant. Neither adds an independent scan dimension. IDs and paths across all controls must be unique, and every control participates in the same preflight/write/readback checks. There are no expressions, conversions or chained links:

```json
{
  "linked_inputs": [{"id": "heater_temperature", "source_id": "temperature_K", "path": "\\Data\\Blocks\\HEATER\\Input\\TEMP", "native_unit": "K"}],
  "fixed_inputs": [{"id": "integration_tolerance", "path": "\\Data\\Blocks\\REACTOR\\Input\\INT_TOL", "native_unit": "", "value": 0.0001}]
}
```

```powershell
python -m process_pipeline.cli validate-profile --profile "C:\analysis\profile.json" --plan "C:\analysis\plan.json"
```

## 3. Run locally, retain evidence, import results

```powershell
python -m process_pipeline.cli scan --profile "C:\analysis\profile.json" --plan "C:\analysis\plan.json" --model "C:\models\process.bkp" --output "C:\analysis\job-001"
```

Each point runs serially in a separate worker and a fresh copy of the original archive. Every permitted input is preflighted for path, unit and finite value before any input is written. Values are read back before and after solving with relative tolerance `1e-8` and absolute tolerance `1e-9`. The declared timeout requests Aspen Stop; an unresponsive worker stops the remaining batch, records cleanup as unconfirmed and preserves the remaining planned rows as not attempted. No unrelated process is terminated.

Each case retains `input.bkp`, `point.json`, `raw.json`, `case-status.json`, worker log and, when export succeeds, `aspen-report.rep`. Normalized cases additionally have `project.json` and `assessment.json`. Root-level artifacts are:

| File | Purpose |
| --- | --- |
| `profile.json`, `plan.json` | Exact reviewed declarations and frozen requested cases. |
| `ledger.json` | Every planned ID, split, source, warnings, errors and separate acceptance gates. |
| `project.json` | Combined five-table project for the web importer, including `meta.scan_audit`. |
| `assessment.json` | Combined result from unchanged `analysis_web/universal-core.mjs`. |
| `dataset.json` | Versioned metrics, declared domains/units and all retained cases for optional prediction. |

Import the combined `project.json` through **Local models → Open in analysis**, or directly in **Process analysis**. Normalization failures are absent from calculable tables but remain visible in `meta.scan_audit` and the ledger. A case with incomplete factors or failed numerical closure is retained as diagnostic data and cannot become an accepted training row merely because other cases succeeded.

Acceptance has five separate gates: `control_succeeded`, `solver_accepted`, `numerical_closure`, `lcia_complete`, and `metric_inputs_complete`. Control means the automation returned. Native solver acceptance additionally requires all declared statuses and an exported report with an explicit English completion statement (normally or with warnings), without a detected nonconvergence/error. Missing or unrecognized report completion leaves the solver gate failed; warning records are retained. Localized report formats need an explicitly reviewed adapter extension. Neither gate establishes physical validation. All outputs keep `physical_validation: false`.

## Quantity mappings

The mapping emits the existing cases/streams/blocks/inventory/factors contract. Quantity objects are deliberately limited:

```json
{"readout": "heater_duty"}
{"constant": 0, "unit": "kW", "source": "Documented adiabatic boundary"}
{"sum": [{"readout": "product_a"}, {"readout": "product_b"}], "source": "Declared target product pools"}
{"positive": {"readout": "heater_duty"}, "source": "Only positive duty belongs to this purchased-heat inventory"}
{"scale": 1.25, "quantity": {"readout": "heater_duty"}, "source": "Documented inverse efficiency 1/0.8"}
```

Each displayed object is a separate alternative, not one JSON file. `scale` is a documented dimensionless multiplier; it does not rename units. `sum` requires identical native units. The shared JavaScript core performs dimension-aware conversion, including case-sensitive MW versus mW and an explicitly chosen calorie convention. Product and feed mappings must use the same native mass-rate unit. Utility efficiencies, background inventories and missing factors are never generated from equipment names.

## Replay without native execution

```powershell
python -m process_pipeline.cli replay --profile "C:\analysis\profile.json" --plan "C:\analysis\plan.json" --capture "C:\analysis\captures.json" --output "C:\analysis\replay-001"
```

Captures can be one raw record, an array, or `{ "captures": [...] }`. Records must match the profile/model identity, frozen inputs/split, all required native readout paths/units and post-run input evidence. A declared `profile_sha256` must match the entire reviewed profile. For compatibility, older captures without this field use profile ID, model hash and explicit node/input checks only; they do not have full profile-content binding. New native worker captures always include the profile digest. Missing captures remain failures. Replaying captured simulation evidence does not mean a fresh Aspen run occurred; arbitrary JSON provenance labels are not independent proof of native execution. Offline fixtures are explicitly labeled as such.

### Reproduce the independent recycle example

This example is hand-defined offline data, not a native membrane model. It exercises a 10 kg/h feed, 4 kg/h internal recycle, 10 kW heating, 2 kW shaft work, 3 kW cooling, mixed kg/h–kg/s–MJ/h–cal/s units, and two synthetic impact categories. It needs Python/Node, but does not open Aspen or require a model archive. From the repository root, export the existing test fixture into a new evidence directory:

```powershell
@'
import json
from pathlib import Path
from process_pipeline.tests.test_external_contract import fixture
profile, plan, capture, _ = fixture()
base = Path("outputs/external-recycle-demo").resolve()
base.mkdir(parents=True, exist_ok=False)
for name, value in [("profile.json", profile), ("plan.json", plan), ("captures.json", [capture])]:
    (base / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
print(base)
'@ | .\.venv-process\Scripts\python.exe -
$demoJob = Join-Path (Get-Location) 'outputs\external-recycle-demo\job'
.\.venv-process\Scripts\python.exe -m process_pipeline.cli replay --profile outputs/external-recycle-demo/profile.json --plan outputs/external-recycle-demo/plan.json --capture outputs/external-recycle-demo/captures.json --output $demoJob
```

Expected case `EXT-001`: all five arithmetic/input gates pass, purchased energy is **4 kWh/kg target**, target/feed is **0.3**, synthetic climate impact is **6.8/3 kg CO2-eq/kg**, and synthetic acidification is **0.152/3 mol H+-eq/kg**. Both mass and energy boundary residuals are zero to floating-point tolerance. The internal recycle does not appear in purchased inventory. `evidence_type` stays `offline_fixture` and `physical_validation` stays false. Import the generated `job/project.json` to inspect the same results on the website.

For retained failure behavior, run `python -m unittest process_pipeline.tests.test_external_contract -v`: it checks a missing native readout, an unsupplied planned capture and a missing factor without dropping their records. These synthetic checks do not establish an external flowsheet's native convergence or physical validity.

## Optional prediction and robustness

The [generic surrogate pilot](SURROGATE.md) fits complete accepted training rows only, keeps frozen holdout/verification records, and refuses ordinary prediction without explicit error criteria and passing validation. Predictions stay inside both the declared domain and training convex hull. Predicted metrics approximate audited outputs; they do not independently solve a new flowsheet, close its energy balance or assemble a new LCA inventory. The existing browser fuzzy-support and preference analyses remain separate from probabilistic uncertainty.

The [finite-scenario workflow](ROBUSTNESS.md) applies explicit operating perturbations and preference weights to a frozen model without refitting. Generate `scenario-results.json` locally, then import it through **Local models → Already have results? Open files → Choose model results JSON**. Use the separate combined-project input for `project.json`. Leading shares describe only the supplied scenarios/preferences, with shared credit for ties; they are not success probabilities. No operating-performance threshold is imposed, and unsupported scenarios retain their diagnostics rather than disappearing from the comparison.

```powershell
python -m process_pipeline.robustness outputs/model.bundle.json --config scenarios.json --output outputs/scenario-results.json
python serve_web.py
```

The preview opens at `http://127.0.0.1:8766`; it serves only the public frontend, rejects hidden configuration/native archive paths, and disables caching during local editing. It does not start Aspen or a surrogate computation.

## Verification

```powershell
python -m unittest process_pipeline.tests.test_profiles process_pipeline.tests.test_external_contract process_pipeline.tests.test_backend_review process_pipeline.test_surrogate -v
```

These checks use fake documents, explicit offline arithmetic fixtures and the real shared calculation core. They cover preserved original files, whitelist/unit gates, timeouts, retained failures, mixed units, recycle cancellation and multiple impact categories. A passing offline test is not a licensed native Aspen run.
