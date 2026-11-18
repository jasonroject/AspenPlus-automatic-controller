"""Independent regression checks for frozen-model gates and scenario diagnostics."""
import copy
import contextlib
import hashlib
import io
import json
from pathlib import Path
from types import SimpleNamespace
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from model import TARGETS, coordinates, metrics
from diagnostics import average_ranks, frozen_training_audit, metric_variability, rank_correlations, scenario_diagnostics
from build import validation

ROOT = Path(__file__).resolve().parents[1]


class FrozenIntegrityTests(unittest.TestCase):
    def fixture(self):
        frame = pd.DataFrame({'temperature_C': [320., 330., 340.], 'length_m': [7., 9., 11.],
                              'accepted': [True]*3, 'split': ['train', 'train', 'holdout'],
                              **{name: [2., 3., 4.] for name in TARGETS}})
        models, meta = {}, {'reference_sha256': hashlib.sha256(b'reference').hexdigest(), 'models': {}}
        for name in TARGETS:
            models[name] = SimpleNamespace(X_train_=coordinates(frame.temperature_C[:2], frame.length_m[:2]),
                                            y_train_=np.log(frame[name][:2].to_numpy()),
                                            _y_train_mean=0., _y_train_std=1., kernel_='frozen-kernel')
            meta['models'][name] = {'training_count': 2, 'fitted_kernel': 'frozen-kernel'}
        return models, frame, meta

    def audit(self, models, frame, meta, source=b'reference', fresh=()):
        return frozen_training_audit(models, frame, meta, source, b'model', b'coefficients', fresh)

    def test_frozen_training_matches_and_hash_substitution_fails_closed(self):
        models, frame, meta = self.fixture()
        self.assertTrue(self.audit(models, frame, meta)['passed'])
        bad = self.audit(models, frame, meta, b'changed source')
        self.assertFalse(bad['passed']); self.assertIn('reference_hash_mismatch', bad['errors'])

    def test_training_coordinate_or_label_substitution_fails_closed(self):
        models, frame, meta = self.fixture()
        bad = copy.deepcopy(models)
        bad[TARGETS[0]].X_train_[0] = coordinates([340.], [11.])[0]
        self.assertFalse(self.audit(bad, frame, meta)['passed'])
        bad = copy.deepcopy(models)
        bad[TARGETS[0]].y_train_[0] += .01
        self.assertFalse(self.audit(bad, frame, meta)['passed'])
        bad = copy.deepcopy(models); bad[TARGETS[0]].kernel_ = 'changed-kernel'
        self.assertFalse(self.audit(bad, frame, meta)['passed'])
        self.assertFalse(self.audit(models, frame, meta, fresh=[(320., 7.)])['passed'])

    def test_incomplete_pairs_are_not_silently_removed(self):
        for actual, predicted in [([1, 2], [1, np.nan]), ([1, np.inf], [1, 2]),
                                  ([0, 2], [1, 2]), ([1, 2], [1, -1]), ([], []), ([1], [1, 2])]:
            with self.subTest(actual=actual, predicted=predicted):
                with self.assertRaises(ValueError): metrics(actual, predicted)
        self.assertEqual(metrics([1, 2], [1, 2])['n'], 2)

    def test_validation_coverage_rejects_one_invalid_pair_without_hiding_its_record(self):
        _, frame, _ = self.fixture()
        frame = frame.iloc[:2].copy()
        frame['CF_STD'] = [3., 4.]; frame['CF_HR'] = [2., 3.]
        predicted = {name: frame[name].to_numpy().copy() for name in TARGETS+['CF_STD', 'CF_HR']}
        with patch('build.predict', return_value=predicted):
            scores, rows, coverage = validation({}, {}, frame)
        self.assertTrue(coverage['complete']); self.assertEqual(len(rows), 2)
        predicted['CF_HR'][1] = np.nan
        with patch('build.predict', return_value=predicted):
            scores, rows, coverage = validation({}, {}, frame)
        self.assertFalse(coverage['complete']); self.assertNotIn('CF_HR', scores)
        self.assertEqual(coverage['metrics']['CF_HR']['valid_pairs'], 1)
        self.assertEqual(coverage['metrics']['CF_HR']['expected'], 2)
        self.assertEqual(len(rows), 2); self.assertIsNone(rows[1]['prediction']['CF_HR'])

    def test_source_hash_failure_exports_disabled_predictions_and_no_grid(self):
        import build
        models, frame, meta = self.fixture()
        frame['CF_STD'] = [1., 2., 3.]; frame['CF_HR'] = [1., 2., 3.]
        source = frame.to_csv(index=False).encode()
        meta['reference_sha256'] = hashlib.sha256(source).hexdigest()
        score = {name: metrics([1., 2.], [1., 2.]) for name in
                 ['target_kg_h', 'STD_electricity_kWh', 'HR_electricity_kWh', 'CF_STD', 'CF_HR']}
        fresh = pd.DataFrame({'temperature_C': [325., 335., 345.], 'length_m': [8.5, 12.5, 7.5]})
        with TemporaryDirectory(prefix='htl-gate-test-') as folder:
            base = Path(folder); reference = base/'reference'; output = base/'output'
            reference.mkdir(); output.mkdir()
            (reference/'native_samples.csv').write_bytes(source+b'\n')
            (reference/'lca_coefficients.json').write_text('{}')
            (reference/'failed_samples.csv').write_text('file,error\n')
            (output/'models.joblib').write_bytes(b'fake-model')
            (output/'training.json').write_text(json.dumps(meta))
            target = base/'published.json'
            with patch.object(build, 'REF', reference), patch.object(build, 'OUT', output), patch.object(build, 'WEB', target), \
                    patch('build.joblib.load', return_value=models), \
                    patch('build.fresh_records', return_value=(fresh, [{'accepted': True}]*3)), \
                    patch('build.validation', return_value=(score, [], {'complete': True})), \
                    contextlib.redirect_stdout(io.StringIO()):
                build.analyze()
            published = json.loads(target.read_text())
            self.assertFalse(published['prediction_enabled'])
            self.assertEqual(published['status'], 'validation_failed')
            self.assertEqual(published['grid']['rows'], [])
            self.assertIsNone(published['robustness'])
            self.assertIn('reference_hash_mismatch', published['validation_integrity']['errors'])

    @unittest.skipUnless((ROOT/'outputs/htl_pipeline/models.joblib').exists(), 'Frozen local estimator not distributed')
    def test_current_frozen_artifacts_pass_exact_training_checks(self):
        import joblib
        reference = ROOT/'htl_pipeline/reference/native_samples.csv'
        estimator = ROOT/'outputs/htl_pipeline/models.joblib'
        result = frozen_training_audit(joblib.load(estimator), pd.read_csv(reference),
                                      json.loads((ROOT/'outputs/htl_pipeline/training.json').read_text()),
                                      reference.read_bytes(), estimator.read_bytes(),
                                      (ROOT/'htl_pipeline/reference/lca_coefficients.json').read_bytes(),
                                      [(325., 8.5), (335., 12.5), (345., 7.5)])
        self.assertTrue(result['passed'], result['errors'])


class ScenarioDiagnosticTests(unittest.TestCase):
    def test_spearman_matches_independent_scipy_with_ties_and_reversed_order(self):
        nominal = np.array([1., 1., 3., 4., 4.])
        samples = np.array([[1., 4., 2.], [1., 4., 3.], [2., 3., 3.], [3., 1., 3.], [4., 1., 1.]])
        actual = rank_correlations(nominal, samples)
        expected = np.array([spearmanr(nominal, sample).statistic for sample in samples.T])
        np.testing.assert_allclose(actual, expected, atol=1e-14)
        np.testing.assert_equal(average_ranks([2, 2, 5, 2]), [2, 2, 4, 2])
        self.assertTrue(np.isnan(rank_correlations(np.ones(5), samples)).all())

    def test_variability_uses_population_sd_and_explicit_zero_denominators(self):
        result = metric_variability([2., 4., 6.], 4.)
        self.assertEqual(result['mean'], 4.)
        self.assertAlmostEqual(result['standard_deviation'], np.sqrt(8/3))
        self.assertAlmostEqual(result['CV_pct'], np.sqrt(8/3)/4*100)
        self.assertAlmostEqual(result['relative_P05_P95_span_pct'], 90.)
        zero = metric_variability([-1., 0., 1.], 0.)
        self.assertIsNone(zero['CV_pct']); self.assertEqual(zero['CV_undefined_reason'], 'zero_mean')
        self.assertIsNone(zero['relative_P05_P95_span_pct'])
        with self.assertRaises(ValueError): metric_variability([1, np.nan], 1)

    def test_prefix_drift_uses_nested_samples_and_known_frequency_changes(self):
        n = 1024
        ranks = np.tile(np.array([1, 2, 3])[:, None], (1, n))
        ranks[:2, 128:256] = ranks[:2, 128:256][::-1]
        scores = -ranks.astype(float)
        result = scenario_diagnostics(scores, [-1., -2., -3.], ranks, [1, 2, 3], [320, 330, 340], [5, 10, 15])
        rows = result['sampling_prefixes']
        self.assertEqual([row['samples'] for row in rows], [128, 256, 512, 1024])
        self.assertIsNone(rows[0]['max_top1_change_from_previous_pp'])
        self.assertEqual(rows[1]['max_top1_change_from_previous_pp'], 50)
        self.assertEqual(rows[2]['max_top1_change_from_previous_pp'], 25)
        self.assertEqual(rows[3]['max_top1_change_from_previous_pp'], 12.5)
        self.assertTrue(all(row['top1_frequency_sum'] == 1 for row in rows))
        self.assertEqual(result['rank_agreement']['defined_samples'], n)
        self.assertEqual(result['exact_tie_audit']['draws_with_any_exact_score_tie'], 0)

    def test_exact_tie_audit_counts_ties_without_changing_ordinal_rank_policy(self):
        scores = np.array([[1., 2.], [1., 1.], [0., 1.]])
        ranks = np.array([[1, 1], [2, 2], [3, 3]])
        result = scenario_diagnostics(scores, [1., 1., 0.], ranks, [1, 2, 3], [320, 330, 340], [5, 10, 15])
        audit = result['exact_tie_audit']
        self.assertEqual(audit['nominal_adjacent_duplicate_scores'], 1)
        self.assertEqual(audit['nominal_top_score_multiplicity'], 2)
        self.assertEqual(audit['draws_with_any_exact_score_tie'], 2)
        self.assertEqual(audit['draws_with_exact_top_score_tie'], 1)
        self.assertEqual(audit['maximum_top_score_multiplicity'], 2)


if __name__ == '__main__':
    unittest.main()
