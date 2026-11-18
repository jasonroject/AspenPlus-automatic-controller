"""Guarded one-fit finalizer for the frozen 37-unique-point v2 extension.

Run only after the root has confirmed all three native batches finished. This
script never opens Aspen. Existing output or the exclusive fit marker blocks a
second attempt, including after an interrupted or failed fit.
"""
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import runpy
import sys

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[1]
sys.path.insert(0, str(ROOT))
from process_pipeline.normalize import combine_projects, normalize_capture
from process_pipeline.profile import canonical_hash, digest, validate_plan
from process_pipeline.runner import GATES, assess_file, build_dataset, report_messages
from process_pipeline.surrogate import fit, evaluate, predict
from process_pipeline.robustness import analyze_robustness

AUDIT = runpy.run_path(str(BASE/'audit-native-pilot.py'))
read, require = AUDIT['read'], AUDIT['require']
OUTPUT_NAME = 'generic-native-v2-analysis'
MARKER_NAME = 'v2-extension-fit-attempt.json'
BATCH_DESIGNS = {
    'generic-native-pilot-17': 'generic-pilot-plan',
    'native-local-perturbation-9': 'local-perturbation-plan',
    'native-v2-extension-12': 'v2-extension-plan',
}


def write(path, value):
    with path.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2)+'\n')


def available_output(base):
    output, marker = base/OUTPUT_NAME, base/MARKER_NAME
    require(not output.exists(), 'Prior v2 output exists; no refit or overwrite')
    require(not marker.exists(), 'A v2 fit attempt was already recorded; no retry')
    return output, marker


def snapshot(paths):
    files = set()
    for path in paths:
        if path.is_dir():
            files.update(item.resolve() for item in path.rglob('*') if item.is_file())
        else:
            require(path.is_file(), 'Protected source missing: '+str(path))
            files.add(path.resolve())
    return {str(path): digest(path) for path in sorted(files)}


def unchanged(before, paths):
    require(snapshot(paths) == before, 'A protected old file was changed, added or removed; do not publish this analysis')


def frozen_design(base):
    design = base/'v2-extension-plan'; manifest = read(design/'manifest.json')
    for filename, expected in manifest['file_sha256'].items():
        require(digest(design/filename) == expected, 'Frozen v2 file changed: '+filename)
    for filename, expected in manifest['canonical_sha256'].items():
        require(canonical_hash(read(design/filename)) == expected, 'Frozen v2 canonical hash changed: '+filename)
    for filename, expected in manifest['source_file_sha256'].items():
        require(digest(ROOT/filename) == expected, 'Bound original design/algorithm changed: '+filename)
    profile, cohorts, criteria = read(design/'profile.json'), read(design/'cohorts.json'), read(design/'criteria.json')
    require(canonical_hash(profile) == manifest['profile_sha256'], 'Frozen profile identity')
    require((design/'profile.json').read_bytes() == (base/'generic-pilot-plan/profile.json').read_bytes(), 'Profile changed between versions')
    require((design/'criteria.json').read_bytes() == (base/'generic-pilot-plan/criteria.json').read_bytes(), 'Criteria changed between versions')
    baseline = read(base/'generic-native-pilot-analysis/model.bundle.json')
    require(baseline['model_sha256'] == manifest['baseline_model_sha256'] and baseline['bundle_sha256'] == manifest['baseline_bundle_sha256'], 'Baseline v1 identity')
    AUDIT['sealed'](baseline, 'bundle_sha256')
    require(canonical_hash(baseline['model']) == baseline['model_sha256'], 'Baseline model state hash')
    robust_manifest = read(base/'generic-pilot-plan/robustness-manifest.json')
    config_path = base/'generic-pilot-plan/robustness.config.json'
    require(digest(config_path) == robust_manifest['config_file_sha256'] and canonical_hash(read(config_path)) == robust_manifest['config_sha256'], 'Original fixed 81-query design changed')
    require(len(cohorts['rows']) == len({row['id'] for row in cohorts['rows']}) == 37, '37 unique planned IDs')
    coordinates = [tuple(row['inputs'][key] for key in ('reactor_temperature_K', 'tube_length_m')) for row in cohorts['rows']]
    require(len(set(coordinates)) == 37 and Counter(row['split'] for row in cohorts['rows']) == {'training': 20, 'holdout': 3, 'verification': 14}, '37 unique coordinates and fixed 20/3/14 split')
    require(len(cohorts['excluded_repeats']) == 1 and cohorts['excluded_repeats'][0]['id'] == 'local-05' and cohorts['excluded_repeats'][0]['original_point_id'] == 'case-008', 'Retained center repeat remains separate')
    return profile, cohorts, criteria, manifest, baseline


def check_batch(base, batch, profile, required_ids):
    run = base/batch; design = base/BATCH_DESIGNS[batch]
    plan, ledger, dataset = read(design/'plan.json'), read(run/'ledger.json'), read(run/'dataset.json')
    validate_plan(plan, profile)
    require(ledger.get('finished_at') and ledger.get('all_planned_cases_retained') is True, batch+' is unfinished; no fit')
    require(ledger.get('mode') == 'native_scan' and ledger.get('source_unchanged') is True, batch+' source/native-run mode')
    require(ledger['profile_sha256'] == canonical_hash(profile) and ledger['model_sha256'] == profile['model']['sha256'], batch+' profile/model identity')
    require(ledger['plan_sha256'] == canonical_hash(plan), batch+' frozen plan identity')
    require(read(run/'plan.json') == plan and read(run/'profile.json') == profile, batch+' runtime design copies')
    expected = {point['id']: point for point in plan['points']}
    require(ledger['planned_count'] == len(expected) == len(ledger['cases']) and {row['id'] for row in ledger['cases']} == set(expected), batch+' all planned rows retained without duplicates')
    require(ledger['accepted_count'] == sum(row['accepted'] is True for row in ledger['cases']) and ledger['failed_count'] == len(expected)-ledger['accepted_count'], batch+' acceptance counts')
    require(canonical_hash(dataset) == canonical_hash(build_dataset(profile, ledger)), batch+' dataset must equal its recorded ledger')
    require(dataset['evidence_type'] == 'native_simulation', batch+' must retain native evidence type')
    cases, projects, checks = {}, {}, []
    for row in ledger['cases']:
        ident = row['id']; point = expected[ident]
        require(row['split'] == point['split'] and row['inputs'] == point['parameters'], batch+'/'+ident+' frozen split/inputs')
        require(set(row['gates']) == set(GATES) and all(isinstance(value, bool) for value in row['gates'].values()), ident+' five explicit gates')
        require(row['accepted'] == all(row['gates'].values()), ident+' accepted/gates consistency')
        if ident in required_ids:
            require(row['accepted'] is True and row.get('attempted') is True and row['normalization_complete'] is True, ident+' is a failed/missing unique point; complete v2 acceptance blocked')
        require(row['source'] == f'runs/{ident}/raw.json', ident+' exact source path')
        raw_path = (run/row['source']).resolve(); raw_path.relative_to(run.resolve())
        raw = read(raw_path)
        require(raw.get('evidence_type') == row['evidence_type'] == 'native_simulation', ident+' native evidence declarations')
        require(raw['case_id'] == ident and raw['split'] == point['split'] and raw['parameters'] == point['parameters'], ident+' raw identity')
        require(raw['profile_id'] == profile['id'] and raw['model_sha256'] == profile['model']['sha256'], ident+' raw model identity')
        require(raw.get('private_document_closed') is True and raw.get('source_unchanged') is True and raw.get('timed_out') is not True, ident+' cleanup/source/timeout')
        source = Path(raw['source_model_path'])
        require(source.is_absolute() and source.resolve() == (ROOT/'outputs/htl_pipeline/live/source_HR.bkp').resolve(), ident+' source path differs from the bound HTL archive')
        require(digest(source) == profile['model']['sha256'] == raw['source_sha256_after'], ident+' original archive unchanged')
        require(digest(raw_path.parent/'input.bkp') == profile['model']['sha256'], ident+' isolated copy identity')
        if raw.get('report_available'):
            report_path = raw_path.parent/'aspen-report.rep'
            require(digest(report_path) == raw['report_sha256'], ident+' raw report hash')
            _, rejected, completed = report_messages(report_path.read_text(errors='replace'))
            require(raw['report_completion_accepted'] == (completed and not rejected), ident+' report completion declaration')
        if row['accepted']:
            require(raw['profile_sha256'] == canonical_hash(profile) and raw['control_succeeded'] is True and raw['solver_accepted'] is True and raw['report_available'] is True and raw['report_completion_accepted'] is True, ident+' accepted native evidence gates')
            AUDIT['audit_controls'](profile, raw, point['parameters'])
            project = read(raw_path.parent/'project.json'); assessment = read(raw_path.parent/'assessment.json')
            require(project == normalize_capture(profile, raw), ident+' shared raw-to-project mapping')
            require(project['factors'] == profile['mapping']['factors'], ident+' common frozen factor table')
            assessed = assessment['cases']
            require(len(assessed) == 1 and assessed[0]['id'] == ident and assessed[0]['metrics'] == row['metrics'], ident+' assessment/ledger metrics')
            require(all(assessed[0][key] is True for key in ('numerical_closure', 'lcia_complete', 'metric_inputs_complete')), ident+' calculated acceptance gates')
            AUDIT['audit_case'](profile, raw, project, assessment, row)
            projects[ident] = project
        cases[ident] = row
        checks.append({'id': ident, 'batch': batch, 'source': f'{batch}/runs/{ident}/raw.json', 'split': row['split'],
                       'accepted': row['accepted'], 'gates': row['gates'], 'error': row['error'], 'warnings': row['warnings'],
                       'included_in_unique_dataset': ident in required_ids,
                       'raw_file_sha256': digest(raw_path), 'report_sha256': raw.get('report_sha256'),
                       'copy_sha256': profile['model']['sha256'], 'profile_sha256': raw.get('profile_sha256'),
                       'private_document_closed': raw['private_document_closed'], 'source_unchanged': raw['source_unchanged']})
    return {'cases': cases, 'projects': projects, 'checks': checks, 'ledger': ledger,
            'dataset_sha256': dataset['dataset_sha256'], 'ledger_file_sha256': digest(run/'ledger.json')}


def merge_batches(profile, cohorts, batches):
    cases, projects = [], []
    for design in cohorts['rows']:
        batch, ident = design['batch'], design['id']; row = deepcopy(batches[batch]['cases'][ident])
        require(row['accepted'] is True and row['split'] == design['split'] and row['inputs'] == design['inputs'], ident+' frozen merge selection')
        require(design['source'] == f'{batch}/runs/{ident}/raw.json', ident+' namespaced source')
        row['source'] = design['source']; cases.append(row)
        project = deepcopy(batches[batch]['projects'][ident])
        require(project['factors'] == profile['mapping']['factors'], ident+' factor consistency before merge')
        for table in ('cases', 'streams', 'blocks', 'inventory'):
            for item in project[table]:
                item['source'] = item['source'].replace(f'raw evidence runs/{ident}/raw.json', f'raw evidence {design["source"]}')
        projects.append(project)
    require(len(cases) == 37 and Counter(row['split'] for row in cases) == cohorts['counts'], 'All frozen unique rows selected')
    merged = {'ledger_version': 1, 'mode': 'verified_three_batch_merge', 'profile_id': profile['id'],
              'profile_sha256': canonical_hash(profile), 'model_sha256': profile['model']['sha256'],
              'cohort_design_sha256': canonical_hash(cohorts), 'planned_count': 37, 'accepted_count': 37, 'failed_count': 0,
              'all_planned_cases_retained': True, 'cases': cases, 'source_unchanged': True, 'physical_validation': False,
              'retained_native_runs': 38, 'excluded_repeated_coordinates': deepcopy(cohorts['excluded_repeats']),
              'source_batches': {name: {'dataset_sha256': data['dataset_sha256'], 'ledger_file_sha256': data['ledger_file_sha256'],
                                        'plan_sha256': data['ledger']['plan_sha256']} for name, data in batches.items()}}
    dataset = build_dataset(profile, merged)
    project = combine_projects(profile, projects)
    project['meta']['scan_audit'] = {'planned': 37, 'attempted': 37, 'solver_accepted': 37, 'numerically_closed': 37,
                                   'lcia_complete': 37, 'accepted': 37, 'failed': 0,
                                   'source_profile_sha256': canonical_hash(profile), 'model_sha256': profile['model']['sha256'],
                                   'cohort_design_sha256': canonical_hash(cohorts),
                                   'cases': [{key: row[key] for key in ('id', 'split', 'gates', 'accepted', 'error', 'source')} for row in cases]}
    project['meta']['retained_native_runs'] = {'total': 38, 'unique_in_project': 37, 'additional_repeat_count': 1,
                                             'excluded_repeats': deepcopy(cohorts['excluded_repeats']),
                                             'source_paths_relative_to': cohorts['source_paths_relative_to'],
                                             'scope': 'All 38 native run records remain in their original batches. The repeated center is an appendix record, not an extra unique project case.'}
    return merged, dataset, project


def group_metrics(records, responses, rules):
    complete = bool(records) and all(row['constraints_passed'] for row in records)
    metrics = {}
    for response in responses:
        key = response['id']; rule = rules[key]
        item = {'unit': response['unit'], 'expected': len(records), 'valid_pairs': sum(row['constraints_passed'] for row in records),
                'complete': complete, 'mae': None, 'rmse': None, 'max_relative_error': None,
                'relative_floor': rule['relative_floor'], 'criterion': rule['max_relative_error'], 'passed': False}
        if complete:
            errors = [row['predicted'][key]-row['actual'][key] for row in records]
            item.update(mae=math.fsum(abs(error) for error in errors)/len(errors), rmse=math.sqrt(math.fsum(error*error for error in errors)/len(errors)),
                        max_relative_error=max(abs(error)/max(abs(row['actual'][key]), rule['relative_floor']) for row, error in zip(records, errors)))
            item['passed'] = item['max_relative_error'] <= rule['max_relative_error']
        metrics[key] = item
    return {'expected': len(records), 'valid_pairs': sum(row['constraints_passed'] for row in records),
            'complete': complete, 'passed': complete and all(item['passed'] for item in metrics.values()), 'metrics': metrics}


def cohort_evaluation(bundle, evaluation, cohorts, baseline):
    records = {row['id']: row for row in evaluation['records']}
    planned_validation = {row['id'] for row in cohorts['rows'] if row['split'] != 'training'}
    require(set(records) == planned_validation and len(evaluation['records']) == 17, 'Every fixed validation row retained exactly once')
    reports = {}
    for cohort, count in cohorts['cohort_counts'].items():
        members = [row for row in cohorts['rows'] if row['cohort'] == cohort]
        require(len(members) == count, 'Frozen cohort count')
        if members[0]['split'] == 'training':
            reports[cohort] = {'expected': count, 'ids': [row['id'] for row in members], 'role': 'training', 'out_of_sample': False,
                               'scope': 'Fitting inputs only; no held-out error claim or validation pass is assigned.'}
        else:
            selected = [records[row['id']] for row in members]
            reports[cohort] = {**group_metrics(selected, bundle['model']['responses'], bundle['validation_policy']),
                               'role': members[0]['split'], 'out_of_sample': True,
                               'prospectively_reserved_for_v2': cohort == 'prospective_verification_4', 'records': selected,
                               'scope': 'New prospectively reserved v2 coordinates' if cohort == 'prospective_verification_4' else 'Legacy/development or separately selected local evidence; not a new independent v2 test'}
    current = records['verify-T335-L8p5']; old = next(row for row in baseline['validation']['records'] if row['id'] == current['id'])
    require(old['inputs'] == current['inputs'] and old['actual'] == current['actual'], 'Original failed native point must not change')
    point = {**group_metrics([current], bundle['model']['responses'], bundle['validation_policy']),
             'record': current, 'v1_frozen_record': old, 'scope': 'Previously known v1 failure, retained as development evidence; not a new independent test'}
    return {'result_version': 1, 'kind': 'v2_cohort_evaluation', 'model_sha256': bundle['model_sha256'],
            'baseline_model_sha256': baseline['model_sha256'], 'dataset_sha256': bundle['dataset_sha256'],
            'cohort_design_sha256': canonical_hash(cohorts), 'criteria': bundle['validation_policy'],
            'cohorts': reports, 'original_failed_point': point, 'overall_validation_passed': evaluation['passed'],
            'prediction_enabled': bundle['prediction_enabled'], 'scope': 'Separate fixed-cohort error reports; no criteria override, repartition, model search, or physical validation.'}


def finalize(base=BASE):
    output, marker = available_output(base)
    profile, cohorts, criteria, manifest, baseline = frozen_design(base)
    # Check completion before traversing source files or creating any output.
    for batch in BATCH_DESIGNS:
        ledger = read(base/batch/'ledger.json')
        require(ledger.get('finished_at') and ledger.get('all_planned_cases_retained') is True, batch+' is incomplete; no fit marker or output created')
    protected = [base/batch for batch in BATCH_DESIGNS]+[base/name for name in ('generic-pilot-plan', 'local-perturbation-plan', 'v2-extension-plan', 'generic-native-pilot-analysis')]
    protected += [ROOT/'outputs/htl_pipeline/live/source_HR.bkp', Path(__file__).resolve(), base/'audit-native-pilot.py']
    protected += [ROOT/name for name in ('process_pipeline/surrogate.py', 'process_pipeline/robustness.py', 'process_pipeline/normalize.py', 'process_pipeline/runner.py', 'process_pipeline/profile.py', 'process_pipeline/assess_project.mjs', 'analysis_web/universal-core.mjs')]
    for name in ('local-perturbation-comparison.json', 'local-perturbation-comparison.README.md', 'generic-native-pilot-independent-audit.json'):
        if (base/name).exists():
            protected.append(base/name)
    before = snapshot(protected)
    batches = {batch: check_batch(base, batch, profile, {row['id'] for row in cohorts['rows'] if row['batch'] == batch}) for batch in BATCH_DESIGNS}
    merged, dataset, project = merge_batches(profile, cohorts, batches)
    require(len(dataset['rows']) == 37 and all(row['accepted'] is True for row in dataset['rows']), 'All 37 unique points must be accepted before fitting')
    unchanged(before, protected)
    output.mkdir(exist_ok=False)
    try:
        write(output/'merged-ledger.json', merged); write(output/'dataset.json', dataset); write(output/'project.json', project)
        write(output/'cohorts.json', cohorts)
        assessment = assess_file(output, output/'project.json', output/'assessment.json')
        require(not assessment.get('error') and len(assessment['cases']) == 37, 'Merged shared-core assessment failed')
        checked = {row['id']: row for row in assessment['cases']}
        require(set(checked) == {row['id'] for row in merged['cases']}, 'Shared-core case coverage')
        for row in merged['cases']:
            require(checked[row['id']]['metrics'] == row['metrics'] and all(checked[row['id']][key] is True for key in ('numerical_closure', 'lcia_complete', 'metric_inputs_complete')), row['id']+' combined core differs from original audited metrics')
        unchanged(before, protected)
        write(marker, {'fit_attempt_started_at': datetime.now(timezone.utc).isoformat(),
                       'output': str(output), 'dataset_sha256': dataset['dataset_sha256'],
                       'frozen_manifest_sha256': digest(base/'v2-extension-plan/manifest.json'),
                       'algorithm_file_sha256': digest(ROOT/'process_pipeline/surrogate.py'),
                       'maximum_fit_attempts': 1, 'automatic_retry_allowed': False,
                       'training_ids': [row['id'] for row in dataset['rows'] if row['split'] == 'training']})
        # The only fit call in this script. No alternate configurations or retry.
        bundle = fit(dataset, criteria)
        require(bundle['model']['training_case_ids'] == [row['id'] for row in dataset['rows'] if row['split'] == 'training'], 'Only original12+new8 trained')
        evaluation = evaluate(bundle); require(evaluation == bundle['validation'], 'Frozen model evaluation mismatch')
        grouped = cohort_evaluation(bundle, evaluation, cohorts, baseline)
        queries = read(base/'generic-pilot-plan/queries.json')
        exploratory = not bundle['prediction_enabled']
        predictions = predict(bundle, queries['points'], allow_exploratory=exploratory, units=queries['units'])
        robust = analyze_robustness(bundle, read(base/'generic-pilot-plan/robustness.config.json'), allow_exploratory=exploratory)
        require(robust['query_count'] == 81 and robust['model_sha256'] == bundle['model_sha256'], 'Original 81 queries bound to v2')
        unchanged(before, protected)
        native_checks = {'native_runs_retained': 38, 'unique_cases': 37, 'unique_accepted': 37,
                         'cases': [row for batch in batches.values() for row in batch['checks']],
                         'excluded_repeats': cohorts['excluded_repeats'], 'source_unchanged': True,
                         'physical_validation': False, 'scope': 'Local raw/report/copy/control/core checks. JSON labels alone do not independently authenticate native execution.'}
        artifacts = {'model.bundle.json': bundle, 'evaluation.json': evaluation, 'cohort-evaluation.json': grouped,
                     'predictions.json': predictions, 'robustness.json': robust, 'native-checks.json': native_checks,
                     'protected-source-hashes.json': {'unchanged': True, 'files': before}}
        for name, value in artifacts.items():
            write(output/name, value)
        all_names = [path.name for path in output.iterdir() if path.is_file()]
        summary = {'created_at': datetime.now(timezone.utc).isoformat(), 'version': 'v2-extension',
                   'native_runs_retained': 38, 'unique_native_cases': 37, 'accepted_unique_cases': 37,
                   'counts': bundle['readiness']['counts'], 'model_sha256': bundle['model_sha256'],
                   'baseline_model_sha256': baseline['model_sha256'], 'dataset_sha256': dataset['dataset_sha256'],
                   'validation_passed': evaluation['passed'], 'prediction_enabled': bundle['prediction_enabled'], 'exploratory': exploratory,
                   'prospective_verification_4': grouped['cohorts']['prospective_verification_4'],
                   'original_failed_point': grouped['original_failed_point'],
                   'scenario_queries': robust['query_count'], 'rank_complete': robust['rank_complete'],
                   'fit_attempts': 1, 'criteria_changed': False, 'original_splits_changed': False,
                   'old_files_unchanged': True, 'physical_validation': False,
                   'artifact_sha256': {name: digest(output/name) for name in all_names},
                   'fit_marker_sha256': digest(marker), 'scope': 'One predeclared adaptive v2 extension; fresh four-point evidence is separate from all known/development validation.'}
        write(output/'summary.json', summary)
        return summary
    except Exception as error:
        failure = output/'failure.json'
        if not failure.exists():
            write(failure, {'failed_at': datetime.now(timezone.utc).isoformat(), 'error': str(error),
                            'fit_attempt_recorded': marker.exists(), 'retry_allowed': False,
                            'scope': 'Partial output is not a released/qualified v2. Original evidence remains separate.'})
        raise


if __name__ == '__main__':
    try:
        summary = finalize()
        print(json.dumps({key: summary[key] for key in ('version', 'counts', 'model_sha256', 'validation_passed', 'prediction_enabled', 'exploratory', 'scenario_queries', 'old_files_unchanged')}, ensure_ascii=False, indent=2))
    except Exception as error:
        print(json.dumps({'status': 'blocked', 'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2)
