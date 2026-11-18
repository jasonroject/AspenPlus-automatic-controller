"""Compare the prospective 8-new/1-repeat native neighborhood to frozen means.

Never runs Aspen, fits a model, changes a design, or promotes model qualification.
The binding below was recorded after the original fit, while local runs were in
progress; local native outputs were not used to choose or modify this model.
"""
import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import runpy
import sys

BASE = Path(__file__).resolve().parent
HELPERS = runpy.run_path(str(BASE/'audit-native-pilot.py'))
read, require, canonical, digest, sealed = (HELPERS[key] for key in ('read', 'require', 'canonical', 'digest', 'sealed'))
BINDING = {
    'model_sha256': '79033d782d9212c5ec846c4d99b9de078daf3415fc3df96162534dbe88339283',
    'bundle_sha256': '07841e5854062dc8dfe2bb671b2b4d5bde865df6abd2ea5686d4512c4119f717',
    'robustness_result_sha256': '11a2c3f603850eda1de8eb03575a02165ccaefa30e788b04452a5dab1c6247ef',
    'file_sha256': {
        'model.bundle.json': 'a8e610e13ad59bd9fef4473aae4a01d596d78895ae2fe913589dfef16341e95e',
        'robustness.json': 'e3da206c68b78ec779f20d299d0d3c7bdef04dd86847ab9f18ecc7ba605d0266',
        'evaluation.json': 'ac11d71de7b5b160e6f44e8d91633279e1a87c192866ab6b8abd5e8d771709dc',
    },
}


def read_capture(path, accepted):
    if not path.is_file():
        require(accepted is not True, 'Accepted native row has no raw capture: '+str(path))
        return None
    return read(path)


def summarize(records, responses, criteria):
    valid = [row for row in records if row['comparison_available']]
    complete = len(valid) == len(records) and bool(records)
    metrics = {}
    for response in responses:
        key = response['id']; rule = criteria[key]
        metric = {'unit': response['unit'], 'expected': len(records), 'valid_pairs': len(valid),
                  'complete': complete, 'mae': None, 'rmse': None, 'max_relative_error': None,
                  'relative_floor': rule['relative_floor'], 'max_relative_error_criterion': rule['max_relative_error'], 'passed': False}
        if complete:
            errors = [row['predicted'][key]-row['actual'][key] for row in records]
            metric.update(mae=math.fsum(abs(error) for error in errors)/len(errors),
                          rmse=math.sqrt(math.fsum(error*error for error in errors)/len(errors)),
                          max_relative_error=max(abs(error)/max(abs(row['actual'][key]), rule['relative_floor']) for row, error in zip(records, errors)))
            metric['passed'] = metric['max_relative_error'] <= rule['max_relative_error']
        metrics[key] = metric
    return {'expected': len(records), 'valid_pairs': len(valid), 'complete': complete,
            'passed': complete and all(metric['passed'] for metric in metrics.values()), 'metrics': metrics}


def comparison_record(mapping, point, native, predicted, criteria):
    errors = []
    if not native['accepted']:
        errors.append('Native audit did not accept this row: '+', '.join(key for key, value in native['gates'].items() if value is not True))
    if not predicted['constraints_passed']:
        errors.extend(predicted.get('errors') or ['Frozen prediction unavailable'])
    expected_ids = set(criteria)
    for label, values in [('actual', native['outputs']), ('predicted', predicted['outputs'])]:
        if not isinstance(values, dict) or set(values) != expected_ids or any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) for value in values.values()):
            errors.append(label+' does not contain all declared finite responses')
    available = not errors
    deviations = {}
    if available:
        for key, rule in criteria.items():
            difference = predicted['outputs'][key]-native['outputs'][key]
            relative = abs(difference)/max(abs(native['outputs'][key]), rule['relative_floor'])
            deviations[key] = {'unit': rule['unit'], 'signed_error': difference, 'absolute_error': abs(difference),
                               'relative_error': relative, 'relative_floor': rule['relative_floor'],
                               'passed': relative <= rule['max_relative_error']}
    return {'id': point['id'], 'split': point['split'], 'inputs': point['parameters'],
            'scenario_id': mapping['scenario_id'], 'prediction_record_id': mapping['prediction_record_id'],
            'new_coordinate': mapping['new_coordinate'], 'original_point_id': mapping['original_point_id'],
            'original_split': mapping['original_split'], 'native_accepted': native['accepted'],
            'gates': native['gates'], 'actual': native['outputs'], 'predicted': predicted['outputs'],
            'source': native['source'], 'warnings': native['warnings'], 'native_error': native['error'],
            'comparison_available': available, 'errors': errors, 'deviations': deviations}


def compare(base):
    design = base/'local-perturbation-plan'; original = base/'generic-pilot-plan'
    run = base/'native-local-perturbation-9'; fitted = base/'generic-native-pilot-analysis'
    manifest, plan, mappings = read(design/'manifest.json'), read(design/'plan.json'), read(design/'mapping.json')
    profile = read(original/'profile.json'); policy = read(original/'criteria.json')
    bundle, robust = read(fitted/'model.bundle.json'), read(fitted/'robustness.json')
    for filename, value in BINDING['file_sha256'].items():
        require(digest(fitted/filename) == value, 'Frozen 17-point artifact changed: '+filename)
    require(bundle['model_sha256'] == BINDING['model_sha256'] and bundle['bundle_sha256'] == BINDING['bundle_sha256'], 'Frozen model binding')
    require(robust['result_sha256'] == BINDING['robustness_result_sha256'], 'Frozen scenario-result binding')
    sealed(bundle, 'bundle_sha256'); sealed(robust, 'result_sha256')
    require(canonical(bundle['model']) == BINDING['model_sha256'], 'Frozen posterior state hash')
    for filename, value in manifest['file_sha256'].items():
        require(digest(design/filename) == value, 'Prospective local design file changed: '+filename)
    require(canonical(plan) == manifest['plan_sha256'], 'Local plan hash')
    require(canonical(policy) == manifest['criteria_sha256'], 'Frozen original error policy hash')
    require(canonical(profile) == manifest['profile_sha256'] == bundle['profile_sha256'], 'Profile binding')
    require(canonical(read(original/'robustness.config.json')) == manifest['config_sha256'], 'Prospective scenario design binding')
    require(manifest['native_model_sha256'] == bundle['native_model_sha256'], 'Source archive binding')
    ledger, dataset = read(run/'ledger.json'), read(run/'dataset.json')
    require(ledger.get('finished_at') and ledger.get('all_planned_cases_retained') is True, 'Local native scan is incomplete; no comparison emitted')
    require(ledger['source_unchanged'] is True and ledger['plan_sha256'] == manifest['plan_sha256'], 'Local source/plan integrity')
    require(ledger['model_sha256'] == bundle['native_model_sha256'] and ledger['profile_sha256'] == bundle['profile_sha256'], 'Local native model/profile lineage')
    require(dataset['model_sha256'] == bundle['native_model_sha256'] and dataset['profile_sha256'] == bundle['profile_sha256'], 'Local dataset lineage')
    sealed(dataset, 'dataset_sha256')
    require(dataset['inputs'] == bundle['model']['inputs'] and dataset['responses'] == bundle['model']['responses'], 'Variable declarations and units')
    require(dataset.get('basis') == bundle['dataset_metadata'].get('basis'), 'Accounting basis unchanged')
    require(len(plan['points']) == len(mappings) == len(ledger['cases']) == len(dataset['rows']) == 9, 'All nine requests retained')
    maps = {item['id']: item for item in mappings}; points = {point['id']: point for point in plan['points']}
    cases = {row['id']: row for row in ledger['cases']}; native = {row['id']: row for row in dataset['rows']}
    require(len(maps) == len(points) == len(cases) == len(native) == 9 and set(maps) == set(points) == set(cases) == set(native), 'Unique matching request IDs')
    predicted = {row['id']: row for row in robust['records']}
    original_rows = {row['id']: row for row in bundle['observations']}
    original_coords = {tuple(row['inputs'][spec['id']] for spec in dataset['inputs']): row for row in original_rows.values()}
    records, residuals = [], []
    for point in plan['points']:
        ident = point['id']; mapping, row, observation = maps[ident], cases[ident], native[ident]
        require(point['split'] == row['split'] == observation['split'] == 'verification', ident+' remains verification only')
        require(point['parameters'] == row['inputs'] == observation['inputs'], ident+' exact native parameters')
        old = original_coords.get(tuple(point['parameters'][spec['id']] for spec in dataset['inputs']))
        require(mapping['new_coordinate'] == (old is None), ident+' new/repeat designation')
        require(mapping['original_point_id'] == (old['id'] if old else None) and mapping['original_split'] == (old['split'] if old else None), ident+' original coordinate identity')
        prediction = predicted[mapping['prediction_record_id']]
        require(prediction['candidate_id'] == manifest['candidate_id'] and prediction['scenario_id'] == mapping['scenario_id'] and prediction['inputs'] == point['parameters'], ident+' exact frozen scenario query')
        for field in ('gates', 'accepted', 'source', 'evidence_type', 'error', 'warnings'):
            require(observation[field] == row[field], ident+' dataset/ledger '+field)
        require(row['accepted'] == all(value is True for value in row['gates'].values()), ident+' gate conjunction')
        require(row['source'] == f'runs/{ident}/raw.json', ident+' source path')
        case_dir = run/'runs'/ident; raw = read_capture(case_dir/'raw.json', row['accepted'])
        if raw is not None:
            require(raw['case_id'] == ident and raw['parameters'] == point['parameters'] and raw['split'] == 'verification', ident+' raw identity')
            require(raw['model_sha256'] == bundle['native_model_sha256'] and raw['profile_id'] == profile['id'], ident+' raw source')
            if raw.get('profile_sha256') is not None:
                require(raw['profile_sha256'] == bundle['profile_sha256'], ident+' raw profile hash')
        if row['accepted']:
            require(raw['private_document_closed'] is True and raw['source_unchanged'] is True and raw['profile_sha256'] == bundle['profile_sha256'], ident+' cleanup/identity')
            require(raw['report_available'] is True and raw['report_completion_accepted'] is True and raw['solver_accepted'] is True and raw['control_succeeded'] is True, ident+' native completion gates')
            require(digest(case_dir/'input.bkp') == bundle['native_model_sha256'] and digest(case_dir/'aspen-report.rep') == raw['report_sha256'], ident+' local evidence hashes')
            HELPERS['audit_controls'](profile, raw, point['parameters'])
            residuals.append(HELPERS['audit_case'](profile, raw, read(case_dir/'project.json'), read(case_dir/'assessment.json'), row))
        expected = {'purchased_energy_kWh_kg': row.get('metrics', {}).get('purchased_energy_kWh_kg'), 'yield_fraction': row.get('metrics', {}).get('yield_fraction')}
        expected.update({'impact:'+key: value['value'] for key, value in row.get('metrics', {}).get('impacts', {}).items()})
        require(all(value == expected.get(key) for key, value in observation['outputs'].items()), ident+' dataset metric values')
        record = comparison_record(mapping, point, observation, prediction, policy['criteria'])
        record['raw_evidence_available'] = raw is not None
        record['raw_file_sha256'] = digest(case_dir/'raw.json') if raw is not None else None
        record['report_sha256'] = raw.get('report_sha256') if raw is not None else None
        if raw is None:
            record['errors'].append('Raw capture file is missing; failed or unattempted ledger row retained without native-evidence confirmation')
        if prediction['constraints_passed']:
            HELPERS['prediction_values'](bundle['model'], prediction['inputs'], prediction['outputs'], prediction['id'])
        records.append(record)
    require(sum(row['accepted'] for row in cases.values()) == ledger['accepted_count'] and ledger['failed_count'] == 9-ledger['accepted_count'], 'Native acceptance counts')
    new = [row for row in records if row['new_coordinate']]; repeated = [row for row in records if not row['new_coordinate']]
    require(len(new) == 8 and len(repeated) == 1 and repeated[0]['original_point_id'] == 'case-008', 'Eight new coordinates and one original holdout repeat')
    repeat = repeated[0]; previous = original_rows['case-008']
    repeat_values = {}
    if repeat['native_accepted'] and previous['accepted']:
        for response in dataset['responses']:
            key = response['id']; current, old = repeat['actual'][key], previous['outputs'][key]
            repeat_values[key] = {'unit': response['unit'], 'original': old, 'repeated': current,
                                  'signed_difference': current-old, 'absolute_difference': abs(current-old),
                                  'relative_difference': abs(current-old)/max(abs(old), policy['criteria'][key]['relative_floor'])}
    result = {'comparison_version': 1, 'kind': 'local_native_prediction_comparison',
              'created_at': datetime.now(timezone.utc).isoformat(), 'candidate_id': manifest['candidate_id'],
              **{key: BINDING[key] for key in ('model_sha256', 'bundle_sha256', 'robustness_result_sha256')},
              'profile_sha256': manifest['profile_sha256'], 'native_model_sha256': manifest['native_model_sha256'],
              'local_plan_sha256': manifest['plan_sha256'], 'local_dataset_sha256': dataset['dataset_sha256'],
              'criteria': policy['criteria'], 'criteria_sha256': manifest['criteria_sha256'],
              'source_files': {str(path.relative_to(base)): digest(path) for path in [design/'manifest.json', design/'plan.json', design/'mapping.json', run/'ledger.json', run/'dataset.json']},
              'baseline_artifacts': BINDING['file_sha256'], 'records': records,
              'new_eight': summarize(new, dataset['responses'], policy['criteria']),
              'all_nine_descriptive': summarize(records, dataset['responses'], policy['criteria']),
              'center_repeat': {'id': repeat['id'], 'original_point_id': 'case-008', 'original_split': 'holdout',
                                'available': bool(repeat_values), 'metrics': repeat_values,
                                'scope': 'Repeated execution at an already held-out coordinate, not a new independent validation location. Differences are descriptive; no repeatability acceptance limit was preregistered.'},
              'native_residual_checks': residuals, 'all_planned_cases_retained': True,
              'frozen_model_prediction_enabled': bundle['prediction_enabled'], 'exploratory': not bundle['prediction_enabled'],
              'model_refitted': False, 'model_qualification_changed': False, 'physical_validation': False,
              'scope': manifest['scope']+' Local pass does not override the original independent-verification failure or enable ordinary prediction.'}
    result['comparison_sha256'] = canonical(result)
    return result


def markdown(result):
    lines = ['# Local native perturbation comparison', '',
             'One preselected coordinate-center neighborhood: **8 new coordinates + 1 repeated original holdout**. The original model and 81-query scenario export remain frozen.', '',
             f"New coordinates: {result['new_eight']['valid_pairs']}/8 usable; declared error checks {'passed' if result['new_eight']['passed'] else 'not passed'}. All nine: {result['all_nine_descriptive']['valid_pairs']}/9 usable.", '',
             '| Response | Unit | New-eight maximum relative error | Original criterion |', '|---|---|---:|---:|']
    for key, metric in result['new_eight']['metrics'].items():
        error = 'unavailable' if metric['max_relative_error'] is None else f"{100*metric['max_relative_error']:.6f}%"
        lines.append(f"| {key} | {metric['unit']} | {error} | {100*metric['max_relative_error_criterion']:.1f}% |")
    lines += ['', 'Relative error uses each original unit-specific floor. Any missing native or prediction row blocks a complete group pass; all failed rows remain in the JSON.', '',
              'The center repeats original holdout `case-008` and is reported separately as execution repeatability. It is not a ninth new location.', '',
              '**No model promotion.** In the original two-point independent-verification group, 335 °C / 8.5 m exceeded the 5% policy for all three responses; 345 °C / 17.5 m passed all three. The group therefore remains not passed. This local check does not enable the model, refit it, validate global candidate ranks, assign probabilities, validate background LCA, or demonstrate physical reliability.', '',
              f"Frozen model SHA-256: `{result['model_sha256']}`", f"Comparison SHA-256: `{result['comparison_sha256']}`", '']
    return '\n'.join(lines)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, default=BASE)
    parser.add_argument('--output', type=Path, default=BASE/'local-perturbation-comparison.json')
    args = parser.parse_args()
    try:
        require(not args.output.exists(), 'Prior comparison retained; output already exists')
        note = args.output.with_suffix('.README.md')
        require(not note.exists(), 'Prior comparison README retained')
        result = compare(args.base)
        args.output.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2)+'\n', encoding='utf-8')
        note.write_text(markdown(result), encoding='utf-8')
        print(json.dumps({'output': str(args.output), 'new_eight': result['new_eight'], 'all_nine_descriptive': result['all_nine_descriptive'], 'model_qualification_changed': False}, ensure_ascii=False))
    except (KeyError, ValueError, TypeError, OSError, OverflowError) as error:
        print(json.dumps({'comparison_completed': False, 'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2)
