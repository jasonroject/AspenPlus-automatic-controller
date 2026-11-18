"""Validate a completed v2 finalizer, then optionally publish its frozen JSON bytes.

Default invocation is read-only. --write creates one new public package after all
checks pass; existing output is never replaced. This script never starts Aspen,
fits a model, reads native raw captures, or publishes private execution files.
"""
from collections import Counter
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[1]
OUT = ROOT / 'analysis_web/data/generic-htl-extension'
COUNTS = {'training': 20, 'holdout': 3, 'verification': 14}
COHORTS = {'original_training_12': 12, 'legacy_holdout_3': 3,
           'legacy_verification_2': 2, 'local_verification_8': 8,
           'extension_training_8': 8, 'prospective_verification_4': 4}
GATES = {'control_succeeded', 'solver_accepted', 'numerical_closure',
         'lcia_complete', 'metric_inputs_complete'}
ANALYSIS_FILES = ('model.bundle.json', 'evaluation.json', 'cohort-evaluation.json',
                  'predictions.json', 'robustness.json', 'native-checks.json',
                  'summary.json', 'project.json', 'dataset.json', 'cohorts.json')
SOURCE_MAP = {**{name: 'generic-native-v2-analysis/' + name for name in ANALYSIS_FILES},
              'profile.json': 'v2-extension-plan/profile.json',
              'extension-plan.json': 'v2-extension-plan/plan.json',
              'criteria.json': 'v2-extension-plan/criteria.json',
              'scan-preregistration.json': 'v2-extension-plan/manifest.json',
              'scenario-config.json': 'generic-pilot-plan/robustness.config.json',
              'scenario-preregistration.json': 'generic-pilot-plan/robustness-manifest.json',
              'queries.json': 'generic-pilot-plan/queries.json',
              'local-perturbation-comparison.json': 'local-perturbation-comparison.json',
              'local-plan.json': 'local-perturbation-plan/plan.json',
              'local-mapping.json': 'local-perturbation-plan/mapping.json',
              'local-preregistration.json': 'local-perturbation-plan/manifest.json'}
SECRET_KEY = re.compile(r'(?i)(?:api[_-]?key|password|passwd|access[_-]?token|refresh[_-]?token|'
                        r'oidc[_-]?token|authorization|cookie|client[_-]?secret|private[_-]?key|license[_-]?key)')
PRIVATE_VALUE = re.compile(r'(?i)(?:(?<![A-Za-z0-9])[a-z]:[\\/]|file://|vscode://|codex://|'
                           r'/(?:Users|home|mnt|private|tmp|etc|var)/|'
                           r'\bgh[pousr]_[A-Za-z0-9_]{20,}|\bsk-proj-[A-Za-z0-9_-]{20,}|'
                           r'\bAIza[A-Za-z0-9_-]{30,}|'
                           r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})')


def require(condition, label):
    if not condition:
        raise ValueError(label)


def sha(content):
    return hashlib.sha256(content).hexdigest()


def canonical(value):
    return sha(json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False,
                          separators=(',', ':')).encode('utf-8'))


def sealed(value, field, label):
    require(value.get(field) == canonical({k: v for k, v in value.items() if k != field}), label)


def strict_json(content, label):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, label + ': duplicate JSON key')
            result[key] = value
        return result
    def constant(_):
        raise ValueError(label + ': non-finite JSON number')
    return json.loads(content.decode('utf-8-sig'), object_pairs_hook=pairs, parse_constant=constant)


def private_check(value, label):
    """Reject sensitive material without putting its value in an exception/log."""
    if isinstance(value, dict):
        for key, item in value.items():
            require(not SECRET_KEY.search(key), label + ': prohibited credential field')
            private_check(key, label)
            private_check(item, label)
    elif isinstance(value, list):
        for item in value:
            private_check(item, label)
    elif isinstance(value, str):
        require(not PRIVATE_VALUE.search(value) and not value.startswith('\\\\'),
                label + ': prohibited private path or credential-like content')
        # The frozen, non-personal evidence namespace is allowed, not a public URL.
        for match in re.finditer(r'(?i)outputs[\\/]', value):
            tail = value[match.start():].replace('\\', '/')
            namespace = 'outputs/workspace-bilingual-20261117'
            require(tail == namespace or tail.startswith(namespace + '/'),
                    label + ': unreviewed outputs namespace')
    elif isinstance(value, float):
        require(math.isfinite(value), label + ': non-finite value')


def contained(directory, name):
    require(isinstance(name, str) and not Path(name).is_absolute(), 'Non-relative source name')
    path = (directory / name).resolve()
    require(path.is_relative_to(directory.resolve()), 'Source path escapes its evidence directory')
    require(path.is_file() and not (directory / name).is_symlink(), 'Missing source or symbolic link')
    return path


def summary_gate(summary):
    require(summary.get('version') == 'v2-extension', 'Not the completed v2 finalizer summary')
    require(summary.get('created_at') and summary.get('counts') == COUNTS, 'Missing final v2 split counts')
    for key, expected in {'native_runs_retained': 38, 'unique_native_cases': 37,
                          'accepted_unique_cases': 37, 'fit_attempts': 1,
                          'criteria_changed': False, 'original_splits_changed': False,
                          'old_files_unchanged': True, 'physical_validation': False}.items():
        require(type(summary.get(key)) is type(expected) and summary[key] == expected,
                'Final summary gate: ' + key)
    require(isinstance(summary.get('prediction_enabled'), bool), 'Missing prediction status')
    require(summary.get('validation_passed') is summary['prediction_enabled']
            and summary.get('exploratory') is (not summary['prediction_enabled']),
            'Contradictory final prediction/validation/exploratory status')


def unique_rows(rows, expected, label):
    require(isinstance(rows, list) and len(rows) == expected, label + ': wrong row count')
    result = {row['id']: row for row in rows}
    require(len(result) == expected, label + ': duplicate IDs')
    return result


def cohort_gate(cohorts, dataset, native, project):
    planned = unique_rows(cohorts['rows'], 37, 'Frozen cohorts')
    require(cohorts['counts'] == COUNTS and cohorts['cohort_counts'] == COHORTS, 'Frozen cohort counts')
    require(Counter(row['split'] for row in planned.values()) == COUNTS, 'Frozen split membership')
    require(Counter(row['cohort'] for row in planned.values()) == COHORTS, 'Frozen cohort membership')
    require(len({canonical(row['inputs']) for row in planned.values()}) == 37, 'Duplicate coordinates')
    repeats = cohorts['excluded_repeats']
    require(len(repeats) == 1 and repeats[0]['id'] == 'local-05'
            and repeats[0]['original_point_id'] == 'case-008', 'Missing separate center repeat')
    rows = unique_rows(dataset['rows'], 37, 'Dataset')
    require(set(rows) == set(planned), 'Dataset omitted/replaced planned cases')
    for ident, row in rows.items():
        design = planned[ident]
        require(row['inputs'] == design['inputs'] and row['split'] == design['split']
                and row['source'] == design['source'], 'Changed coordinates/split/source: ' + ident)
        require(row.get('accepted') is True and row.get('evidence_type') == 'native_simulation'
                and set(row.get('gates', {})) == GATES
                and all(value is True for value in row['gates'].values()), 'Incomplete native row: ' + ident)
    checks = unique_rows(native['cases'], 38, 'Native checks')
    require(set(checks) == set(planned) | {'local-05'} and native['unique_cases'] == 37
            and native['unique_accepted'] == 37 and native['native_runs_retained'] == 38,
            'Native unique/repeat coverage')
    for ident, check in checks.items():
        require(check['included_in_unique_dataset'] is (ident in planned)
                and check.get('accepted') is True and check.get('source_unchanged') is True
                and check.get('private_document_closed') is True
                and set(check.get('gates', {})) == GATES
                and all(value is True for value in check['gates'].values()),
                'Native source/cleanup/repeat status: ' + ident)
    require(set(unique_rows(project['cases'], 37, 'Project')) == set(planned), 'Project coverage')
    audit = project['meta']['scan_audit']
    require(all(audit.get(key) == 37 for key in ('planned', 'attempted', 'solver_accepted',
                'numerically_closed', 'lcia_complete', 'accepted')) and audit.get('failed') == 0,
            'Incomplete combined project audit')
    return planned


def validate_objects(objects, baseline):
    summary, bundle, dataset = (objects[name] for name in ('summary.json', 'model.bundle.json', 'dataset.json'))
    summary_gate(summary)
    sealed(bundle, 'bundle_sha256', 'Bundle canonical hash')
    sealed(dataset, 'dataset_sha256', 'Dataset canonical hash')
    sealed(objects['robustness.json'], 'result_sha256', 'Scenario canonical hash')
    sealed(objects['local-perturbation-comparison.json'], 'comparison_sha256', 'Local comparison canonical hash')
    require(bundle['model_sha256'] == canonical(bundle['model']), 'Model canonical hash')
    require(bundle['dataset_sha256'] == dataset['dataset_sha256'] == summary['dataset_sha256'], 'Dataset binding')
    require(bundle['model_sha256'] == summary['model_sha256'], 'Summary model binding')
    require(summary['baseline_model_sha256'] == baseline['model_sha256'], 'Original v1 identity')
    require(bundle['profile_sha256'] == dataset['profile_sha256'] == canonical(objects['profile.json']), 'Profile binding')
    require(bundle['native_model_sha256'] == dataset['model_sha256'] == objects['profile.json']['model']['sha256'], 'Native source binding')
    require(bundle['evidence_type'] == dataset['evidence_type'] == 'native_simulation', 'Non-native publication')
    require(bundle['prediction_enabled'] is summary['prediction_enabled']
            and bundle['validation'] == objects['evaluation.json'], 'Frozen evaluation/status binding')
    require(objects['evaluation.json']['passed'] is summary['prediction_enabled'], 'Evaluation pass mismatch')
    planned = cohort_gate(objects['cohorts.json'], dataset, objects['native-checks.json'], objects['project.json'])
    training = [row['id'] for row in objects['cohorts.json']['rows'] if row['split'] == 'training']
    require(bundle['model']['training_case_ids'] == training, 'Only original12 + new8 may train')
    criteria = bundle['validation_policy']
    require(criteria == baseline['validation_policy'], 'Original v1 criteria/floors changed')
    require(set(criteria) == {'purchased_energy_kWh_kg', 'yield_fraction', 'impact:Climate change'}
            and all(rule['max_relative_error'] == .05 for rule in criteria.values()), 'Original 5% criteria required')
    grouped = objects['cohort-evaluation.json']
    require(grouped['model_sha256'] == bundle['model_sha256'] and grouped['dataset_sha256'] == dataset['dataset_sha256']
            and grouped['cohort_design_sha256'] == canonical(objects['cohorts.json'])
            and grouped['criteria'] == criteria, 'Cohort evaluation binding')
    require(grouped['prediction_enabled'] is summary['prediction_enabled']
            and grouped['overall_validation_passed'] is summary['prediction_enabled'], 'Cohort status mismatch')
    require(set(grouped['cohorts']) == set(COHORTS), 'Missing separately reported cohorts')
    evaluated = unique_rows(objects['evaluation.json']['records'], 17, 'Reserved-point evaluation')
    require(set(evaluated) == {ident for ident, row in planned.items() if row['split'] != 'training'},
            'Evaluation omitted/replaced a reserved point')
    for name, count in COHORTS.items():
        group = grouped['cohorts'][name]
        require(group['expected'] == count, 'Cohort report count: ' + name)
        if group['role'] != 'training':
            require(group['prospectively_reserved_for_v2'] is (name == 'prospective_verification_4'), 'Fresh/legacy label')
            records = unique_rows(group['records'], count, 'Cohort report ' + name)
            require(set(records) == {ident for ident, row in planned.items() if row['cohort'] == name}, 'Cohort record membership')
            require(all(row == evaluated[ident] for ident, row in records.items()), 'Grouped evaluation records changed')
    require(summary['prediction_enabled'] is all(group['passed'] is True for group in grouped['cohorts'].values()
            if group['role'] != 'training'), 'A cohort failure cannot be hidden by the overall status')
    require(summary['prospective_verification_4'] == grouped['cohorts']['prospective_verification_4'], 'Fresh-four summary')
    require(summary['original_failed_point'] == grouped['original_failed_point'], 'Original failed-point retention')
    require(grouped['original_failed_point']['v1_frozen_record'] == next(row for row in baseline['validation']['records']
            if row['id'] == 'verify-T335-L8p5'), 'Original failed v1 values changed')
    for name in ('predictions.json', 'robustness.json'):
        artifact = objects[name]
        require(artifact['model_sha256'] == bundle['model_sha256'] and artifact['dataset_sha256'] == dataset['dataset_sha256']
                and artifact['exploratory'] is summary['exploratory'], 'Prediction/scenario identity: ' + name)
    robust = objects['robustness.json']
    require(robust['query_count'] == summary['scenario_queries'] == 81
            and len(robust['records']) == 81 and robust['physical_validation'] is False,
            'Frozen finite-scenario coverage/scope')
    local = objects['local-perturbation-comparison.json']
    require(local['model_sha256'] == baseline['model_sha256'] and local['model_refitted'] is False
            and local['model_qualification_changed'] is False and local['physical_validation'] is False,
            'Local comparison must remain bound to frozen v1')
    require(len(local['records']) == 9 and local['new_eight']['expected'] == 8
            and local['new_eight']['valid_pairs'] == 8 and local['new_eight']['complete'] is True
            and local['all_planned_cases_retained'] is True
            and local['center_repeat']['original_point_id'] == 'case-008', 'Local/repeat coverage')
    data_rows = {row['id']: row for row in dataset['rows']}
    local_rows = unique_rows(local['records'], 9, 'Local comparison')
    require(set(local_rows) == {ident for ident, row in planned.items() if row['cohort'] == 'local_verification_8'} | {'local-05'},
            'Local comparison coordinate membership')
    for ident, row in local_rows.items():
        target = 'case-008' if ident == 'local-05' else ident
        require(row['actual'] == data_rows[target]['outputs'] and row['inputs'] == data_rows[target]['inputs']
                and row['native_accepted'] is True, 'Local/native merged response identity: ' + ident)
    require(all(metric['original'] == metric['repeated'] and metric['absolute_difference'] == 0
                for metric in local['center_repeat']['metrics'].values()), 'Center-repeat README statement differs from evidence')


def collect(base=BASE, root=ROOT):
    """Return validated frozen bytes without creating a directory or fitting."""
    analysis = base / 'generic-native-v2-analysis'
    require(not (analysis / 'failure.json').exists(), 'Finalizer failure retained; no public package')
    require((analysis / 'summary.json').is_file(), 'Finalizer is not complete; summary absent')
    summary = strict_json((analysis / 'summary.json').read_bytes(), 'Final summary')
    summary_gate(summary)
    expected_artifacts = (set(ANALYSIS_FILES) - {'summary.json'}) | {
        'merged-ledger.json', 'assessment.json', 'protected-source-hashes.json'}
    require(set(summary.get('artifact_sha256', {})) == expected_artifacts, 'Incomplete finalizer artifact manifest')
    # Check every finalizer artifact, including excluded private audit files, by
    # bytes only. Never parse or publish protected-source-hashes or fit markers.
    for name, expected in summary['artifact_sha256'].items():
        require(Path(name).name == name and name.endswith('.json'), 'Unsafe finalizer artifact name')
        require(sha(contained(analysis, name).read_bytes()) == expected, 'Finalizer artifact bytes changed: ' + name)
    require(sha(contained(base, 'v2-extension-fit-attempt.json').read_bytes()) == summary['fit_marker_sha256'], 'Fit marker identity')
    content = {name: contained(base, source).read_bytes() for name, source in SOURCE_MAP.items()}
    objects = {name: strict_json(data, name) for name, data in content.items()}
    for name, value in objects.items():
        private_check(value, name)
    manifest = objects['scan-preregistration.json']
    design = base / 'v2-extension-plan'
    for name, expected in manifest['file_sha256'].items():
        require(sha(contained(design, name).read_bytes()) == expected, 'Frozen design file changed')
    for name, expected in manifest['canonical_sha256'].items():
        require(canonical(strict_json(contained(design, name).read_bytes(), 'Design')) == expected, 'Frozen design canonical identity')
    for name, expected in manifest['source_file_sha256'].items():
        require(sha(contained(root, name).read_bytes()) == expected, 'Bound design/algorithm file changed')
    require(objects['cohorts.json'] == strict_json(contained(design, 'cohorts.json').read_bytes(), 'Frozen cohorts'),
            'Finalizer changed frozen cohort values')
    baseline_path = root / 'analysis_web/data/generic-htl-pilot/model.bundle.json'
    baseline = strict_json(baseline_path.read_bytes(), 'Original public v1 bundle')
    sealed(baseline, 'bundle_sha256', 'Original v1 bundle hash')
    require(manifest['baseline_model_sha256'] == baseline['model_sha256']
            and manifest['baseline_bundle_sha256'] == baseline['bundle_sha256'], 'Frozen baseline identity')
    require(manifest['profile_sha256'] == canonical(objects['profile.json']), 'Frozen profile identity')
    require(content['criteria.json'] == (root / 'analysis_web/data/generic-htl-pilot/criteria.json').read_bytes(), 'Criteria bytes changed')
    require(content['profile.json'] == (root / 'analysis_web/data/generic-htl-pilot/profile.json').read_bytes(), 'Profile bytes changed')
    local_sources = {name.replace('\\', '/'): digest for name, digest in
                     objects['local-perturbation-comparison.json']['source_files'].items()}
    for public_name in ('local-plan.json', 'local-mapping.json', 'local-preregistration.json'):
        require(sha(content[public_name]) == local_sources[SOURCE_MAP[public_name]], 'Frozen local design identity')
    scenario = objects['scenario-preregistration.json']
    require(sha(content['scenario-config.json']) == scenario['config_file_sha256']
            and canonical(objects['scenario-config.json']) == scenario['config_sha256'], 'Frozen scenario design identity')
    validate_objects(objects, baseline)
    return content, objects


def manifest_for(content, objects):
    summary = objects['summary.json']
    return {'version': 1, 'title': 'HTL one adaptive extension', 'model_version': 'v2-extension',
            'native_case_count': 37, 'accepted_case_count': 37, 'training_count': 20,
            'holdout_count': 3, 'verification_count': 14, 'retained_native_run_count': 38,
            'fresh_verification_count': 4, 'cohort_counts': COHORTS,
            'prediction_enabled': summary['prediction_enabled'], 'exploratory': summary['exploratory'],
            'physical_validation': False, 'native_archives_included': False,
            'raw_private_execution_files_included': False,
            'model_sha256': summary['model_sha256'], 'baseline_model_sha256': summary['baseline_model_sha256'],
            'meaning': 'One adaptive extension with 20 training, 3 legacy holdout and 14 verification coordinates. Fresh four-point results are reported separately. Execution/accounting checks are not physical validation.',
            'files': {name: {'sha256': sha(data), 'bytes': len(data)} for name, data in sorted(content.items())}}


def readme_for(objects):
    summary, grouped = objects['summary.json'], objects['cohort-evaluation.json']['cohorts']
    passed = summary['prediction_enabled']
    local_metrics = objects['local-perturbation-comparison.json']['new_eight']['metrics']
    local_errors = [f"{100 * local_metrics[key]['max_relative_error']:.6f}%" for key in
                    ('purchased_energy_kWh_kg', 'yield_fraction', 'impact:Climate change')]
    status = ('The frozen model met its declared simulator-error checks; ordinary prediction is enabled within its declared training support.' if passed else
              'The frozen model did not meet all declared simulator-error checks. Ordinary prediction stays disabled; prediction and scenario artifacts are exploratory.')
    zh_status = ('冻结模型通过声明的仿真误差检查，可在声明的训练支持域内进行常规预测。' if passed else
                 '冻结模型未通过全部声明的仿真误差检查；常规预测仍禁用，预测与情景文件明确标为探索性。')
    columns = ['legacy_holdout_3', 'legacy_verification_2', 'local_verification_8', 'prospective_verification_4']
    table = ['| Maximum relative error | Legacy holdout (3) | Legacy verification (2) | Local verification (8) | Fresh prospective (4) |',
             '|---|---:|---:|---:|---:|']
    for key, label in [('purchased_energy_kWh_kg', 'Purchased energy / kWh per kg target'),
                       ('yield_fraction', 'Target/feed mass ratio'), ('impact:Climate change', 'Climate impact / kg CO2-eq per kg target')]:
        cells = []
        for cohort in columns:
            metric = grouped[cohort]['metrics'][key]
            cells.append(f"{100 * metric['max_relative_error']:.6f}%" if metric['complete'] and metric['max_relative_error'] is not None else 'Incomplete')
        table.append('| ' + label + ' | ' + ' | '.join(cells) + ' |')
    return f'''# HTL v2: one adaptive extension

**{status}**

The combined project contains **37 unique native coordinates: 20 training, 3 legacy holdout and 14 verification**. All 37 passed the declared execution and accounting gates. The original 17-run pilot, the nine-run local check and the 12-run extension retain **38 native execution records** because the local center repeats original holdout `case-008`. That repeat remains in the local comparison and is not an extra dataset row. Original warnings remain available.

This was one adaptive extension after reviewing v1, with eight new training locations and four fresh prospective verification locations. The original two verification locations and eight local locations are already-known development evidence for v2. They are not relabeled as fresh independent tests. One frozen fit used only the original 12 plus new 8 training cases. The original 5% maximum-relative-error policy and unit-specific denominator floors are unchanged; no validation case moved into training. All groups remain in the overall check; fresh-four results cannot mask another group's failure.

{chr(10).join(table)}

MAE, RMSE, completeness, pass flags, every native/predicted pair and the original v1 failure are retained in `cohort-evaluation.json`. The v1 package remains unchanged at [the original pilot](../generic-htl-pilot/README.md). `local-perturbation-comparison.json` is the separate comparison against **v1**, not the v2 local-group error shown above. Its eight new locations had maximum errors of {local_errors[0]}, {local_errors[1]} and {local_errors[2]} for energy, yield and climate impact. The center's native metrics matched the prior run at exported precision; no repeatability acceptance limit was preregistered.

## Use and accounting basis

Open [Local Aspen models](../../models.html) and use the reviewed v2 example/version when available, or import `project.json` and the model-result JSON files directly. The website reads derived data; it does not run Aspen or authenticate native execution from JSON labels.

The source is the same HR model at 25 MPa and 100 kg/h wet feed. Energy is declared purchased electricity per kg outlet catechol + o-cresol before separation; yield is target/feed mass ratio; climate impact uses the same target denominator and fixed foreground factors. Heater/reactor positive duties use efficiency 1 plus fixed pump inventory 2.172 kWh/h. Separator B6 heating and cooling-service burdens remain excluded. This is not whole-plant or independently validated background LCA. The older HTL lab uses a separate reference model and a per-100-kg-wet-feed energy display.

Native checks, prediction-error checks and physical validation are separate. No physical validation is claimed. The 81 finite scenario queries are rebound to v2; the v1 queries/rankings remain in their original package. Scenario/preference shares are not probabilities, continuous-region guarantees, or an operating-performance pass threshold.

## Files and source identities

- `profile.json`, `extension-plan.json`, `criteria.json`, `cohorts.json`, `scan-preregistration.json`: unchanged reviewed mapping, new 12-point plan, original criteria, full 37-point assignment and frozen design identities.
- `native-checks.json`, `project.json`, `dataset.json`: 38 source/check summaries, 37 unique process cases and audited response labels. Every retained warning and all source-batch identities remain visible.
- `model.bundle.json`, `evaluation.json`, `cohort-evaluation.json`, `summary.json`: frozen model, complete reserved-point evaluation, separate legacy/local/fresh reports and actual final status.
- `predictions.json`, `queries.json`, `robustness.json`, `scenario-config.json`, `scenario-preregistration.json`: v2-bound queries and finite scenarios using the existing design. The scenario preregistration records its original v1 origin; current v2 identity is in the result and summary.
- `local-perturbation-comparison.json`, `local-plan.json`, `local-mapping.json`, `local-preregistration.json`: separate frozen-v1 local evidence, including the center repeat.
- `index.json`: SHA256 and size of **every released JSON file except itself**. The source-derived JSON bytes were copied unchanged. The finalizer summary's `artifact_sha256` describes a different set of original local finalizer artifacts, including private audits that are not distributed here.

Relative `outputs/workspace-bilingual-20261117` and `runs/.../raw.json` strings are evidence namespaces, **not public download URLs**. Native `.bkp`/`.apw` archives, raw captures, source-hash files containing private paths, fit markers, local accounts and credentials are not included. File hashes bind artifacts; they do not independently certify native execution.

## Reproduce derived checks

Install the repository's Python/Node dependencies and run from the repository root. Choose new output names. These commands evaluate the frozen model; they do not fit again or execute Aspen.

```powershell
python -m process_pipeline.surrogate evaluate analysis_web/data/generic-htl-extension/model.bundle.json --output outputs/reproduced-v2.evaluation.json
python -m process_pipeline.robustness analysis_web/data/generic-htl-extension/model.bundle.json --config analysis_web/data/generic-htl-extension/scenario-config.json{' --allow-exploratory' if not passed else ''} --output outputs/reproduced-v2.robustness.json
```

中文说明：**{zh_status}** 共 37 个唯一工况，按 20/3/14 分组；其中全新前瞻复核 4 点单列，不能以混合平均值掩盖某组失败。38 次原生记录包含中心重复工况，重复记录不增加独立坐标数。v1 与局部复核保留，原 5% 标准不变。运行/核算通过不代表物理验证；产率为目标产物与进料质量比，能耗和气候影响按每 kg 出口目标产物计。上述相对路径是证据命名空间，不是公开下载地址，数据包不含原生档案、原始运行文件或账户资料。
'''


def publish(content, objects, destination):
    require(not destination.exists(), 'Public package already exists; no overwrite')
    require(set(content) == set(SOURCE_MAP), 'Unexpected public file set')
    index = manifest_for(content, objects)
    readme = readme_for(objects).encode('utf-8')
    private_check(index, 'Public index')
    # All validation and text generation precedes the first mutation. A failed
    # filesystem write leaves evidence for review; no deletion/automatic retry.
    destination.mkdir(exist_ok=False)
    for name, data in content.items():
        with (destination / name).open('xb') as stream:
            stream.write(data)
    with (destination / 'README.md').open('xb') as stream:
        stream.write(readme)
    for name, expected in index['files'].items():
        data = (destination / name).read_bytes()
        require(sha(data) == expected['sha256'] and len(data) == expected['bytes'], 'Public copy byte check')
    # Manifest is last: its absence marks an interrupted copy, not a release.
    with (destination / 'index.json').open('xb') as stream:
        stream.write((json.dumps(index, ensure_ascii=False, allow_nan=False, indent=2) + '\n').encode('utf-8'))
    return index


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true', help='Create the new fixed public directory after all checks')
    args = parser.parse_args()
    try:
        require(not OUT.exists(), 'Public package already exists; no overwrite')
        content, objects = collect()
        index = publish(content, objects, OUT) if args.write else manifest_for(content, objects)
        print(json.dumps({'status': 'written' if args.write else 'validated-only', 'public_json_files': len(content),
                          'native_case_count': index['native_case_count'], 'retained_native_run_count': 38,
                          'prediction_enabled': index['prediction_enabled'], 'exploratory': index['exploratory'],
                          'output': 'analysis_web/data/generic-htl-extension' if args.write else None}, indent=2))
    except (ValueError, KeyError, TypeError, OSError) as error:
        # Error labels describe the failed check; never dump source contents.
        print(json.dumps({'status': 'blocked', 'error': str(error)}), file=sys.stderr)
        raise SystemExit(2)


if __name__ == '__main__':
    main()
