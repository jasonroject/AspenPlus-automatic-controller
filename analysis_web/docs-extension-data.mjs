// Reviewed values derived from data/generic-htl-extension; source hashes are checked by site.test.mjs.
export const extensionEvidence={
  "summary": {
    "version": "v2-extension",
    "unique_native_cases": 37,
    "accepted_unique_cases": 37,
    "native_runs_retained": 38,
    "counts": {
      "training": 20,
      "holdout": 3,
      "verification": 14
    },
    "prediction_enabled": true,
    "validation_passed": true,
    "exploratory": false,
    "fit_attempts": 1,
    "criteria_changed": false,
    "original_splits_changed": false,
    "old_files_unchanged": true,
    "physical_validation": false,
    "model_sha256": "0ae413ef6cb13ac09abccdb37d060103eb94b4488b65310e8eadef3d1d6903bf",
    "baseline_model_sha256": "79033d782d9212c5ec846c4d99b9de078daf3415fc3df96162534dbe88339283"
  },
  "cohort_evaluation": {
    "model_sha256": "0ae413ef6cb13ac09abccdb37d060103eb94b4488b65310e8eadef3d1d6903bf",
    "prediction_enabled": true,
    "cohorts": {
      "legacy_holdout_3": {
        "expected": 3,
        "prospectively_reserved_for_v2": false,
        "metrics": {
          "purchased_energy_kWh_kg": {
            "unit": "kWh/kg",
            "expected": 3,
            "valid_pairs": 3,
            "complete": true,
            "mae": 0.023763161393353105,
            "rmse": 0.027671394137089512,
            "max_relative_error": 0.015437342146556385,
            "relative_floor": 0.01,
            "criterion": 0.05,
            "passed": true
          },
          "yield_fraction": {
            "unit": "1",
            "expected": 3,
            "valid_pairs": 3,
            "complete": true,
            "mae": 0.0003087639476128783,
            "rmse": 0.00034576729520477157,
            "max_relative_error": 0.008545865639752221,
            "relative_floor": 0.001,
            "criterion": 0.05,
            "passed": true
          },
          "impact:Climate change": {
            "unit": "kg CO2-eq/kg",
            "expected": 3,
            "valid_pairs": 3,
            "complete": true,
            "mae": 0.0745632801135514,
            "rmse": 0.0854832458330785,
            "max_relative_error": 0.008368428191174905,
            "relative_floor": 0.01,
            "criterion": 0.05,
            "passed": true
          }
        }
      },
      "legacy_verification_2": {
        "expected": 2,
        "prospectively_reserved_for_v2": false,
        "metrics": {
          "purchased_energy_kWh_kg": {
            "unit": "kWh/kg",
            "expected": 2,
            "valid_pairs": 2,
            "complete": true,
            "mae": 0.017120335791662056,
            "rmse": 0.021472236741076057,
            "max_relative_error": 0.012390090922659181,
            "relative_floor": 0.01,
            "criterion": 0.05,
            "passed": true
          },
          "yield_fraction": {
            "unit": "1",
            "expected": 2,
            "valid_pairs": 2,
            "complete": true,
            "mae": 0.0003780020605030597,
            "rmse": 0.0004633150211722032,
            "max_relative_error": 0.01052598232303656,
            "relative_floor": 0.001,
            "criterion": 0.05,
            "passed": true
          },
          "impact:Climate change": {
            "unit": "kg CO2-eq/kg",
            "expected": 2,
            "valid_pairs": 2,
            "complete": true,
            "mae": 0.06094526683059165,
            "rmse": 0.07612183650130583,
            "max_relative_error": 0.010375901138481919,
            "relative_floor": 0.01,
            "criterion": 0.05,
            "passed": true
          }
        }
      },
      "local_verification_8": {
        "expected": 8,
        "prospectively_reserved_for_v2": false,
        "metrics": {
          "purchased_energy_kWh_kg": {
            "unit": "kWh/kg",
            "expected": 8,
            "valid_pairs": 8,
            "complete": true,
            "mae": 0.04043282546606536,
            "rmse": 0.04146580631863332,
            "max_relative_error": 0.021747243427309774,
            "relative_floor": 0.01,
            "criterion": 0.05,
            "passed": true
          },
          "yield_fraction": {
            "unit": "1",
            "expected": 8,
            "valid_pairs": 8,
            "complete": true,
            "mae": 0.0005055164848906096,
            "rmse": 0.000517527834762961,
            "max_relative_error": 0.010868824420491927,
            "relative_floor": 0.001,
            "criterion": 0.05,
            "passed": true
          },
          "impact:Climate change": {
            "unit": "kg CO2-eq/kg",
            "expected": 8,
            "valid_pairs": 8,
            "complete": true,
            "mae": 0.08754551956625689,
            "rmse": 0.09140536527202468,
            "max_relative_error": 0.012117068315895527,
            "relative_floor": 0.01,
            "criterion": 0.05,
            "passed": true
          }
        }
      },
      "prospective_verification_4": {
        "expected": 4,
        "prospectively_reserved_for_v2": true,
        "metrics": {
          "purchased_energy_kWh_kg": {
            "unit": "kWh/kg",
            "expected": 4,
            "valid_pairs": 4,
            "complete": true,
            "mae": 0.006876995256198781,
            "rmse": 0.007009348044924911,
            "max_relative_error": 0.003447298394845694,
            "relative_floor": 0.01,
            "criterion": 0.05,
            "passed": true
          },
          "yield_fraction": {
            "unit": "1",
            "expected": 4,
            "valid_pairs": 4,
            "complete": true,
            "mae": 0.0003079337859152025,
            "rmse": 0.0004481197175962983,
            "max_relative_error": 0.013526195023085578,
            "relative_floor": 0.001,
            "criterion": 0.05,
            "passed": true
          },
          "impact:Climate change": {
            "unit": "kg CO2-eq/kg",
            "expected": 4,
            "valid_pairs": 4,
            "complete": true,
            "mae": 0.062203329842851485,
            "rmse": 0.07374323683101336,
            "max_relative_error": 0.01108113023219526,
            "relative_floor": 0.01,
            "criterion": 0.05,
            "passed": true
          }
        }
      }
    }
  },
  "local_comparison": {
    "model_sha256": "79033d782d9212c5ec846c4d99b9de078daf3415fc3df96162534dbe88339283",
    "new_eight": {
      "expected": 8,
      "valid_pairs": 8,
      "complete": true,
      "metrics": {
        "purchased_energy_kWh_kg": {
          "unit": "kWh/kg",
          "expected": 8,
          "valid_pairs": 8,
          "complete": true,
          "mae": 0.03742212268200462,
          "rmse": 0.03830825284500328,
          "max_relative_error": 0.020050579607058316,
          "relative_floor": 0.01,
          "max_relative_error_criterion": 0.05,
          "passed": true
        },
        "yield_fraction": {
          "unit": "1",
          "expected": 8,
          "valid_pairs": 8,
          "complete": true,
          "mae": 0.00041917243901183187,
          "rmse": 0.0005115575696185392,
          "max_relative_error": 0.013478220523189961,
          "relative_floor": 0.001,
          "max_relative_error_criterion": 0.05,
          "passed": true
        },
        "impact:Climate change": {
          "unit": "kg CO2-eq/kg",
          "expected": 8,
          "valid_pairs": 8,
          "complete": true,
          "mae": 0.1003612016891211,
          "rmse": 0.11932334891520531,
          "max_relative_error": 0.018500884324931795,
          "relative_floor": 0.01,
          "max_relative_error_criterion": 0.05,
          "passed": true
        }
      }
    },
    "model_refitted": false,
    "model_qualification_changed": false,
    "center_repeat": {
      "id": "local-05",
      "original_point_id": "case-008",
      "original_split": "holdout",
      "available": true,
      "metrics": {
        "purchased_energy_kWh_kg": {
          "unit": "kWh/kg",
          "original": 2.6261657378409473,
          "repeated": 2.6261657378409473,
          "signed_difference": 0.0,
          "absolute_difference": 0.0,
          "relative_difference": 0.0
        },
        "yield_fraction": {
          "unit": "1",
          "original": 0.06060042552121615,
          "repeated": 0.06060042552121615,
          "signed_difference": 0.0,
          "absolute_difference": 0.0,
          "relative_difference": 0.0
        },
        "impact:Climate change": {
          "unit": "kg CO2-eq/kg",
          "original": 10.547501675749563,
          "repeated": 10.547501675749563,
          "signed_difference": 0.0,
          "absolute_difference": 0.0,
          "relative_difference": 0.0
        }
      },
      "scope": "Repeated execution at an already held-out coordinate, not a new independent validation location. Differences are descriptive; no repeatability acceptance limit was preregistered."
    }
  },
  "source_sha256": {
    "summary.json": "c3b0cfbd7bb238f32190ebb109247bfe81e38b50ff23ca8fc417a1be8202d9e4",
    "cohort-evaluation.json": "da4b50088aaff189ebda8d4df0a1ad35800ae649857e887b03a70c3e5036e8bc",
    "local-perturbation-comparison.json": "97ee937be1a7a1505bec7b2c1915069f6dae98c1b81f045f68fda7f9f0ec9b13"
  }
};
