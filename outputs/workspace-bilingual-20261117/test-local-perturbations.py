"""Arithmetic and retained-failure regressions; never read a local native scan."""
from pathlib import Path
import runpy
import tempfile
import unittest

MODULE = runpy.run_path(str(Path(__file__).with_name('compare-local-perturbations.py')))
POLICY = {'energy': {'unit': 'kWh/kg', 'relative_floor': .01, 'max_relative_error': .05},
          'signed': {'unit': 'kW', 'relative_floor': .1, 'max_relative_error': .05}}
RESPONSES = [{'id': 'energy', 'unit': 'kWh/kg'}, {'id': 'signed', 'unit': 'kW'}]


def record(ident='local-test', actual=None, predicted=None, accepted=True):
    mapping = {'scenario_id': 'low', 'prediction_record_id': 'candidate::low', 'new_coordinate': True, 'original_point_id': None, 'original_split': None}
    point = {'id': ident, 'split': 'verification', 'parameters': {'temperature': 300}}
    native = {'accepted': accepted, 'gates': {'control_succeeded': accepted, 'solver_accepted': accepted},
              'outputs': actual or {'energy': 0, 'signed': -2}, 'source': 'runs/'+ident+'/raw.json', 'warnings': [], 'error': None}
    prediction = {'constraints_passed': True, 'errors': [], 'outputs': predicted or {'energy': .0004, 'signed': -1.92}}
    return MODULE['comparison_record'](mapping, point, native, prediction, POLICY)


class LocalComparisonTests(unittest.TestCase):
    def test_missing_raw_failed_capture_retained_but_accepted_capture_blocked(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory)/'raw.json'
            self.assertIsNone(MODULE['read_capture'](missing, False))
            with self.assertRaisesRegex(ValueError, 'Accepted native row has no raw capture'):
                MODULE['read_capture'](missing, True)
            missing.write_text('{"case_id":"fixture"}', encoding='utf-8')
            self.assertEqual(MODULE['read_capture'](missing, False), {'case_id': 'fixture'})

    def test_zero_floor_and_signed_response(self):
        row = record()
        self.assertTrue(row['comparison_available'])
        self.assertAlmostEqual(row['deviations']['energy']['relative_error'], .04)
        self.assertAlmostEqual(row['deviations']['signed']['relative_error'], .04)
        self.assertTrue(all(item['passed'] for item in row['deviations'].values()))

    def test_independent_error_arithmetic_and_five_percent_gate(self):
        rows = [record('one', {'energy': 1, 'signed': -2}, {'energy': 1.04, 'signed': -1.92}),
                record('two', {'energy': 2, 'signed': -4}, {'energy': 2.12, 'signed': -4})]
        result = MODULE['summarize'](rows, RESPONSES, POLICY)
        self.assertTrue(result['complete']); self.assertFalse(result['passed'])
        self.assertAlmostEqual(result['metrics']['energy']['mae'], .08)
        self.assertAlmostEqual(result['metrics']['energy']['rmse'], (.008)**.5)
        self.assertAlmostEqual(result['metrics']['energy']['max_relative_error'], .06)
        self.assertTrue(result['metrics']['signed']['passed'])

    def test_failed_native_rows_remain_without_survivor_pass(self):
        rows = [record(str(i)) for i in range(8)]
        rows[3] = record('3', accepted=False)
        result = MODULE['summarize'](rows, RESPONSES, POLICY)
        self.assertEqual((result['expected'], result['valid_pairs']), (8, 7))
        self.assertFalse(result['complete']); self.assertFalse(result['passed'])
        self.assertFalse(rows[3]['comparison_available']); self.assertTrue(rows[3]['errors'])
        self.assertTrue(all(metric['mae'] is None and metric['max_relative_error'] is None and not metric['passed'] for metric in result['metrics'].values()))

    def test_missing_and_nonfinite_actual_responses_cannot_be_available(self):
        for actual in [{'energy': 1}, {'energy': None, 'signed': -2}, {'energy': float('inf'), 'signed': -2}, {'energy': True, 'signed': -2}]:
            row = record(actual=actual)
            self.assertFalse(row['comparison_available']); self.assertEqual(row['deviations'], {})

    def test_center_repeat_does_not_change_new_eight_denominator(self):
        new = [record(str(i)) for i in range(8)]
        repeat = record('center', actual={'energy': 1, 'signed': -2}, predicted={'energy': 2, 'signed': -2})
        repeat.update(new_coordinate=False, original_point_id='case-008', original_split='holdout')
        all_rows = new+[repeat]
        self.assertTrue(MODULE['summarize']([row for row in all_rows if row['new_coordinate']], RESPONSES, POLICY)['passed'])
        self.assertFalse(MODULE['summarize'](all_rows, RESPONSES, POLICY)['passed'])
        self.assertEqual(len(all_rows), 9)


if __name__ == '__main__':
    unittest.main()
