# HTL scan, prediction and ranking stability

Completed simulator pilot: 2026-11-17. Web entry: `../analysis_web/pipeline.html`.

## Execution and data

`run_scan.py` executes a bounded design sequentially in fresh Aspen Plus V15 documents. It copies the private reference model, reads back inputs, exports reports and stream/block data, and retains failures. It never attaches to an already-open user document. `build.py train` fits positive log-response Gaussian processes; RBF versus Matérn 5/2 is selected by four-fold training-only cross-validation. Inputs are scaled reciprocal absolute temperature and log tube length. `build.py analyze` audits native outputs, checks reserved holdouts, exports 4,941 predictions and computes ranking stability. The website queries that precomputed grid and downloads scan plans/results. Native execution remains local; Vercel does not run Aspen.

The five files in `reference/` are unchanged copies from the completed `continuous_field_20261114` research package: 121 accepted native conditions, comprising 90 training rows, 28 reserved holdouts and 3 extremum verifications. HR electricity has 75 training rows because 15 historical STD rows lack HR duties. The original 100–350 °C training field is reused, while **this website is restricted to 310–350 °C and 5–20 m**. Only 10 of the 28 holdouts lie inside that displayed domain; reported holdout errors use those 10. Holdouts, old extrema and fresh verification points never enter fitting or kernel selection.

Private reference model SHA-256: `4c93329ad8d44a44857ee63e18b4a1567aa7762aa1c4b9929b09d325e7021bed`. This is the continuous-field project's `source_HR.bkp`, distinct from the earlier manuscript backup. Neither backup is overwritten. `reference/protocol.json` describes the earlier source study; this README and the exported artifact describe the new pilot's narrower deployment domain and kernel selection.

Basis: 100 kg wet model-compound feed in 1 h, fixed composition, 25 MPa, fixed tube diameter/count and kinetics/thermophysical model. Target monomers are catechol plus o-cresol across the final outlets; kg/h numerically equals kg/100 kg wet feed. This is not isolated-product recovery or measured biomass yield. Actual temperature uses K = °C + 273.15; manuscript labels used +273. Native heat uses 4.1868 J/cal; the older website used 4.184. Original `study.json` remains unchanged.

## Energy and climate accounting

Heat is converted to equivalent electricity with the inherited unity conversion assumption. On the one-hour basis:

```
STD kWh = max(0, H(S3)-H(S2)) + max(0, reactor kW) + 2.172
HR  kWh = max(0, heater kW)    + max(0, reactor kW) + 2.172
CF = [51.981210438152665
      + 0.6750590250697887 × electricity kWh
      + direct CO2 kg + 36 × direct CH4 kg
      + 0.1733357121112475 × wastewater kg / 1000] / target kg
```

Fresh native runs use HR flowsheets. STD energy is reconstructed from their no-heat-recovery preheat boundary, **not independent fresh STD flowsheet runs**. Fixed pump inventory 2.172 kWh and background factors are retained; water mass/1000 is the inherited wastewater volume approximation. This is foreground climate accounting, not a new openLCA run or multi-impact LCIA. The archived 330 °C / 10 m inventory offset (−0.0291604 kg CO2-eq) remains recorded in the coefficients file.

## Verification

Fresh conditions: 325 °C / 8.5 m, 335 °C / 12.5 m, 345 °C / 7.5 m. Each ran in a separate document at INT_TOL=1e-4 and MAX_NSTEP=100000. All completed with warnings for COOLER, REACTOR and VALVE; warnings are retained. Numerical gates require finite positive target output, component masses >=−1e-10 kg/h, mass residual <=0.01 kg/h, C/H/O relative residual <=0.001 and maximum device energy residual <=0.01 kW. Fresh maxima were 0.00030902 kg/h, 5.085e-6 relative and 8.248e-7 kW. Closure does not demonstrate thermophysical or experimental validity.

| Response | In-domain holdout max APE | Fresh max APE |
| --- | ---: | ---: |
| Target monomers | 0.607% | 0.727% |
| STD electricity | 0.135% | 0.444% |
| HR electricity | 1.100% | 1.986% |
| STD CF | 0.641% | 0.966% |
| HR CF | 0.567% | 1.151% |

Release checks require all three initial fresh points and all fresh numerical checks to pass, fresh max APE <=5%, and holdout median APE <=2% / P95 APE <=5% for each response. These are model-quality checks, **not operating-performance thresholds**. Failed native cases are retained and disable predictions in a subsequent export. Four historical failed attempts and their successful retry status remain in the artifact.

## Robustness without performance thresholds

266 interior candidates (312–348 °C every 2 °C; 6–19 m every 1 m), each evaluated under 1,024 common scenarios, seed 20261117. Independent uniform assumptions: temperature ±2 °C, effective tube length ±0.25 m, electricity factor ±10%. Effective length is exploratory contact-path variation, not measured geometry error. Complete perturbation boxes stay inside the domain; no boundary clipping.

STD and HR separately show P05/P50/P95 output intervals, nominal rank, rank intervals and top-1/top-5 frequencies. Score weights are one third each for higher monomer output, lower electricity and lower CF, with nominal min/max scales held fixed. Energy and CF are correlated objectives; these weights are a preference choice, not a universal optimum. First/second sample-half frequency differences are a sampling diagnostic.

HR's nominal leader is 340 °C / 7 m: top-1 29.30%, top-5 87.60%, rank P05–P95 1–6. Intervals: target 6.079–6.291 kg/100 kg feed; energy 14.543–15.672 kWh; CF 10.024–10.401 kg CO2-eq/kg target. STD's nominal leader is 312 °C / 16 m, top-1 61.72%. These are conditional surrogate scenario rankings. GP posterior, kinetic and property uncertainties are not jointly propagated, and the newly ranked leaders have not been independently rerun as finalists.

## Reproduce

Run from repository root. Native execution requires licensed Aspen Plus V15 COM on Windows and the private reference model. Raw native reports and model backups are not distributed.

```powershell
python -m pip install -r htl_pipeline/requirements.txt
python htl_pipeline/build.py train
python htl_pipeline/run_scan.py --model "C:/path/to/private/source_HR.bkp"
python htl_pipeline/build.py analyze
python -m unittest discover -s htl_pipeline -p test_pipeline.py -v
python -m http.server 8766 --bind 127.0.0.1 --directory analysis_web
```

For a downloaded plan:

```powershell
python htl_pipeline/run_scan.py --design "C:/path/to/htl-scan-plan.json"
python htl_pipeline/build.py analyze
```

Plans accept 1–100 finite in-domain points, at most two decimal places. Completed cases are cached; failed or mismatched existing records stop for inspection. Preserve failed evidence before any explicit retry. Keep the initial three points; additional scans remain validation data and do not automatically retrain or alter the frozen split. Any accuracy failure disables the new export.

Generated models, raw reports, grid, comparisons and browser evidence live in `outputs/htl_pipeline/`. Deployable artifact: `analysis_web/data/pipeline.json`. `probe.py` is a separate earlier-manuscript anchor diagnostic, not this pipeline's entry point.

Seven regression checks cover independent CF arithmetic, extrapolation rejection, warning capture, deliberate unit/mass-balance failures, split separation, grid accounting and ranking conservation. Ego checks cover prediction/scenario switching, bounds rejection, downloaded plan, ranking sorting/inspection, evidence tabs and responsive layout. Screenshots stay local.
