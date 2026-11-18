"""Offline packaging guards only; all writable test data are synthetic/temp-local."""
from copy import deepcopy
import json
from pathlib import Path
import runpy
import tempfile
import unittest

MODULE = runpy.run_path(str(Path(__file__).with_name('curate-v2-extension.py')))


def summary(enabled=False):
    return {'version': 'v2-extension', 'created_at': 'synthetic-test-only',
            'counts': MODULE['COUNTS'], 'native_runs_retained': 38,
            'unique_native_cases': 37, 'accepted_unique_cases': 37, 'fit_attempts': 1,
            'criteria_changed': False, 'original_splits_changed': False,
            'old_files_unchanged': True, 'physical_validation': False,
            'prediction_enabled': enabled, 'validation_passed': enabled,
            'exploratory': not enabled, 'model_sha256': 'a' * 64,
            'baseline_model_sha256': 'b' * 64}


def publishing_fixture():
    # A direct copy-helper fixture, not a valid finalizer or native-data fixture.
    content = {name: ('{"synthetic":"copy-test-only","name":' + json.dumps(name) + '}\r\n').encode()
               for name in MODULE['SOURCE_MAP']}
    metrics = {key: {'complete': True, 'max_relative_error': .06}
               for key in ('purchased_energy_kWh_kg', 'yield_fraction', 'impact:Climate change')}
    groups = {key: {'metrics': deepcopy(metrics)} for key in MODULE['COHORTS']}
    return content, {'summary.json': summary(), 'cohort-evaluation.json': {'cohorts': groups},
                     'local-perturbation-comparison.json': {'new_eight': {'metrics': deepcopy(metrics)}}}


class PackagingTests(unittest.TestCase):
    def test_missing_final_summary_blocks_without_creating_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, 'not complete'):
                MODULE['collect'](root, root)
            self.assertEqual(list(root.iterdir()), [])

    def test_failure_marker_blocks_even_with_a_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); analysis = root / 'generic-native-v2-analysis'; analysis.mkdir()
            (analysis / 'failure.json').write_text('{}')
            (analysis / 'summary.json').write_text(json.dumps(summary()))
            with self.assertRaisesRegex(ValueError, 'failure retained'):
                MODULE['collect'](root, root)

    def test_summary_requires_all_native_points_and_unchanged_policy(self):
        MODULE['summary_gate'](summary())
        for key, value in [('accepted_unique_cases', 36), ('fit_attempts', 2),
                           ('old_files_unchanged', False), ('physical_validation', True),
                           ('prediction_enabled', True), ('unique_native_cases', True)]:
            with self.subTest(key=key):
                wrong = summary(); wrong[key] = value
                with self.assertRaises(ValueError):
                    MODULE['summary_gate'](wrong)

    def test_source_map_is_explicit_and_only_derived_json(self):
        self.assertEqual(len(MODULE['SOURCE_MAP']), 21)
        for name, source in MODULE['SOURCE_MAP'].items():
            self.assertTrue(name.endswith('.json')); self.assertNotIn('/', name)
            self.assertFalse(any(token in source for token in ('/runs/', 'raw.json', '.bkp', '.env',
                                                               'protected-source-hashes', 'fit-attempt')))

    def test_privacy_checks_keys_values_and_nested_fields_without_echoing_values(self):
        prohibited = ['C:\\Users\\private-user\\document.json', 'D:/work/private.json',
                      '/home/private-user/data', '\\\\server\\private-share',
                      'file:///C:/private.json', 'person@example.com', 'outputs/other-project/data.json',
                      'outputs/workspace-bilingual-20261117-extra/private.json']
        for value in prohibited:
            with self.subTest(kind='private value'), self.assertRaises(ValueError) as caught:
                MODULE['private_check']({'nested': [value]}, 'fixture.json')
            self.assertNotIn(value, str(caught.exception))
        with self.assertRaisesRegex(ValueError, 'credential field'):
            MODULE['private_check']({'api_key': 'do-not-print'}, 'fixture.json')
        with self.assertRaises(ValueError):
            MODULE['private_check']({'safe': float('inf')}, 'fixture.json')

    def test_reviewed_relative_namespaces_and_public_links_are_not_rewritten(self):
        value = {'source_paths_relative_to': 'outputs/workspace-bilingual-20261117',
                 'sources': {'outputs/workspace-bilingual-20261117/v2-extension-plan/plan.json': 'a' * 64},
                 'native_reference_only': 'source_HR.bkp', 'node': '\\Data\\Blocks\\REACTOR\\Input\\TEMP',
                 'link': 'https://example.org/method'}
        before = deepcopy(value); MODULE['private_check'](value, 'fixture.json')
        self.assertEqual(value, before)

    def test_json_and_canonical_identity_fail_closed(self):
        for text in (b'{"id":1,"id":2}', b'{"metric":NaN}'):
            with self.assertRaises(ValueError):
                MODULE['strict_json'](text, 'fixture.json')
        item = {'value': 1}; item['hash'] = MODULE['canonical'](item)
        MODULE['sealed'](item, 'hash', 'identity')
        item['value'] = 2
        with self.assertRaisesRegex(ValueError, 'identity'):
            MODULE['sealed'](item, 'hash', 'identity')

    def test_source_path_cannot_escape_evidence_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); child = root / 'child'; child.mkdir(); (root / 'outside.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'escapes'):
                MODULE['contained'](child, '../outside.json')

    def test_completed_summary_with_incomplete_artifact_manifest_blocks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); analysis = root / 'generic-native-v2-analysis'; analysis.mkdir()
            value = summary(); value['artifact_sha256'] = {}
            (analysis / 'summary.json').write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError, 'Incomplete finalizer artifact manifest'):
                MODULE['collect'](root, root)
            self.assertEqual({p.name for p in root.iterdir()}, {'generic-native-v2-analysis'})

    def test_temp_copy_keeps_original_crlf_bytes_and_manifest_is_complete(self):
        content, objects = publishing_fixture()
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / 'synthetic-package'
            manifest = MODULE['publish'](content, objects, destination)
            self.assertEqual(set(manifest['files']), set(MODULE['SOURCE_MAP']))
            self.assertEqual({path.name for path in destination.glob('*.json')}, set(content) | {'index.json'})
            for name, data in content.items():
                self.assertEqual((destination / name).read_bytes(), data)
                self.assertEqual(manifest['files'][name], {'sha256': MODULE['sha'](data), 'bytes': len(data)})
            self.assertEqual((manifest['native_case_count'], manifest['training_count'],
                              manifest['holdout_count'], manifest['verification_count'],
                              manifest['fresh_verification_count'], manifest['retained_native_run_count']),
                             (37, 20, 3, 14, 4, 38))
            with self.assertRaisesRegex(ValueError, 'already exists'):
                MODULE['publish'](content, objects, destination)

    def test_readme_uses_actual_model_status_without_calling_it_physical_validation(self):
        _, objects = publishing_fixture()
        text = MODULE['readme_for'](objects)
        self.assertIn('Ordinary prediction stays disabled', text)
        self.assertIn('--allow-exploratory', text)
        self.assertIn('No physical validation is claimed', text)
        objects['summary.json'] = summary(True)
        text = MODULE['readme_for'](objects)
        self.assertIn('ordinary prediction is enabled', text)
        self.assertNotIn('--allow-exploratory', text)
        self.assertIn('not public download URLs', text)


if __name__ == '__main__':
    unittest.main()
