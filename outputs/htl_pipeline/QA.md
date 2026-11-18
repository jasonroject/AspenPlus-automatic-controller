# HTL pipeline verification — 2026-11-17

- Commit pushed: 321c235, main, jasonroject/AspenPlus-automatic-controller.
- Vercel deployment: dpl_GMJ8j25QPwyrRniUwx8BTCaYBLUz, ready.
- Public page: https://vercel-pi-ten-59.vercel.app/pipeline.html
- Unauthenticated artifact request returned HTTP 200, version htl-pilot-20261117, prediction_enabled=true, 3 fresh runs, 4,941 prediction cells.
- Ego space 2: opened published page, title HTL Studio | Prediction & Robustness; HR leader 340 °C / 7 m, top-1 29.3%, top-5 87.6%, rank interval 1–6. Final page retained for user.
- Local controls exercised: valid condition 335 °C/12.5 m, HR/STD switch, 400 °C rejection, stale-results clearing, robustness scenario and nominal-rank sort, candidate Inspect, evidence navigation, report-warning details, original Case Data backlink and new sidebar entry.
- Downloaded browser-analysis.json compared structurally equal to the local artifact; browser-scan-plan.json exactly matches selected point and its two intended neighbours. Downloaded plan was inspected, not launched as an additional scan.
- Layout: 390 px all three sections had scrollWidth=390; 1130 px checked robustness; 1440 px screenshots inspected. These are emulated layouts, not device certification.
- Seven scientific regression checks passed, including deliberate invalid units/mass balance, accounting identity and rank-frequency conservation. JavaScript syntax and Python compilation passed; staged diff whitespace check passed.
- Source model hashes remain 4c93329ad8d44a44857ee63e18b4a1567aa7762aa1c4b9929b09d325e7021bed (continuous-field copy) and 91965a901c1074cc6e0d47a9b614d9cd54df18e4841bf0de248e143a66edac0f (older manuscript backup).
- Native warnings for COOLER, REACTOR and VALVE retained; numerical acceptance is not physical validation. No other Aspen model supported yet. No fresh openLCA run, no online native-Aspen execution, no experimentally calibrated reliability probability.
