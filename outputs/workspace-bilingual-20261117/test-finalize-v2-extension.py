"""Guard and frozen-cohort merge checks only: no fitting and no native calls."""
import ast
from copy import deepcopy
import json
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parent
MODULE = runpy.run_path(str(BASE/'finalize-v2-extension.py'))


def synthetic_batches():
    profile = json.loads((BASE/'v2-extension-plan/profile.json').read_text(encoding='utf-8'))
    cohorts = json.loads((BASE/'v2-extension-plan/cohorts.json').read_text(encoding='utf-8'))
    batches = {name: {'cases': {}, 'projects': {}, 'dataset_sha256': 'a'*64, 'ledger_file_sha256': 'b'*64, 'ledger': {'plan_sha256': 'c'*64}} for name in MODULE['BATCH_DESIGNS']}
    for row in cohorts['rows']:
        ident, batch = row['id'], batches[row['batch']]
        batch['cases'][ident] = {'id': ident, 'split': row['split'], 'inputs': row['inputs'], 'gates': {key: True for key in MODULE['GATES']},
                                  'accepted': True, 'source': f'runs/{ident}/raw.json', 'evidence_type': 'offline_fixture', 'error': None, 'warnings': [],
                                  'metrics': {'purchased_energy_kWh_kg': 1, 'yield_fraction': .1, 'impacts': {'Climate change': {'value': 2}}}}
        batch['projects'][ident] = {'cases': [{'id': ident, 'source': f'raw evidence runs/{ident}/raw.json'}], 'streams': [], 'blocks': [], 'inventory': [],
                                    'meta': {'evidence_type': 'offline_fixture'}, 'factors': deepcopy(profile['mapping']['factors'])}
    return profile, cohorts, batches


class V2FinalizerTests(unittest.TestCase):
    def test_existing_output_or_marker_blocks_before_fit(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory); marker = base/MODULE['MARKER_NAME']; marker.write_text('{}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'already recorded'):
                MODULE['available_output'](base)
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory); (base/MODULE['OUTPUT_NAME']).mkdir()
            with self.assertRaisesRegex(ValueError, 'Prior v2 output'):
                MODULE['available_output'](base)

    def test_incomplete_batch_produces_no_output_marker_or_fit(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory); run = base/'generic-native-pilot-17'; run.mkdir()
            (run/'ledger.json').write_text('{"finished_at":null,"all_planned_cases_retained":false}', encoding='utf-8')
            function = MODULE['finalize']
            with patch.dict(function.__globals__, {'frozen_design': lambda _: (None, None, None, None, None), 'fit': lambda *_: self.fail('Fit must not run')}):
                with self.assertRaisesRegex(ValueError, 'incomplete'):
                    function(base)
            self.assertFalse((base/MODULE['OUTPUT_NAME']).exists()); self.assertFalse((base/MODULE['MARKER_NAME']).exists())

    def test_merge_keeps_all_37_splits_sources_and_separate_repeat(self):
        profile, cohorts, batches = synthetic_batches(); before = deepcopy(batches)
        ledger, dataset, project = MODULE['merge_batches'](profile, cohorts, batches)
        self.assertEqual(len(dataset['rows']), 37); self.assertEqual(project['meta']['scan_audit']['planned'], 37)
        self.assertEqual(project['meta']['retained_native_runs']['total'], 38)
        self.assertEqual(project['meta']['retained_native_runs']['excluded_repeats'][0]['id'], 'local-05')
        self.assertNotIn('local-05', [row['id'] for row in dataset['rows']])
        self.assertEqual([row['split'] for row in dataset['rows']], [row['split'] for row in cohorts['rows']])
        self.assertEqual([row['source'] for row in dataset['rows']], [row['source'] for row in cohorts['rows']])
        self.assertTrue(all(row['source'].split('/runs/')[0] in batches for row in dataset['rows']))
        self.assertEqual(batches, before)
        self.assertEqual(dataset['evidence_type'], 'offline_fixture')

    def test_failed_unique_row_or_changed_split_blocks_merge(self):
        for mutation in ('failure', 'split'):
            profile, cohorts, batches = synthetic_batches()
            row = batches['generic-native-pilot-17']['cases']['case-008']
            row['accepted'] = False if mutation == 'failure' else True
            if mutation == 'split': row['split'] = 'training'
            with self.assertRaisesRegex(ValueError, 'frozen merge selection'):
                MODULE['merge_batches'](profile, cohorts, batches)

    def test_group_max_error_not_average_and_no_survivor_pass(self):
        responses = [{'id': 'energy', 'unit': 'kWh/kg'}]
        rules = {'energy': {'unit': 'kWh/kg', 'relative_floor': .01, 'max_relative_error': .05}}
        records = [{'constraints_passed': True, 'actual': {'energy': 1}, 'predicted': {'energy': value}} for value in (1, 1, 1, 1.1)]
        result = MODULE['group_metrics'](records, responses, rules)
        self.assertFalse(result['passed']); self.assertAlmostEqual(result['metrics']['energy']['max_relative_error'], .1)
        self.assertAlmostEqual(result['metrics']['energy']['mae'], .025)
        records[3]['constraints_passed'] = False
        result = MODULE['group_metrics'](records, responses, rules)
        self.assertFalse(result['complete']); self.assertFalse(result['passed']); self.assertIsNone(result['metrics']['energy']['mae'])
        self.assertEqual((result['expected'], result['valid_pairs']), (4, 3))

    def test_source_snapshot_detects_mutation_and_single_fit_call_is_explicit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'evidence.json'; path.write_text('{}', encoding='utf-8')
            before = MODULE['snapshot']([Path(directory)]); path.write_text('{"changed":true}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'protected old file'):
                MODULE['unchanged'](before, [Path(directory)])
        tree = ast.parse((BASE/'finalize-v2-extension.py').read_text(encoding='utf-8'))
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'fit']
        self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()
