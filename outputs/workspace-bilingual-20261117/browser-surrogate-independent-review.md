# Browser surrogate independent source review

Reviewed `analysis_web/browser-surrogate.mjs` against `process_pipeline/surrogate.py`, the frozen public v2 bundle, and the new numerical regression source. No numerical algorithm, posterior, public evidence file, or training split was changed. No COM, fit, HTTP check, or old numerical suite was rerun.

## Conclusion

No release-blocking mismatch was found for the byte-verified published HTL v2 bundle.

- Both use the ordinary frozen Matérn 5/2 posterior mean: scaled distance divided by declared length scales, constant times `(1 + sqrt(5)*r + 5*r*r/3)*exp(-sqrt(5)*r)`, dot product with frozen dual coefficients, then output scale and mean.
- White noise is not added to query/training cross covariance, including an exact training-coordinate query. It was already part of the fitted training covariance.
- Browser preparation validates the training-only input mean and population standard deviation against the raw training coordinates, then validates the supplied standardized coordinates. It copies posterior arrays and freezes exposed declarations; subsequent source-object edits do not change an already prepared posterior.
- Queries require complete finite numeric inputs and exact native unit strings. The current published controls are reactor temperature `K`, bounds 583.15–623.15, and tube length `meter`, bounds 5–20. No automatic unit conversion or silent input clipping occurs.
- Qualification is explicitly required. Missing shapes, inconsistent metadata/units, nonfinite kernel/scaler state, duplicate coordinates/IDs, unsupported dimensions and exact degenerate support are rejected. Returned values must meet finite/positive/nonnegative/signed and declared min/max response rules; disallowed values are not clipped.
- The module returns frozen surrogate means with `native_execution_performed=false`, `model_refitted=false`, `uncertainty_estimated=false`, and `physical_validation=false`. It does not recompute an energy balance or LCA inventory.

## Training support and deliberate scope limits

One-dimensional support uses the same scaled `1e-10` interval tolerance as Python. The browser's two-dimensional gate uses convex CCW edge half-planes expanded by `1e-8 * (|dx|+|dy|)` plus axis bounds: an L-infinity tolerance envelope. Python instead asks HiGHS for convex-combination feasibility and then checks coordinate and weight-sum residuals at `1e-8`. The tolerances share a stated scale, but extreme solver/numerical boundary decisions should not be advertised as bit-for-bit equivalent.

The **actual released v2 contains all four corners of its declared two-input rectangle among the 20 training points**. Consequently its convex hull fills the declared rectangle; the strict declared input bounds govern public queries, avoiding the above thin-boundary distinction for this released model.

The browser intentionally supports only 1–2 inputs and always requires explicit units; Python supports up to 6 inputs and can omit the units argument. The browser rejects unqualified bundles, while the local CLI has an explicit exploratory option. These are narrower browser capabilities, not a promise of general Python API parity.

The evaluator validates hash formats, not canonical artifact digests or native provenance. It must remain behind the separately reviewed original-byte SHA256/size gate for the public v2 package. User-uploaded model bundles do not receive query permission.

## Evidence and verification

The numerical agent's new test source covers 121 frozen query locations × 3 responses, exact training queries, a nonrectangular triangle, 1D support, unit mismatch, malformed posterior, invalid response domains and prepared-object immutability. Its reported maximum differences from the frozen Python means were approximately 2.95e-12 absolute and 2.89e-13 relative. This review inspected those cases and formulas without duplicating that run.

The completed original-byte gate's separate 11 tests include the BOM counterexample and delayed-hash lifecycle races; see `published-query-guard-review.md`.

Documentation changes add the exact UI actions `Try a condition`, `Calculate estimate`, and `Save estimate JSON`, K/m units, bounds/hull restriction, reimportable result JSON, and the distinction from a new Aspen/LCA run. Other uploaded model predictions still use the local CLI. The same short scope note was added to both relevant READMEs. Only the four changed documentation-helper tests were rerun; 4/4 passed, and the scoped whitespace check passed.
