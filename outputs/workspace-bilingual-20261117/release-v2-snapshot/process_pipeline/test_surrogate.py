"""Synthetic contracts exercise behavior; they are not evidence for real Aspen models."""
import copy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import numpy as np
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import ConstantKernel, Matern, WhiteKernel

from process_pipeline.profile import canonical_hash
from process_pipeline.surrogate import GATES, SurrogateError, audit_dataset, fit, evaluate, predict


def dataset_fixture(evidence='native_simulation'):
    """The native flag is deliberately declared test input, not a real execution claim."""
    training = [(-1., -1.), (-1., 0.), (-1., 1.), (0., -1.), (0., 1.), (1., -1.), (1., 0.), (1., 1.)]
    cases = [('training', point) for point in training]+[('holdout', (0., 0.)), ('holdout', (.25, .5)), ('verification', (-.5, .25))]
    rows = []
    for index, (split, (x, y)) in enumerate(cases):
        rows.append({'id': f'synthetic-{index}', 'split': split, 'inputs': {'x': x, 'y': y},
                     'outputs': {'energy': 10+2*x+3*y, 'signed_heat': 2*x-3*y, 'zero_impact': 0.},
                     'gates': dict.fromkeys(GATES, True), 'accepted': True, 'source': f'fixture/{index}.json',
                     'evidence_type': evidence, 'error': None, 'warnings': ['Synthetic arithmetic fixture; no Aspen run']})
    dataset = {'dataset_version': 1, 'profile_id': 'synthetic-arithmetic-fixture',
               'profile_sha256': 'a'*64, 'model_sha256': 'b'*64, 'evidence_type': evidence,
               'inputs': [{'id': 'x', 'unit': '1', 'min': -1., 'max': 1.}, {'id': 'y', 'unit': '1', 'min': -1., 'max': 1.}],
               'responses': [{'id': 'energy', 'unit': 'kWh/kg', 'direction': 'min', 'value_domain': 'nonnegative'},
                             {'id': 'signed_heat', 'unit': 'kW', 'direction': 'min', 'value_domain': 'signed'},
                             {'id': 'zero_impact', 'unit': 'kg CO2-eq/kg', 'direction': 'min', 'value_domain': 'nonnegative'}],
               'rows': rows}
    return seal_dataset(dataset)


def seal_dataset(dataset):
    dataset['dataset_sha256'] = canonical_hash({key: value for key, value in dataset.items() if key != 'dataset_sha256'})
    return dataset


def acceptance_config():
    return {'criteria': {'energy': {'unit': 'kWh/kg', 'max_mae': .1, 'max_rmse': .15},
                         'signed_heat': {'unit': 'kW', 'max_mae': .1, 'max_rmse': .15, 'max_relative_error': .5, 'relative_floor': .1},
                         'zero_impact': {'unit': 'kg CO2-eq/kg', 'max_mae': 0., 'max_rmse': 0.}}}


class SurrogateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dataset = dataset_fixture()
        cls.config = acceptance_config()
        cls.bundle = fit(cls.dataset, cls.config)

    def test_declared_native_fixture_passes_explicit_error_checks_without_physical_claim(self):
        self.assertTrue(self.bundle['validation']['passed'], self.bundle['validation']['reasons'])
        self.assertTrue(self.bundle['prediction_enabled'])
        self.assertEqual(self.bundle['readiness']['accepted_counts'], {'training': 8, 'holdout': 2, 'verification': 1})
        self.assertIn('JSON alone does not prove Aspen execution', self.bundle['lineage_statement'])
        report = predict(self.bundle, [{'x': 0., 'y': .5}])
        self.assertTrue(report['all_queries_supported'])
        self.assertAlmostEqual(report['records'][0]['outputs']['energy'], 11.5, delta=.1)
        self.assertAlmostEqual(report['records'][0]['outputs']['signed_heat'], -1.5, delta=.1)
        self.assertEqual(report['records'][0]['outputs']['zero_impact'], 0.)
        self.assertEqual(report['records'][0]['kind'], 'prediction')

    def test_source_hash_and_coordinate_split_leakage_fail_closed(self):
        bad = copy.deepcopy(self.dataset); bad['rows'][0]['outputs']['energy'] += 1
        with self.assertRaisesRegex(SurrogateError, 'contract'): audit_dataset(bad)
        bad = copy.deepcopy(self.dataset); bad['rows'][8]['inputs'] = copy.deepcopy(bad['rows'][0]['inputs']); seal_dataset(bad)
        with self.assertRaises(SurrogateError) as error: audit_dataset(bad)
        self.assertTrue(any('duplicate input coordinates' in issue for issue in error.exception.issues))

    def test_rehashed_bundle_cannot_hide_contradictory_release_claims(self):
        from process_pipeline.surrogate import _seal
        changes = [{'evidence_type': 'offline_fixture'}, {'validation': {'passed': False}},
                   {'status': 'exploratory'}, {'prediction_enabled': False}]
        for changed in changes:
            bundle = copy.deepcopy(self.bundle); bundle.update(changed); _seal(bundle)
            with self.assertRaisesRegex(SurrogateError, 'contradict'):
                predict(bundle, [{'x': 0., 'y': 0.}], allow_exploratory=True)

    def test_twelve_training_three_holdout_two_verification_remain_independent(self):
        dataset = dataset_fixture('offline_fixture')
        additions = [('training', (-.75, .5)), ('training', (.5, -.5)),
                     ('training', (-.5, -.5)), ('training', (.25, -.25)),
                     ('holdout', (.1, -.1)), ('verification', (.7, .3))]
        for index, (split, (x, y)) in enumerate(additions):
            row = copy.deepcopy(dataset['rows'][0])
            row.update(id=f'split-contract-{index}', split=split, inputs={'x': x, 'y': y},
                       outputs={'energy': 10+2*x+3*y, 'signed_heat': 2*x-3*y, 'zero_impact': 0.})
            dataset['rows'].append(row)
        seal_dataset(dataset)
        bundle = fit(dataset, acceptance_config())
        self.assertEqual(bundle['readiness']['counts'], {'training': 12, 'holdout': 3, 'verification': 2})
        expected_training = {row['id'] for row in dataset['rows'] if row['split'] == 'training'}
        self.assertEqual(set(bundle['model']['training_case_ids']), expected_training)
        self.assertEqual(len(bundle['observations']), 17)
        self.assertEqual(bundle['validation']['splits']['holdout']['expected'], 3)
        self.assertEqual(bundle['validation']['splits']['verification']['expected'], 2)
        self.assertTrue(bundle['validation']['passed'], bundle['validation']['reasons'])
        changed = copy.deepcopy(dataset)
        for row in changed['rows']:
            if row['split'] == 'verification': row['outputs']['energy'] += 100
        seal_dataset(changed)
        refitted = fit(changed, acceptance_config())
        self.assertEqual(refitted['model_sha256'], bundle['model_sha256'])
        self.assertTrue(refitted['validation']['splits']['holdout']['metrics']['energy']['passed'])
        self.assertFalse(refitted['validation']['splits']['verification']['metrics']['energy']['passed'])
        frozen_before = copy.deepcopy(bundle)
        evaluation = evaluate(bundle, dataset=changed)
        self.assertEqual(bundle, frozen_before)
        self.assertFalse(evaluation['passed'])
        self.assertEqual(evaluation['model_sha256'], bundle['model_sha256'])
        self.assertEqual([row['split'] for row in evaluation['records']].count('verification'), 2)

    def test_invalid_accepted_response_is_rejected_instead_of_dropped(self):
        for value in [None, -1.]:
            bad = copy.deepcopy(self.dataset); bad['rows'][0]['outputs']['energy'] = value; seal_dataset(bad)
            with self.assertRaises(SurrogateError) as error: fit(bad, self.config)
            self.assertTrue(any('not silently removed' in issue for issue in error.exception.issues))

    def test_failed_training_row_is_retained_with_reasons(self):
        dataset = copy.deepcopy(self.dataset)
        row = copy.deepcopy(dataset['rows'][0]); row.update(id='failed-extra', inputs={'x': -.2, 'y': .7}, accepted=False, error='Solver did not converge')
        row['gates']['solver_accepted'] = False; row['outputs'] = dict.fromkeys(row['outputs'], None)
        row['evidence_type'] = 'unverified_capture'
        dataset['rows'].append(row); seal_dataset(dataset)
        bundle = fit(dataset, self.config)
        self.assertTrue(bundle['prediction_enabled'])
        self.assertEqual(len(bundle['observations']), 12)
        self.assertEqual(bundle['readiness']['excluded_rows'][0]['id'], 'failed-extra')
        self.assertIn('solver_accepted', bundle['readiness']['excluded_rows'][0]['reasons'])
        self.assertIn('unverified_or_different_evidence_type', bundle['readiness']['excluded_rows'][0]['reasons'])
        self.assertEqual(len(bundle['model']['training_case_ids']), 8)

    def test_failed_verification_blocks_release_and_remains_in_evaluation(self):
        dataset = copy.deepcopy(self.dataset); row = dataset['rows'][-1]
        row['accepted'] = False; row['gates']['numerical_closure'] = False; row['error'] = 'Energy residual failed'
        row['outputs'] = dict.fromkeys(row['outputs'], None); seal_dataset(dataset)
        bundle = fit(dataset, self.config)
        self.assertFalse(bundle['prediction_enabled'])
        self.assertEqual(bundle['validation']['splits']['verification']['valid'], 0)
        self.assertIsNone(bundle['validation']['records'][-1]['predicted'])
        with self.assertRaises(SurrogateError): predict(bundle, [{'x': 0., 'y': 0.}])
        self.assertTrue(predict(bundle, [{'x': 0., 'y': 0.}], allow_exploratory=True)['exploratory'])

    def test_offline_demo_and_absent_criteria_require_explicit_exploratory_opt_in(self):
        demo = fit(dataset_fixture('offline_fixture'), self.config)
        self.assertTrue(demo['validation']['passed']); self.assertFalse(demo['prediction_enabled'])
        self.assertEqual(demo['status'], 'offline_fixture_demo')
        with self.assertRaises(SurrogateError): predict(demo, [{'x': 0., 'y': 0.}])
        self.assertEqual(predict(demo, [{'x': 0., 'y': 0.}], True)['evidence_type'], 'offline_fixture')
        exploratory = fit(self.dataset)
        self.assertFalse(exploratory['prediction_enabled'])
        self.assertTrue(any('no explicit acceptance criterion' in reason for reason in exploratory['validation']['reasons']))

    def test_units_relative_floor_and_predicted_rows_are_not_guessed(self):
        config = copy.deepcopy(self.config); config['criteria']['energy']['unit'] = 'kW'
        with self.assertRaisesRegex(SurrogateError, 'unit'): fit(self.dataset, config)
        config = copy.deepcopy(self.config); del config['criteria']['signed_heat']['relative_floor']
        with self.assertRaisesRegex(SurrogateError, 'relative_floor'): fit(self.dataset, config)
        with self.assertRaisesRegex(SurrogateError, 'units'): predict(self.bundle, [{'x': 0., 'y': 0.}], units={'x': 'K', 'y': '1'})
        dataset = copy.deepcopy(self.dataset); dataset['rows'][0]['evidence_type'] = 'prediction'; seal_dataset(dataset)
        with self.assertRaises(SurrogateError): fit(dataset, self.config)

    def test_explicit_empty_aspen_input_unit_is_preserved(self):
        dataset = copy.deepcopy(self.dataset); dataset['inputs'][0]['unit'] = ''; seal_dataset(dataset)
        bundle = fit(dataset, self.config)
        self.assertEqual(bundle['model']['inputs'][0]['unit'], '')
        self.assertTrue(predict(bundle, [{'x': 0., 'y': 0.}], units={'x': '', 'y': '1'})['all_queries_supported'])
        with self.assertRaisesRegex(SurrogateError, 'units'):
            predict(bundle, [{'x': 0., 'y': 0.}], units={'x': '1', 'y': '1'})

    def test_affine_readiness_is_invariant_to_disparate_native_unit_scales(self):
        dataset = copy.deepcopy(self.dataset)
        dataset['inputs'] = [{'id': 'x', 'unit': 'Pa', 'min': 0., 'max': 1e9},
                             {'id': 'y', 'unit': '', 'min': 0., 'max': 1e-8}]
        for row in dataset['rows']:
            row['inputs'] = {'x': (row['inputs']['x']+1)*5e8, 'y': (row['inputs']['y']+1)*5e-9}
        raw = np.array([[row['inputs']['x'], row['inputs']['y']] for row in dataset['rows'] if row['split'] == 'training'])
        self.assertEqual(np.linalg.matrix_rank(raw-raw.mean(axis=0)), 1)
        seal_dataset(dataset); bundle = fit(dataset, self.config)
        self.assertTrue(bundle['prediction_enabled'])
        values = predict(bundle, [{'x': 5e8, 'y': 5e-9}], units={'x': 'Pa', 'y': ''})['records'][0]['outputs']
        self.assertAlmostEqual(values['energy'], 10., delta=.1)
        self.assertAlmostEqual(values['signed_heat'], 0., delta=.1)

    def test_malformed_json_shapes_fail_with_structured_errors(self):
        for value in [None, [], {'rows': [None]}]:
            with self.assertRaises(SurrogateError): audit_dataset(value)
        dataset = copy.deepcopy(self.dataset); dataset['rows'][0] = None; seal_dataset(dataset)
        with self.assertRaises(SurrogateError) as error: audit_dataset(dataset)
        self.assertTrue(any('JSON object' in issue for issue in error.exception.issues))
        with self.assertRaises(SurrogateError): predict(None, [{'x': 0., 'y': 0.}])

    def test_model_or_bundle_corruption_disables_prediction(self):
        bad = copy.deepcopy(self.bundle); bad['model']['regressors']['energy']['dual_coefficients'][0] += 1
        with self.assertRaisesRegex(SurrogateError, 'Model hash mismatch'): predict(bad, [{'x': 0., 'y': 0.}])
        bad = copy.deepcopy(self.bundle); bad['validation_policy']['energy']['max_mae'] = 100
        with self.assertRaisesRegex(SurrogateError, 'Bundle hash mismatch'): predict(bad, [{'x': 0., 'y': 0.}])

    def test_declared_bounds_and_actual_training_hull_reject_extrapolation(self):
        result = predict(self.bundle, [{'x': 1.01, 'y': 0.}, {'x': 0., 'y': 0.}])
        self.assertFalse(result['all_queries_supported']); self.assertIsNone(result['records'][0]['outputs'])
        self.assertTrue(result['records'][1]['constraints_passed'])
        dataset = dataset_fixture()
        points = [(-1., -1.), (-1., 0.), (-1., 1.), (0., -1.), (0., 0.), (1., -1.), (-.5, -.5), (-.8, -.6)]
        for row, (x, y) in zip(dataset['rows'][:8], points):
            row['inputs'] = {'x': x, 'y': y}; row['outputs'].update(energy=10+2*x+3*y, signed_heat=2*x-3*y)
        for row, (x, y) in zip(dataset['rows'][8:], [(-.75, .25), (-.5, -.25), (-.25, -.5)]):
            row['inputs'] = {'x': x, 'y': y}; row['outputs'].update(energy=10+2*x+3*y, signed_heat=2*x-3*y)
        seal_dataset(dataset); bundle = fit(dataset, self.config)
        result = predict(bundle, [{'x': 1., 'y': 1.}], allow_exploratory=True)
        self.assertFalse(result['records'][0]['constraints_passed'])
        self.assertIn('convex hull', result['records'][0]['errors'][0])

    def test_plain_json_mean_matches_sklearn_with_nontrivial_white_kernel(self):
        config = {**self.config, 'noise_level': .2}
        bundle = fit(self.dataset, config)
        state = bundle['model']; inputs = [row['inputs'] for row in self.dataset['rows']]+[{'x': -.1, 'y': .6}]
        restored = predict(json.loads(json.dumps(bundle)), inputs, allow_exploratory=True)
        scaled = (np.array([[point['x'], point['y']] for point in inputs])-state['input_scaler']['mean'])/state['input_scaler']['scale']
        for spec in state['responses']:
            saved = state['regressors'][spec['id']]
            kernel = ConstantKernel(saved['constant_value'], 'fixed')*Matern(saved['length_scale'], 'fixed', nu=2.5)+WhiteKernel(saved['white_noise_level'], 'fixed')
            estimator = GaussianProcessRegressor(kernel=kernel, alpha=saved['alpha'], normalize_y=True, optimizer=None)
            estimator.fit(state['training_inputs_scaled'], [row['outputs'][spec['id']] for row in self.dataset['rows'] if row['split'] == 'training'])
            expected = estimator.predict(scaled)
            np.testing.assert_allclose([row['outputs'][spec['id']] for row in restored['records']], expected, rtol=1e-9, atol=1e-10)

    def test_evaluation_preserves_frozen_model_and_rejects_other_profile(self):
        before = json.dumps(self.bundle, sort_keys=True)
        report = evaluate(self.bundle)
        self.assertTrue(report['passed']); self.assertEqual(before, json.dumps(self.bundle, sort_keys=True))
        dataset = copy.deepcopy(self.dataset); dataset['profile_id'] = 'another-profile'; seal_dataset(dataset)
        with self.assertRaisesRegex(SurrogateError, 'different'): evaluate(self.bundle, dataset)


if __name__ == '__main__':
    unittest.main()
