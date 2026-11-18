"""Hand-computed scenarios plus real GP gates; never execute Aspen/COM."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from scipy.stats import spearmanr

from process_pipeline.profile import canonical_hash
from process_pipeline.robustness import analyze_robustness, _ranks, _spearman, _utility
from process_pipeline.surrogate import SurrogateError, _seal, _x, fit
from process_pipeline.test_surrogate import acceptance_config, dataset_fixture, seal_dataset


def configuration():
    return {'config_version': 1,
            'candidates': [{'id': name, 'inputs': {'x': x, 'y': 0.}} for name, x in [('A', -.5), ('B', 0.), ('C', .5)]],
            'perturbations': {'x': {'unit': '1', 'halfwidth': .5}, 'y': {'unit': '1', 'halfwidth': 0.}},
            'scenarios': [{'id': 'left', 'offsets': {'x': -1., 'y': 0.}},
                          {'id': 'center', 'offsets': {'x': 0., 'y': 0.}},
                          {'id': 'right', 'offsets': {'x': 1., 'y': 0.}}],
            'preferences': [{'id': 'curvature', 'weights': {'energy': 0., 'signed_heat': 1., 'zero_impact': 0.}},
                            {'id': 'constant', 'weights': {'energy': 0., 'signed_heat': 0., 'zero_impact': 1.}}]}


def arithmetic_mean(state, values):
    _x(state, values)  # Preserve the actual native-domain and training-hull gates.
    return {'energy': 0., 'signed_heat': values['x']**2-1., 'zero_impact': 0.}


class RobustnessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundle = fit(dataset_fixture('offline_fixture'), acceptance_config())

    def analyze(self, config=None, bundle=None, function=arithmetic_mean):
        with patch('process_pipeline.surrogate._mean', side_effect=function):
            return analyze_robustness(bundle or self.bundle, config or configuration(), allow_exploratory=True)

    def test_hand_computed_signed_values_zero_denominator_rank_ranges_and_top_shares(self):
        result = self.analyze()
        self.assertTrue(result['rank_complete'])
        self.assertTrue(result['exploratory'])
        self.assertEqual(result['query_count'], 9)
        summary = {row['id']: row for row in result['candidates']}
        self.assertEqual(summary['B']['metrics']['signed_heat']['nominal'], -1.)
        self.assertEqual(summary['B']['metrics']['signed_heat']['min'], -1.)
        self.assertEqual(summary['B']['metrics']['signed_heat']['max'], -.75)
        self.assertEqual(summary['B']['metrics']['signed_heat']['relative_span_pct'], 25.)
        self.assertAlmostEqual(summary['A']['metrics']['signed_heat']['relative_span_pct'], 100/.75)
        self.assertIsNone(summary['A']['metrics']['energy']['relative_span_pct'])
        self.assertEqual(summary['A']['metrics']['energy']['relative_span_reason'], 'zero_nominal_denominator')
        preference = result['preferences'][0]
        ranks = {row['id']: row for row in preference['candidates']}
        self.assertEqual([ranks[key]['nominal_rank'] for key in 'ABC'], [2.5, 1., 2.5])
        self.assertEqual([ranks[key]['rank_min'] for key in 'ABC'], [1., 1., 1.])
        # Fixed nominal anchors [-1,-.75] clamp the perturbed -0.75/0 pair
        # together at utility zero, so each scenario has one leader and a tie.
        self.assertEqual([ranks[key]['rank_max'] for key in 'ABC'], [2.5, 2.5, 2.5])
        for row in ranks.values():
            self.assertAlmostEqual(row['top_share_pct'], 100/3)
        self.assertAlmostEqual(preference['total_top_share_pct'], 100.)
        correlations = {row['id']: row['spearman_vs_nominal']['value'] for row in preference['scenarios']}
        self.assertEqual(correlations, {'left': -.5, 'center': 1., 'right': -.5})
        self.assertEqual(preference['scenarios'][0]['scores'], {'A': 0., 'B': 0., 'C': 1.})

    def test_constant_metric_midrank_ties_and_max_direction_are_explicit(self):
        result = self.analyze()
        constant = result['preferences'][1]
        self.assertTrue(result['nominal_anchors']['zero_impact']['constant'])
        for row in constant['candidates']:
            self.assertEqual((row['nominal_score'], row['nominal_rank'], row['rank_min'], row['rank_max']), (.5, 2., 2., 2.))
            self.assertAlmostEqual(row['top_share_pct'], 100/3)
        for row in constant['scenarios']:
            self.assertIsNone(row['spearman_vs_nominal']['value'])
            self.assertEqual(row['spearman_vs_nominal']['reason'], 'constant_rank_vector')
        maximum = deepcopy(self.bundle)
        maximum['model']['responses'][1]['direction'] = 'max'
        _seal(maximum)
        result = self.analyze(bundle=maximum)
        shares = {row['id']: row['top_share_pct'] for row in result['preferences'][0]['candidates']}
        for value in shares.values():
            self.assertAlmostEqual(value, 100/3)
        # Maximization reverses each tied ranking: left has A and B as leaders.
        self.assertEqual(result['preferences'][0]['scenarios'][0]['top_ids'], ['A', 'B'])

    def test_scoring_clamps_to_frozen_nominal_anchors_and_ties_are_not_chained(self):
        self.assertEqual(_utility(-100, 0, 10, 'min'), 1.)
        self.assertEqual(_utility(100, 0, 10, 'min'), 0.)
        self.assertEqual(_utility(-100, 2, 2, 'min'), .5)
        self.assertAlmostEqual(_utility(0, -1e308, 1e308, 'max'), .5)
        ranks, leaders = _ranks([1., 1.-.75e-12, 1.-1.5e-12])
        np.testing.assert_array_equal(ranks, [1.5, 1.5, 3.])
        self.assertEqual(leaders, [0, 1])

    def test_roundoff_constant_anchor_does_not_erase_true_near_zero_differences(self):
        from process_pipeline.robustness import _constant
        lower, upper = 1.5177297297297296, 1.5177297297297299
        self.assertTrue(_constant(lower, upper))
        self.assertEqual(_utility(lower, lower, upper, 'min'), .5)
        self.assertEqual(_utility(upper, lower, upper, 'min'), .5)
        self.assertFalse(_constant(1e-20, 2e-20))
        self.assertEqual(_utility(1e-20, 1e-20, 2e-20, 'min'), 1.)
        self.assertEqual(_utility(2e-20, 1e-20, 2e-20, 'min'), 0.)
        def roundoff_mean(state, values):
            _x(state, values)
            return {'energy': lower if values['x'] <= 0 else upper, 'signed_heat': 0., 'zero_impact': 0.}
        result = self.analyze(function=roundoff_mean)
        self.assertTrue(result['nominal_anchors']['energy']['constant'])
        self.assertTrue(all(row['nominal_score'] == .5 for row in result['preferences'][0]['candidates']))

    def test_midrank_spearman_matches_independent_scipy_for_exact_ties(self):
        first = [8, 8, 4, 2, 1, 1]
        second = [5, 3, 3, 8, 1, 1]
        left, _ = _ranks(first); right, _ = _ranks(second)
        self.assertAlmostEqual(_spearman(left, right)['value'], spearmanr(first, second).statistic, places=14)

    def test_outside_domain_retains_every_query_and_suppresses_all_rankings(self):
        config = configuration(); config['candidates'][-1]['inputs']['x'] = .9
        result = self.analyze(config)
        self.assertEqual(len(result['records']), 9)
        self.assertFalse(result['rank_complete'])
        self.assertEqual(result['preferences'], [])
        self.assertEqual(result['nominal_anchors'], {})
        self.assertEqual(result['candidates'][-1]['coverage'], {'expected': 3, 'valid': 2, 'unsupported': 1, 'complete': False})
        self.assertIsNone(result['candidates'][-1]['metrics']['signed_heat']['min'])
        self.assertTrue(result['candidates'][0]['coverage']['complete'])
        failed = [row for row in result['records'] if not row['constraints_passed']]
        self.assertEqual(failed[0]['id'], 'C::right')
        self.assertTrue(any('bounds' in error for error in failed[0]['errors']))

    def test_actual_training_hull_gate_remains_active_inside_declared_bounds(self):
        dataset = dataset_fixture('offline_fixture')
        dataset['rows'] = [row for row in dataset['rows'] if not (row['split'] == 'training' and row['inputs'] == {'x': 1., 'y': 1.})]
        bundle = fit(seal_dataset(dataset), acceptance_config())
        config = configuration(); config['scenarios'] = [config['scenarios'][1]]
        config['candidates'][-1]['inputs'] = {'x': .75, 'y': .75}
        result = self.analyze(config, bundle)
        self.assertFalse(result['rank_complete'])
        self.assertTrue(any('convex hull' in error for error in result['records'][-1]['errors']))

    def test_missing_response_and_response_domain_failure_are_retained(self):
        for function in (lambda state, values: {'energy': 0., 'signed_heat': -1.},
                         lambda state, values: {'energy': -1., 'signed_heat': -1., 'zero_impact': 0.},
                         lambda state, values: {'energy': float('nan'), 'signed_heat': -1., 'zero_impact': 0.}):
            result = self.analyze(function=function)
            self.assertFalse(result['rank_complete'])
            self.assertEqual(len(result['records']), 9)
            self.assertTrue(all(not row['constraints_passed'] and row['errors'] for row in result['records']))
            json.dumps(result, allow_nan=False)

    def test_native_units_missing_inputs_and_invalid_design_fail_before_prediction(self):
        edits = [lambda c: c['perturbations']['x'].update(unit='K'),
                 lambda c: c['perturbations']['x'].update(halfwidth=-1),
                 lambda c: c['candidates'][0]['inputs'].pop('x'),
                 lambda c: c['scenarios'][0]['offsets'].update(x=1.1),
                 lambda c: c['scenarios'].pop(1),
                 lambda c: c['scenarios'].append(deepcopy(c['scenarios'][0])),
                 lambda c: c['preferences'][0]['weights'].pop('energy'),
                 lambda c: c['preferences'][0].update(weights={'energy': 0, 'signed_heat': 0, 'zero_impact': 0})]
        for edit in edits:
            config = configuration(); edit(config)
            with patch('process_pipeline.robustness.predict', side_effect=AssertionError('Invalid design must not predict')):
                with self.assertRaises((SurrogateError, ValueError)):
                    analyze_robustness(self.bundle, config, True)
        dataset = dataset_fixture('offline_fixture'); dataset['inputs'][0]['unit'] = ''
        bundle = fit(seal_dataset(dataset), acceptance_config())
        config = configuration(); config['perturbations']['x']['unit'] = ''
        self.assertTrue(self.analyze(config, bundle)['rank_complete'])

    def test_effectively_duplicate_scenarios_are_rejected_without_reweighting(self):
        config = configuration()
        config['scenarios'].append({'id': 'duplicate-right', 'offsets': {'x': 1, 'y': 1}})
        with self.assertRaisesRegex(SurrogateError, 'distinct effective perturbations'):
            self.analyze(config)
        config = configuration()
        config['perturbations']['x']['halfwidth'] = 0
        with self.assertRaisesRegex(SurrogateError, 'distinct effective perturbations'):
            self.analyze(config)
        config['scenarios'] = [config['scenarios'][1]]
        self.assertTrue(self.analyze(config)['rank_complete'])
        config = configuration()
        config['perturbations']['x']['halfwidth'] = 5e-324
        config['scenarios'][0]['offsets']['x'] = -.1
        with self.assertRaisesRegex(SurrogateError, 'distinct effective perturbations'):
            self.analyze(config)

    def test_near_zero_nominal_span_remains_an_unclipped_numerical_description(self):
        def tiny_nominal(state, values):
            _x(state, values)
            return {'energy': 0., 'signed_heat': values['x']+1e-12, 'zero_impact': 0.}
        result = self.analyze(function=tiny_nominal)
        metric = result['candidates'][1]['metrics']['signed_heat']
        self.assertEqual(metric['nominal'], 1e-12)
        self.assertAlmostEqual(metric['max']-metric['min'], 1.)
        self.assertAlmostEqual(metric['relative_span_pct']/1e14, 1.)
        self.assertIsNone(metric['relative_span_reason'])

    def test_default_and_hard_query_budgets_do_not_silently_subsample(self):
        config = configuration()
        config['candidates'] = [{'id': f'candidate-{i}', 'inputs': {'x': 0., 'y': 0.}} for i in range(50)]
        config['scenarios'] = [{'id': f'scenario-{i}', 'offsets': {'x': (i-10)/10, 'y': 0.}} for i in range(21)]
        with self.assertRaisesRegex(SurrogateError, '1050.*1000'):
            analyze_robustness(self.bundle, config, True)
        config['max_total_queries'] = 10001
        with self.assertRaisesRegex(SurrogateError, '10000'):
            analyze_robustness(self.bundle, config, True)
        config = configuration()
        config['preferences'] = [{'id': f'preference-{i}', 'weights': deepcopy(config['preferences'][0]['weights'])} for i in range(257)]
        with self.assertRaisesRegex(SurrogateError, '256'):
            analyze_robustness(self.bundle, config, True)

    def test_opt_in_hashes_and_frozen_model_are_preserved(self):
        with self.assertRaisesRegex(SurrogateError, 'allow_exploratory'):
            analyze_robustness(self.bundle, configuration())
        corrupted = deepcopy(self.bundle); corrupted['model']['regressors']['energy']['output_mean'] += 1
        with self.assertRaisesRegex(SurrogateError, 'hash mismatch'):
            analyze_robustness(corrupted, configuration(), True)
        before = deepcopy(self.bundle)
        result = self.analyze()
        self.assertEqual(self.bundle, before)
        self.assertEqual(result['model_sha256'], self.bundle['model_sha256'])
        self.assertEqual(result['profile_sha256'], self.bundle['profile_sha256'])
        self.assertEqual(result['config_sha256'], canonical_hash(result['config']))
        digest = result.pop('result_sha256')
        self.assertEqual(digest, canonical_hash(result))
        self.assertFalse(result['native_execution_performed'])
        self.assertFalse(result['model_refitted'])
        self.assertFalse(result['background_lca_recomputed'])

    def test_real_gp_cli_runs_in_offline_exploratory_mode(self):
        config = configuration()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'bundle.json').write_text(json.dumps(self.bundle), encoding='utf-8')
            (root/'config.json').write_text(json.dumps(config), encoding='utf-8')
            command = [sys.executable, '-m', 'process_pipeline.robustness', str(root/'bundle.json'), '--config', str(root/'config.json'), '--output', str(root/'result.json'), '--allow-exploratory']
            completed = subprocess.run(command, capture_output=True, text=True, check=True)
            result = json.loads((root/'result.json').read_text(encoding='utf-8'))
            self.assertEqual(result['kind'], 'process_robustness')
            self.assertEqual(result['query_count'], 9)
            self.assertTrue(result['rank_complete'], completed.stdout)
            self.assertTrue(result['exploratory'])
            self.assertAlmostEqual(result['preferences'][0]['total_top_share_pct'], 100)


if __name__ == '__main__':
    unittest.main()
