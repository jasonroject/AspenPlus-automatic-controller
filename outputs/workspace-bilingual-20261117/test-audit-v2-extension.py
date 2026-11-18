"""Independent audit helper checks against offline data; no fit or native run."""
from copy import deepcopy
import json
from pathlib import Path
import runpy
import unittest

BASE = Path(__file__).resolve().parent
MODULE = runpy.run_path(str(BASE/'audit-v2-extension.py'))
BUNDLE = json.loads((BASE.parents[1]/'universal_pipeline/fixtures/surrogate-demo.bundle.json').read_text(encoding='utf-8'))
TRAINING = [row for row in BUNDLE['observations'] if row['split'] == 'training' and row['accepted']]


class IndependentV2AuditTests(unittest.TestCase):
    def test_scalar_training_covariance_matches_existing_offline_posterior(self):
        MODULE['training_equations'](BUNDLE['model'], TRAINING)
        for row in BUNDLE['validation']['records']:
            if row['constraints_passed']:
                MODULE['HELPERS']['prediction_values'](BUNDLE['model'], row['inputs'], row['predicted'], row['id'])

    def test_changed_scaling_or_coefficient_fails_independent_training_equations(self):
        model = deepcopy(BUNDLE['model']); model['input_scaler']['mean'][0] += .5
        with self.assertRaisesRegex(ValueError, 'training input mean'):
            MODULE['training_equations'](model, TRAINING)
        model = deepcopy(BUNDLE['model']); key = model['responses'][0]['id']; model['regressors'][key]['dual_coefficients'][0] += 1
        with self.assertRaisesRegex(ValueError, 'covariance equation'):
            MODULE['training_equations'](model, TRAINING)

    def test_cohort_maximum_error_and_zero_denominator_floor(self):
        rows = [{'constraints_passed': True, 'actual': {'x': 0}, 'predicted': {'x': .0004}},
                {'constraints_passed': True, 'actual': {'x': 2}, 'predicted': {'x': 2.12}}]
        response = {'id': 'x', 'unit': 'kW'}; criterion = {'relative_floor': .01, 'max_relative_error': .05}
        report = {'unit': 'kW', 'expected': 2, 'valid_pairs': 2, 'complete': True, 'relative_floor': .01, 'criterion': .05,
                  'mae': .0602, 'rmse': ((.0004**2+.12**2)/2)**.5, 'max_relative_error': .06, 'passed': False}
        MODULE['metric_check'](rows, response, criterion, report)
        report['passed'] = True
        with self.assertRaisesRegex(ValueError, 'maximum-error check'):
            MODULE['metric_check'](rows, response, criterion, report)

    def test_incomplete_cohort_cannot_keep_survivor_statistics(self):
        rows = [{'constraints_passed': True, 'actual': {'x': 1}, 'predicted': {'x': 1}}, {'constraints_passed': False}]
        response = {'id': 'x', 'unit': 'kW'}; criterion = {'relative_floor': .01, 'max_relative_error': .05}
        report = {'unit': 'kW', 'expected': 2, 'valid_pairs': 1, 'complete': False, 'relative_floor': .01, 'criterion': .05,
                  'mae': None, 'rmse': None, 'max_relative_error': None, 'passed': False}
        MODULE['metric_check'](rows, response, criterion, report)
        report['mae'] = 0
        with self.assertRaisesRegex(ValueError, 'survivor-only'):
            MODULE['metric_check'](rows, response, criterion, report)


if __name__ == '__main__':
    unittest.main()
