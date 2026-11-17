# General process import, balances, LCIA and fuzzy evaluation

Entry: `analysis_web/universal.html`. User guide and formulas: `analysis_web/universal-guide.html`. Calculation core: `analysis_web/universal-core.mjs`, shared by browser and Node tests.

This module accepts steady-state process exports with no HTL-specific equations/factors. CSV/TSV, values-only XLS/XLSX, the version-1 five-table JSON contract, and this repository's legacy Aspen JSON are accepted. Legacy JSON lacking topology/enthalpy is staged with explicit blanks. The mapping editor supports header-row selection, transposed property tables, bilingual aliases and edit-distance suggestions; reviewed mappings and constants remain editable. Files stay in browser memory, never uploaded. Save the normalized project to retain work.

Five tables: Streams, Blocks, Cases, Inventory, Factors. All inventories are rates per hour; functional basis is 1 kg declared target product. Factor method, unit and source are mandatory for complete characterization. Multiple supplied impact categories are supported; absent factors remain visible and prevent complete-category claims. Calorie conventions and shaft-work signs must be explicit. Detailed supported units, substream/enthalpy requirements and formulas are in the web guide.

Fuzzy input triples propagate through Cartesian alpha-cut interval arithmetic at five levels. These are possibility bounds, not confidence intervals or Monte Carlo probabilities. Weighted low/medium/high desirability memberships evaluate purchased-energy intensity, selected impact and target/feed mass yield. Nominal min/max anchors are fixed during interval evaluation; ties/overlap can produce broad possible ranks. Numerical nonclosure and incomplete selected-category inventory exclude cases from ranking. User confirmation records comparability of function/boundary/allocation. This release does not infer correlations, database factors, allocation methods or missing duties.

Unsupported: native Aspen binary simulation in browser; batch/transient accumulation; KE/PE terms; arbitrary report interpretation without mapping; molar enthalpy without molecular-weight conversion; negative credits/system expansion; non-mass functional units; automatic utility efficiency/fuel LHV conversion; automatic background database expansion. Source-model validity remains separate from numerical closure.

## Validation and reproducibility

```powershell
node --test universal_pipeline/core.test.mjs
python -X utf8 universal_pipeline/build_examples.py
python -m http.server 8766 --bind 127.0.0.1 --directory analysis_web
```

The synthetic example has independently hand-checkable heat balances and two illustrative impact categories; its factors are not environmental database evidence. The native HTL example is built from the original T325p00_L8p50 raw JSON, inherits explicit fixed-background factors and records the source-model SHA-256 and native warnings. The pure general calculation reproduces its separately audited foreground carbon footprint. Rebuilding that fixture requires local private raw outputs; the committed fixture can be tested without Aspen.

The HTL fixture preserves the older accounting scope: heater/reactor electricity and fixed pump inventory, with feed/direct-gas/wastewater burdens. Separator heat and cooling-service burdens are excluded explicitly in its displayed boundary. It demonstrates reproduction of the declared inventory, not a complete whole-plant LCA. The general energy balance still reports every declared external block duty, including separator heat.

Twelve tests cover hand arithmetic/alpha bounds, mixed units and calorie conventions, signed enthalpy/conflicting definitions, missing values/nonclosure, recycle cancellation, missing or inconsistent factors, allocation, invalid fuzzy supports and zero weights, Unicode/quoted CSV mapping, duplicate IDs and unsupported bases, legacy missing-data preservation, and actual native HTL equivalence. Browser interaction evidence is stored locally under `outputs/universal_pipeline/`.

SheetJS CE 0.20.3 is vendored from its authoritative CDN, with license in `analysis_web/vendor/LICENSE-SheetJS.txt`. Methods/source references are linked in the guide, including NIST, JRC ILCD, scikit-fuzzy and the Scientific Agent Skills paper used for unit-review guidance.
