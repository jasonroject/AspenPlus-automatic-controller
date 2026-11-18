"""Independent read-only audit of finished v2 artifacts; never fits or runs COM.

Uses standard-library scalar covariance arithmetic and source files. Reuses the
separately authored v1 arithmetic checks, not production fit/evaluate/predict.
Prints a report to stdout only after all checks succeed.
"""
from collections import Counter
import json
import math
from pathlib import Path
import runpy
import sys

BASE = Path(__file__).resolve().parent
HELPERS = runpy.run_path(str(BASE/'audit-native-pilot.py'))
read, require, near, digest, canonical, sealed = (HELPERS[key] for key in ('read', 'require', 'near', 'digest', 'canonical', 'sealed'))


def metric_check(records, response, criterion, report):
    key = response['id']; valid = [row for row in records if row['constraints_passed']]
    complete = bool(records) and len(records) == len(valid)
    require(report['unit'] == response['unit'] and report['expected'] == len(records)
            and report['valid_pairs'] == len(valid) and report['complete'] == complete, key+' cohort coverage/unit')
    require(report['relative_floor'] == criterion['relative_floor'] and report['criterion'] == criterion['max_relative_error'], key+' original unit-bound criterion')
    if not complete:
        require(report['passed'] is False and all(report[name] is None for name in ('mae', 'rmse', 'max_relative_error')), key+' no survivor-only cohort result')
        return
    errors = [row['predicted'][key]-row['actual'][key] for row in records]
    expected = {'mae': math.fsum(abs(value) for value in errors)/len(errors),
                'rmse': math.sqrt(math.fsum(value*value for value in errors)/len(errors)),
                'max_relative_error': max(abs(value)/max(abs(row['actual'][key]), criterion['relative_floor']) for row, value in zip(records, errors))}
    for name, value in expected.items():
        near(report[name], value, key+'/'+name)
    require(report['passed'] == (expected['max_relative_error'] <= criterion['max_relative_error']), key+' cohort maximum-error check')


def training_equations(model, training):
    require(model['training_case_ids'] == [row['id'] for row in training], 'Only original12+extension8 used for training')
    require(model['training_inputs_raw'] == [[row['inputs'][spec['id']] for spec in model['inputs']] for row in training], 'Training raw coordinates')
    for i, spec in enumerate(model['inputs']):
        values = [row['inputs'][spec['id']] for row in training]
        average = math.fsum(values)/len(values)
        scale = math.sqrt(math.fsum((value-average)**2 for value in values)/len(values))
        near(model['input_scaler']['mean'][i], average, spec['id']+' training input mean')
        near(model['input_scaler']['scale'][i], scale, spec['id']+' training input scale')
        for value, normalized in zip(values, model['training_inputs_scaled']):
            near(normalized[i], (value-average)/scale, spec['id']+' normalized training coordinate')
    for spec in model['responses']:
        key = spec['id']; values = [row['outputs'][key] for row in training]
        average = math.fsum(values)/len(values)
        scale = math.sqrt(math.fsum((value-average)**2 for value in values)/len(values)) or 1
        fitted = model['regressors'][key]
        near(fitted['output_mean'], average, key+' training target mean')
        near(fitted['output_scale'], scale, key+' training target scale')
        require(fitted['white_noise_level'] == 1e-8 and fitted['alpha'] == 1e-10, key+' fixed numerical noise policy')
        for i, point in enumerate(model['training_inputs_scaled']):
            terms = []
            for j, other in enumerate(model['training_inputs_scaled']):
                radius = math.sqrt(math.fsum(((a-b)/length)**2 for a, b, length in zip(point, other, fitted['length_scale'])))
                q = math.sqrt(5)*radius
                covariance = fitted['constant_value']*(1+q+5*radius**2/3)*math.exp(-q)
                if i == j:
                    covariance += fitted['white_noise_level']+fitted['alpha']
                terms.append(covariance*fitted['dual_coefficients'][j])
            near(math.fsum(terms), (values[i]-average)/scale, key+' covariance equation against frozen training target', atol=2e-5, rtol=2e-6)


def audit(base=BASE):
    output = base/'generic-native-v2-analysis'; design = base/'v2-extension-plan'
    manifest, profile, cohort_design = read(design/'manifest.json'), read(design/'profile.json'), read(design/'cohorts.json')
    policy = read(design/'criteria.json')
    bundle, evaluation, grouped, dataset, project, merged, robust, predictions, summary = [read(output/name) for name in
        ('model.bundle.json', 'evaluation.json', 'cohort-evaluation.json', 'dataset.json', 'project.json', 'merged-ledger.json', 'robustness.json', 'predictions.json', 'summary.json')]
    baseline = read(base/'generic-native-pilot-analysis/model.bundle.json')
    baseline_robust = read(base/'generic-native-pilot-analysis/robustness.json')
    require(not (output/'failure.json').exists(), 'Finalizer left failure.json; partial output is not released')
    marker = read(base/'v2-extension-fit-attempt.json')
    require(marker['maximum_fit_attempts'] == 1 and marker['automatic_retry_allowed'] is False and summary['fit_attempts'] == 1, 'One recorded fit attempt only')
    require(digest(base/'v2-extension-fit-attempt.json') == summary['fit_marker_sha256'], 'Fit marker hash')
    require(marker['dataset_sha256'] == dataset['dataset_sha256'] and marker['frozen_manifest_sha256'] == digest(design/'manifest.json'), 'Fit marker bound to data/design')
    for name, value in manifest['file_sha256'].items():
        require(digest(design/name) == value, 'Frozen v2 design file '+name)
    for name, value in manifest['canonical_sha256'].items():
        require(canonical(read(design/name)) == value, 'Frozen v2 canonical file '+name)
    root = base.parents[1]
    for name, value in manifest['source_file_sha256'].items():
        require(digest(root/name) == value, 'Original design/algorithm changed '+name)
    for name, value in summary['artifact_sha256'].items():
        require(digest(output/name) == value, 'Finalizer artifact hash '+name)
    protected = read(output/'protected-source-hashes.json')
    require(protected['unchanged'] is True and all(digest(Path(name)) == value for name, value in protected['files'].items()), 'Protected old source bytes changed')
    require(bundle['model_sha256'] != baseline['model_sha256'] and bundle['bundle_sha256'] != baseline['bundle_sha256'], 'v2 and v1 remain distinct artifacts')
    require(baseline['model_sha256'] == manifest['baseline_model_sha256'] and baseline['bundle_sha256'] == manifest['baseline_bundle_sha256'], 'Baseline v1 binding')
    for current in (bundle, baseline):
        sealed(current, 'bundle_sha256'); require(canonical(current['model']) == current['model_sha256'], 'Model state hash')
    sealed(dataset, 'dataset_sha256'); sealed(robust, 'result_sha256')
    require(canonical(profile) == bundle['profile_sha256'] == dataset['profile_sha256'] == manifest['profile_sha256'], 'Profile identity')
    require(profile['model']['sha256'] == bundle['native_model_sha256'] == dataset['model_sha256'], 'Native source identity')
    require(bundle['dataset_sha256'] == dataset['dataset_sha256'] and dataset == {**bundle['dataset_metadata'], 'rows': bundle['observations']}, 'Entire dataset retained in bundle')
    require(dataset['evidence_type'] == bundle['evidence_type'] == 'native_simulation', 'Native evidence declaration')
    require(dataset['inputs'] == bundle['model']['inputs'] and dataset['responses'] == bundle['model']['responses'], 'Model variable units')
    require(dataset['basis'] == baseline['dataset_metadata']['basis'], 'Accounting basis unchanged')
    require(len(dataset['rows']) == len({row['id'] for row in dataset['rows']}) == 37, '37 unique native records')
    require(Counter(row['split'] for row in dataset['rows']) == {'training': 20, 'holdout': 3, 'verification': 14}, '20/3/14 split')
    require(all(row['accepted'] is True and all(value is True for value in row['gates'].values()) for row in dataset['rows']), 'All planned unique native cases accepted')
    planned = {row['id']: row for row in cohort_design['rows']}
    observations = {row['id']: row for row in dataset['rows']}
    require(set(planned) == set(observations) and len({tuple(row['inputs'][spec['id']] for spec in dataset['inputs']) for row in dataset['rows']}) == 37, 'Unique frozen coordinates')
    originals = {row['id']: row for row in baseline['observations']}
    checks = read(output/'native-checks.json')
    checked = {(row['batch'], row['id']): row for row in checks['cases']}
    require(len(checked) == len(checks['cases']) == checks['native_runs_retained'] == 38 and checks['unique_cases'] == 37, 'Full38 raw ledger and unique37 count')
    batch_ledgers = {batch: read(base/batch/'ledger.json') for batch in {row['batch'] for row in cohort_design['rows']}}
    native_lookup = {(batch, row['id']): row for batch, ledger in batch_ledgers.items() for row in ledger['cases']}
    require(set(checked) == set(native_lookup), 'Every retained native run has an audit record')
    merged_rows = {row['id']: row for row in merged['cases']}
    require(set(merged_rows) == set(observations) and merged['retained_native_runs'] == 38, 'Merged ledger unique/full counts')
    residuals = []; expected_tables = {key: [] for key in ('cases', 'streams', 'blocks', 'inventory')}
    for ident, declaration in planned.items():
        observed = observations[ident]; batch = declaration['batch']; native = native_lookup[batch, ident]
        require(observed['split'] == declaration['split'] == native['split'] and observed['inputs'] == declaration['inputs'] == native['inputs'], ident+' frozen role/inputs')
        require(observed['source'] == declaration['source'] == f'{batch}/runs/{ident}/raw.json' and merged_rows[ident]['source'] == observed['source'], ident+' namespaced source')
        if ident in originals:
            old = originals[ident]
            require(observed['split'] == old['split'] and observed['inputs'] == old['inputs'] and observed['outputs'] == old['outputs'], ident+' original native record changed')
        raw_path = base/observed['source']; raw = read(raw_path); check = checked[batch, ident]
        require(digest(raw_path) == check['raw_file_sha256'] and check['included_in_unique_dataset'] is True, ident+' raw hash/selection')
        require(raw['case_id'] == ident and raw['split'] == observed['split'] and raw['parameters'] == observed['inputs'], ident+' captured identity')
        require(raw['model_sha256'] == profile['model']['sha256'] and raw['profile_sha256'] == canonical(profile), ident+' captured source')
        require(raw['private_document_closed'] is True and raw['source_unchanged'] is True and raw['control_succeeded'] is True and raw['solver_accepted'] is True and raw['report_completion_accepted'] is True, ident+' native execution gates')
        require(digest(raw_path.parent/'input.bkp') == raw['model_sha256'] and digest(raw_path.parent/'aspen-report.rep') == raw['report_sha256'] == check['report_sha256'], ident+' copy/report hashes')
        HELPERS['audit_controls'](profile, raw, observed['inputs'])
        original_project, assessment = read(raw_path.parent/'project.json'), read(raw_path.parent/'assessment.json')
        residuals.append(HELPERS['audit_case'](profile, raw, original_project, assessment, native))
        expected = {'purchased_energy_kWh_kg': native['metrics']['purchased_energy_kWh_kg'], 'yield_fraction': native['metrics']['yield_fraction'],
                    **{'impact:'+key: value['value'] for key, value in native['metrics']['impacts'].items()}}
        require(observed['outputs'] == expected, ident+' native metric import')
        for table in expected_tables:
            for row in original_project[table]:
                expected_tables[table].append({**row, 'source': row['source'].replace(f'raw evidence runs/{ident}/raw.json', f'raw evidence {observed["source"]}')})
    require(all(project[table] == rows for table, rows in expected_tables.items()), 'Combined project preserves every unique native table row')
    require(project['factors'] == profile['mapping']['factors'], 'Shared factor table')
    require(project['meta']['scan_audit']['planned'] == project['meta']['scan_audit']['accepted'] == 37 and project['meta']['scan_audit']['failed'] == 0, 'Shared project counts')
    repeat = cohort_design['excluded_repeats'][0]
    require(repeat['id'] == 'local-05' and repeat['original_point_id'] == 'case-008' and repeat['id'] not in observations and repeat['inputs'] == observations['case-008']['inputs'], 'Separate repeated center')
    require(project['meta']['retained_native_runs']['total'] == 38 and project['meta']['retained_native_runs']['excluded_repeats'] == cohort_design['excluded_repeats'], 'Full38 appendix metadata')
    repeat_check = checked[repeat['batch'], repeat['id']]
    require(repeat_check['included_in_unique_dataset'] is False and digest(base/repeat['source']) == repeat_check['raw_file_sha256'], 'Repeat raw retained outside dataset')
    training = [row for row in dataset['rows'] if row['split'] == 'training']
    require(marker['training_ids'] == [row['id'] for row in training], 'Fit marker training-only IDs')
    training_equations(bundle['model'], training)
    scalar_records = []
    evaluation_by_id = {row['id']: row for row in evaluation['records']}
    for row in dataset['rows']:
        values = HELPERS['posterior_mean'](bundle['model'], row['inputs'])
        if row['split'] != 'training':
            recorded = evaluation_by_id[row['id']]
            HELPERS['prediction_values'](bundle['model'], row['inputs'], recorded['predicted'], row['id'])
        scalar_records.append({'id': row['id'], 'split': row['split'], 'native_outputs': row['outputs'], 'scalar_mean': values,
                               'absolute_residual': {key: abs(value-row['outputs'][key]) for key, value in values.items()},
                               'scope': 'Training residual, not independent validation' if row['split'] == 'training' else 'Frozen held-out/verification prediction'})
    split_errors = HELPERS['audit_evaluation'](bundle, evaluation, policy, dataset)
    require(grouped['model_sha256'] == bundle['model_sha256'] and grouped['dataset_sha256'] == dataset['dataset_sha256'] and grouped['cohort_design_sha256'] == canonical(cohort_design), 'Cohort report model/design binding')
    require(grouped['criteria'] == policy['criteria'], 'Cohort rules unchanged')
    require(set(grouped['cohorts']) == set(cohort_design['cohort_counts']), 'Every declared cohort reported')
    for cohort, count in cohort_design['cohort_counts'].items():
        members = [row for row in cohort_design['rows'] if row['cohort'] == cohort]; report = grouped['cohorts'][cohort]
        require(report['expected'] == len(members) == count, cohort+' fixed cohort count')
        if members[0]['split'] == 'training':
            require(report['role'] == 'training' and report['out_of_sample'] is False and report['ids'] == [row['id'] for row in members], cohort+' training is not validation')
            continue
        records = [evaluation_by_id[row['id']] for row in members]
        require(report['records'] == records and report['prospectively_reserved_for_v2'] == (cohort == 'prospective_verification_4'), cohort+' fresh/known separation')
        for response in dataset['responses']:
            metric_check(records, response, policy['criteria'][response['id']], report['metrics'][response['id']])
        require(report['complete'] == all(row['constraints_passed'] for row in records) and report['passed'] == all(metric['passed'] for metric in report['metrics'].values()), cohort+' acceptance')
    point = grouped['original_failed_point']; failed_id = 'verify-T335-L8p5'
    require(point['record'] == evaluation_by_id[failed_id] and point['v1_frozen_record'] == next(row for row in baseline['validation']['records'] if row['id'] == failed_id), 'Original failed point retained with v1 comparison')
    for response in dataset['responses']:
        metric_check([point['record']], response, policy['criteria'][response['id']], point['metrics'][response['id']])
    require(summary['prospective_verification_4'] == grouped['cohorts']['prospective_verification_4'] and summary['original_failed_point'] == point, 'Summary retains separate fresh4/original-failure evidence')
    queries = read(base/'generic-pilot-plan/queries.json')
    require(predictions['model_sha256'] == bundle['model_sha256'] and [row['inputs'] for row in predictions['records']] == queries['points'], 'Original demonstration queries bound to v2')
    for row in predictions['records']:
        if row['constraints_passed']:
            HELPERS['prediction_values'](bundle['model'], row['inputs'], row['outputs'], row['id'])
    require(robust['config'] == baseline_robust['config'] and robust['config_sha256'] == baseline_robust['config_sha256'], 'Original deterministic scenario config unchanged')
    require(robust['model_sha256'] != baseline_robust['model_sha256'] and robust['result_sha256'] != baseline_robust['result_sha256'], 'v2 robustness remains distinct from v1')
    require([(row['id'], row['inputs']) for row in robust['records']] == [(row['id'], row['inputs']) for row in baseline_robust['records']], 'Same 81 candidate/scenario identities and queries')
    robust_check = HELPERS['audit_robustness'](bundle, robust, read(base/'generic-pilot-plan/robustness.config.json'))
    require(robust_check['queries'] == 81, '81 scenarios retained')
    require(summary['prediction_enabled'] == grouped['prediction_enabled'] == bundle['prediction_enabled'] == evaluation['passed'], 'No qualification override')
    require(summary['exploratory'] == robust['exploratory'] == predictions['exploratory'] == (not bundle['prediction_enabled']), 'Exploratory flags consistent')
    return {'audit_passed': True, 'unique_native_cases': 37, 'native_runs_retained': 38,
            'counts': dict(Counter(row['split'] for row in dataset['rows'])), 'model_sha256': bundle['model_sha256'],
            'validation_passed': evaluation['passed'], 'prediction_enabled': bundle['prediction_enabled'],
            'split_error_checks': split_errors,
            'prospective_verification_4': grouped['cohorts']['prospective_verification_4'],
            'original_failed_point': point, 'scalar_mean_checks': scalar_records, 'native_residual_checks': residuals,
            'robustness_checks': robust_check, 'old_source_file_hashes_checked': len(protected['files']),
            'model_refitted': False, 'native_execution_performed': False, 'physical_validation': False,
            'scope': 'Independent scalar covariance/mean arithmetic, native conversions/residuals/fixed LCIA, fixed roles and separate fresh-cohort errors, unchanged deterministic scenario design and rank arithmetic. No universal accuracy, probability, physical validation, or external authenticity claim.'}


if __name__ == '__main__':
    try:
        print(json.dumps(audit(), ensure_ascii=False, allow_nan=False, indent=2))
    except (KeyError, ValueError, TypeError, OSError, OverflowError) as error:
        print(json.dumps({'audit_passed': False, 'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2)
