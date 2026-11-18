# Local native perturbation comparison

One preselected coordinate-center neighborhood: **8 new coordinates + 1 repeated original holdout**. The original model and 81-query scenario export remain frozen.

New coordinates: 8/8 usable; declared error checks passed. All nine: 9/9 usable.

| Response | Unit | New-eight maximum relative error | Original criterion |
|---|---|---:|---:|
| purchased_energy_kWh_kg | kWh/kg | 2.005058% | 5.0% |
| yield_fraction | 1 | 1.347822% | 5.0% |
| impact:Climate change | kg CO2-eq/kg | 1.850088% | 5.0% |

Relative error uses each original unit-specific floor. Any missing native or prediction row blocks a complete group pass; all failed rows remain in the JSON.

The center repeats original holdout `case-008` and is reported separately as execution repeatability. It is not a ninth new location.

**No model promotion.** In the original two-point independent-verification group, 335 °C / 8.5 m exceeded the 5% policy for all three responses; 345 °C / 17.5 m passed all three. The group therefore remains not passed. This local check does not enable the model, refit it, validate global candidate ranks, assign probabilities, validate background LCA, or demonstrate physical reliability.

Frozen model SHA-256: `79033d782d9212c5ec846c4d99b9de078daf3415fc3df96162534dbe88339283`
Comparison SHA-256: `ad8ea8ad70999a82a2f397548d4b7c147238452c275fcc47b235eb06003c6f81`
