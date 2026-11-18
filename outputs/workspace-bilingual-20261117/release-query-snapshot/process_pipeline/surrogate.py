"""Bounded, mean-only GP surrogates from explicitly split audited scan datasets.

No Aspen execution, automatic splitting, hidden row removal or physical validation.
The persisted estimator is plain JSON, not an executable pickle.
"""
from __future__ import annotations

import argparse
import copy
import json
import math
from pathlib import Path
import re
import sys
import warnings

import numpy as np
from scipy.optimize import linprog
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import ConstantKernel, Matern, WhiteKernel
from threadpoolctl import threadpool_limits

from .profile import canonical_hash

GATES = ('control_succeeded', 'solver_accepted', 'numerical_closure', 'lcia_complete', 'metric_inputs_complete')
SPLITS = ('training', 'holdout', 'verification')
MAX_TRAINING = 500
MAX_INPUTS = 6
MAX_QUERY_POINTS = 500


class SurrogateError(ValueError):
    def __init__(self, message, issues=None):
        super().__init__(message)
        self.issues = issues or [message]


def _finite(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def _digest_payload(value, field):
    return canonical_hash({key: item for key, item in value.items() if key != field})


def _response_allowed(value, spec):
    if not _finite(value):
        return False
    if spec['value_domain'] == 'nonnegative' and value < 0:
        return False
    if spec['value_domain'] == 'positive' and value <= 0:
        return False
    return (spec.get('min') is None or value >= spec['min']) and (spec.get('max') is None or value <= spec['max'])


def audit_dataset(dataset, for_fit=True):
    """Validate the canonical adapter contract, preserving excluded rows with reasons."""
    if not isinstance(dataset, dict):
        raise SurrogateError('Dataset must be a JSON object')
    issues, excluded = [], []
    if dataset.get('dataset_version') != 1:
        issues.append('dataset_version must be 1')
    for field in ('profile_sha256', 'model_sha256', 'dataset_sha256'):
        if not re.fullmatch(r'[0-9a-f]{64}', str(dataset.get(field, ''))):
            issues.append(f'{field}: lowercase SHA-256 required')
    try:
        if _digest_payload(dataset, 'dataset_sha256') != dataset.get('dataset_sha256'):
            issues.append('dataset_sha256 mismatch')
    except (TypeError, ValueError):
        issues.append('Dataset must contain finite JSON values')
    if not isinstance(dataset.get('profile_id'), str) or not dataset['profile_id']:
        issues.append('profile_id required')
    if dataset.get('evidence_type') not in ('native_simulation', 'offline_fixture'):
        issues.append('evidence_type must identify native_simulation or offline_fixture')
    inputs, responses, rows = dataset.get('inputs', []), dataset.get('responses', []), dataset.get('rows', [])
    if not isinstance(inputs, list) or not 1 <= len(inputs) <= MAX_INPUTS:
        issues.append(f'Pilot supports 1–{MAX_INPUTS} continuous inputs')
    if not isinstance(responses, list) or not responses:
        issues.append('At least one declared response is required')
    if not isinstance(rows, list) or not rows:
        issues.append('Non-empty rows required')
    if issues:
        raise SurrogateError('Dataset contract failed', issues)
    input_ids, response_ids = [], []
    for spec in inputs:
        if not isinstance(spec, dict):
            issues.append('Input declarations must be objects'); continue
        identifier = spec.get('id'); input_ids.append(identifier)
        if not isinstance(identifier, str) or not identifier or not isinstance(spec.get('unit'), str):
            issues.append('Each input needs an id and unit')
        if not _finite(spec.get('min')) or not _finite(spec.get('max')) or spec['min'] >= spec['max']:
            issues.append(f'{identifier}: finite increasing min/max required')
    for spec in responses:
        if not isinstance(spec, dict):
            issues.append('Response declarations must be objects'); continue
        identifier = spec.get('id'); response_ids.append(identifier)
        if not isinstance(identifier, str) or not identifier or not isinstance(spec.get('unit'), str) or not spec['unit']:
            issues.append('Each response needs an id and unit')
        if spec.get('value_domain') not in ('positive', 'nonnegative', 'signed'):
            issues.append(f'{identifier}: declare value_domain as positive, nonnegative or signed')
        if spec.get('direction') not in ('min', 'max'):
            issues.append(f'{identifier}: declare min/max preference direction')
        for boundary in ('min', 'max'):
            if spec.get(boundary) is not None and not _finite(spec[boundary]):
                issues.append(f'{identifier}.{boundary}: finite boundary required')
        if spec.get('min') is not None and spec.get('max') is not None and spec['min'] > spec['max']:
            issues.append(f'{identifier}: response bounds are reversed')
    if not issues and (len(set(input_ids)) != len(input_ids) or len(set(response_ids)) != len(response_ids)):
        issues.append('Input and response identifiers must each be unique')
    if issues:
        raise SurrogateError('Variable declaration failed', issues)
    seen_ids, seen_coordinates, accepted = set(), {}, []
    for row_index, row in enumerate(rows):
        if not isinstance(row, dict):
            issues.append(f'Row {row_index+1}: a JSON object is required'); continue
        identifier = row.get('id')
        if not isinstance(identifier, str) or not identifier:
            issues.append(f'Row {row_index+1}: a non-empty case id is required'); continue
        if identifier in seen_ids:
            issues.append(f'{identifier}: case ids must be non-empty and unique')
        seen_ids.add(identifier)
        if row.get('split') not in SPLITS:
            issues.append(f'{identifier}: explicit frozen training/holdout/verification split required')
        row_inputs = row.get('inputs', {})
        if not isinstance(row_inputs, dict) or set(row_inputs) != set(input_ids) or any(not _finite(row_inputs.get(key)) for key in input_ids):
            issues.append(f'{identifier}: complete finite declared inputs required')
            continue
        coordinates = tuple(float(row_inputs[key]) for key in input_ids)
        if coordinates in seen_coordinates:
            prior = seen_coordinates[coordinates]
            issues.append(f'{identifier}: duplicate input coordinates with {prior}; consolidate reviewed repeats before fitting')
        seen_coordinates[coordinates] = identifier
        if any(row_inputs[spec['id']] < spec['min'] or row_inputs[spec['id']] > spec['max'] for spec in inputs):
            issues.append(f'{identifier}: input outside declared domain')
        gate_values = row.get('gates', {})
        if not isinstance(gate_values, dict):
            issues.append(f'{identifier}: audit gates must be an object'); gate_values = {}
        if any(not isinstance(gate_values.get(key), bool) for key in GATES):
            issues.append(f'{identifier}: all five audit gates must be explicit booleans')
        expected_acceptance = all(gate_values.get(key) is True for key in GATES)
        if not isinstance(row.get('accepted'), bool) or row.get('accepted') != expected_acceptance:
            issues.append(f'{identifier}: accepted status disagrees with audit gates')
        if row.get('accepted') and row.get('evidence_type') != dataset['evidence_type']:
            issues.append(f'{identifier}: evidence type differs from dataset; predicted rows cannot train this model')
        if not isinstance(row.get('source'), str) or not row['source']:
            issues.append(f'{identifier}: source record required')
        if not row.get('accepted'):
            reasons = [key for key in GATES if gate_values.get(key) is not True]
            if row.get('evidence_type') != dataset['evidence_type']:
                reasons.append('unverified_or_different_evidence_type')
            excluded.append({'id': identifier, 'split': row.get('split'), 'source': row.get('source'),
                             'reasons': reasons, 'error': row.get('error'), 'record': copy.deepcopy(row)})
            continue
        outputs = row.get('outputs', {})
        if not isinstance(outputs, dict):
            issues.append(f'{identifier}: accepted outputs must be an object'); continue
        for spec in responses:
            if not _response_allowed(outputs.get(spec['id']), spec):
                issues.append(f"{identifier}/{spec['id']}: missing, non-finite or outside declared response domain; row not silently removed")
        accepted.append(row)
    training = [row for row in accepted if row['split'] == 'training']
    minimum = max(6, 2*len(inputs)+2)
    if for_fit and not minimum <= len(training) <= MAX_TRAINING:
        issues.append(f'Training readiness requires {minimum}–{MAX_TRAINING} complete unique points; this is an engineering rule, not accuracy validation')
    if issues:
        raise SurrogateError('Dataset audit failed', issues)
    return {'accepted_rows': accepted, 'training_rows': training, 'excluded_rows': excluded,
            'counts': {split: sum(row['split'] == split for row in rows) for split in SPLITS},
            'accepted_counts': {split: sum(row['split'] == split for row in accepted) for split in SPLITS},
            'minimum_training_points': minimum,
            'lineage': 'Dataset digest checked. Native execution and lineage are declared by the producing runner/user; JSON alone does not prove Aspen execution.'}


def _criteria(config, responses):
    criteria = config.get('criteria', {})
    if not isinstance(criteria, dict):
        raise SurrogateError('criteria must be a response-id object')
    unknown = set(criteria)-{spec['id'] for spec in responses}
    if unknown:
        raise SurrogateError('Criteria name undeclared responses', sorted(unknown))
    for spec in responses:
        rule = criteria.get(spec['id'])
        if rule is None:
            continue
        if not isinstance(rule, dict) or rule.get('unit') != spec['unit']:
            raise SurrogateError(f"{spec['id']}: validation criterion unit must exactly match {spec['unit']}")
        allowed = {'unit', 'max_mae', 'max_rmse', 'max_relative_error', 'relative_floor'}
        if set(rule)-allowed:
            raise SurrogateError(f"{spec['id']}: unsupported criterion fields")
        for field in ('max_mae', 'max_rmse', 'max_relative_error'):
            if field in rule and (not _finite(rule[field]) or rule[field] < 0):
                raise SurrogateError(f'{field}: explicit finite nonnegative threshold required')
        if 'max_relative_error' in rule and (not _finite(rule.get('relative_floor')) or rule['relative_floor'] <= 0):
            raise SurrogateError('Relative error criteria require an explicit positive relative_floor in response units')
    return copy.deepcopy(criteria)


def _x(state, values):
    specs = state['inputs']
    if not isinstance(values, dict) or set(values) != {spec['id'] for spec in specs} or any(not _finite(values[spec['id']]) for spec in specs):
        raise SurrogateError('Query must contain every declared input, with finite numeric values and no unknown fields')
    raw = np.array([values[spec['id']] for spec in specs], float)
    if any(raw[i] < spec['min'] or raw[i] > spec['max'] for i, spec in enumerate(specs)):
        raise SurrogateError('Query outside declared input bounds; extrapolation rejected')
    scaled = (raw-np.asarray(state['input_scaler']['mean']))/np.asarray(state['input_scaler']['scale'])
    train = np.asarray(state['training_inputs_scaled'])
    if len(specs) == 1:
        in_hull = train[:, 0].min()-1e-10 <= scaled[0] <= train[:, 0].max()+1e-10
    else:
        # Convex-combination feasibility avoids an exploding high-dimensional facet export.
        solution = linprog(np.zeros(len(train)), A_eq=np.vstack((train.T, np.ones(len(train)))),
                           b_eq=np.r_[scaled, 1.], bounds=(0, None), method='highs')
        in_hull = (solution.success and np.max(abs(train.T@solution.x-scaled)) <= 1e-8
                   and abs(solution.x.sum()-1) <= 1e-8)
    if not in_hull:
        raise SurrogateError('Query outside actual training convex hull (or containment not numerically established); extrapolation rejected')
    return scaled


def _mean(state, values):
    scaled = _x(state, values)
    train = np.asarray(state['training_inputs_scaled'])
    output = {}
    for spec in state['responses']:
        fitted = state['regressors'][spec['id']]
        distance = np.sqrt(np.sum(((train-scaled)/np.asarray(fitted['length_scale']))**2, axis=1))
        root5 = np.sqrt(5.)*distance
        kernel = fitted['constant_value']*(1+root5+5*distance**2/3)*np.exp(-root5)
        # WhiteKernel contributes only to the fitted training covariance, never to
        # K(query, training), even when a query has identical training coordinates.
        value = float(kernel@np.asarray(fitted['dual_coefficients'])*fitted['output_scale']+fitted['output_mean'])
        output[spec['id']] = value
    return output


def _seal(bundle):
    bundle['model_sha256'] = canonical_hash(bundle['model'])
    bundle['bundle_sha256'] = _digest_payload(bundle, 'bundle_sha256')
    return bundle


def check_bundle(bundle):
    if not isinstance(bundle, dict) or bundle.get('bundle_version') != 1 or bundle.get('kind') != 'process_surrogate':
        raise SurrogateError('Unsupported surrogate bundle')
    try:
        if canonical_hash(bundle['model']) != bundle.get('model_sha256'):
            raise SurrogateError('Model hash mismatch; predictions disabled')
        if _digest_payload(bundle, 'bundle_sha256') != bundle.get('bundle_sha256'):
            raise SurrogateError('Bundle hash mismatch; predictions disabled')
        state = bundle['model']
        if (not isinstance(state, dict) or not isinstance(bundle.get('prediction_enabled'), bool)
                or state.get('family') != 'constant_times_matern52_plus_fixed_white'
                or not isinstance(state.get('inputs'), list) or not isinstance(state.get('responses'), list)
                or not 1 <= len(state['inputs']) <= MAX_INPUTS or not state['responses']
                or not all(isinstance(spec, dict) for spec in state['inputs']+state['responses'])):
            raise SurrogateError('Malformed surrogate declarations')
        if bundle['prediction_enabled']:
            if (bundle.get('evidence_type') != 'native_simulation'
                    or not isinstance(bundle.get('validation'), dict)
                    or bundle['validation'].get('passed') is not True
                    or bundle.get('status') != 'declared_simulator_error_checks_passed'):
                raise SurrogateError('Enabled prediction contradicts the declared evidence, validation or status')
        elif bundle.get('status') == 'declared_simulator_error_checks_passed':
            raise SurrogateError('Qualified status contradicts disabled prediction')
        count = len(state['inputs'])
        raw, scaled = np.asarray(state['training_inputs_raw'], float), np.asarray(state['training_inputs_scaled'], float)
        mean, scale = np.asarray(state['input_scaler']['mean'], float), np.asarray(state['input_scaler']['scale'], float)
        if (raw.ndim != 2 or raw.shape != scaled.shape or raw.shape[1] != count or not 1 <= len(raw) <= MAX_TRAINING
                or mean.shape != (count,) or scale.shape != (count,) or np.any(scale <= 0)
                or not all(np.isfinite(value).all() for value in (raw, scaled, mean, scale))
                or not np.allclose((raw-mean)/scale, scaled, rtol=1e-10, atol=1e-12)):
            raise SurrogateError('Malformed or inconsistent input scaling/training coordinates')
        for spec in state['responses']:
            row = state['regressors'][spec['id']]
            length, dual = np.asarray(row['length_scale'], float), np.asarray(row['dual_coefficients'], float)
            if (length.shape != (count,) or dual.shape != (len(raw),) or not np.isfinite(length).all()
                    or not np.isfinite(dual).all() or np.any(length <= 0)
                    or not _finite(row['constant_value']) or row['constant_value'] <= 0
                    or not _finite(row['output_scale']) or row['output_scale'] <= 0 or not _finite(row['output_mean'])):
                raise SurrogateError('Malformed posterior-mean state')
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        if isinstance(error, SurrogateError):
            raise
        raise SurrogateError('Malformed or non-finite surrogate state') from error
    return bundle


def evaluate(bundle, dataset=None, criteria=None):
    """Evaluate a frozen model without refitting; every declared validation row counts."""
    check_bundle(bundle)
    dataset = dataset or {**bundle['dataset_metadata'], 'rows': bundle['observations']}
    audit = audit_dataset(dataset, for_fit=False)
    state = bundle['model']
    for field in ('profile_id', 'profile_sha256', 'model_sha256'):
        expected = bundle['native_model_sha256'] if field == 'model_sha256' else bundle[field]
        if dataset[field] != expected:
            raise SurrogateError(f'{field}: evaluation dataset belongs to a different source profile/model')
    if dataset['inputs'] != state['inputs'] or dataset['responses'] != state['responses']:
        raise SurrogateError('Evaluation variable declarations/units differ from fitted model')
    if dataset['evidence_type'] != bundle['evidence_type']:
        raise SurrogateError('Evaluation evidence type differs from fitted model')
    rules = _criteria({'criteria': criteria if criteria is not None else bundle['validation_policy']}, state['responses'])
    training_coordinates = {tuple(values) for values in state['training_inputs_raw']}
    input_ids = [spec['id'] for spec in state['inputs']]
    records, reasons, split_reports = [], [], {}
    for split in ('holdout', 'verification'):
        declared = [row for row in dataset['rows'] if row['split'] == split]
        if not declared and split == 'verification':
            continue
        if split == 'holdout' and len(declared) < 2:
            reasons.append('holdout: at least two explicitly reserved points required for engineering readiness')
        used = []
        for row in declared:
            entry = {'id': row['id'], 'split': split, 'inputs': row['inputs'], 'actual': row.get('outputs'),
                     'source': row['source'], 'evidence_type': row['evidence_type'], 'predicted': None,
                     'constraints_passed': False, 'errors': []}
            if tuple(row['inputs'][key] for key in input_ids) in training_coordinates:
                raise SurrogateError(f"{row['id']}: validation coordinates overlap frozen training inputs")
            if not row['accepted']:
                entry['errors'] = ['native audit failed: '+', '.join(key for key in GATES if not row['gates'][key])]
            else:
                try:
                    entry['predicted'] = _mean(state, row['inputs'])
                    entry['errors'] = [spec['id']+': predicted mean outside declared response domain'
                                       for spec in state['responses'] if not _response_allowed(entry['predicted'][spec['id']], spec)]
                    entry['constraints_passed'] = not entry['errors']
                except SurrogateError as error:
                    entry['errors'] = error.issues
            if entry['constraints_passed']:
                used.append(entry)
            records.append(entry)
        complete = bool(declared) and len(used) == len(declared)
        if not complete:
            reasons.append(f'{split}: incomplete validation coverage ({len(used)}/{len(declared)}); no survivor-only pass')
        metric_results = {}
        for spec in state['responses']:
            key = spec['id']; rule = rules.get(key, {})
            result = {'unit': spec['unit'], 'expected': len(declared), 'valid_pairs': len(used), 'complete': complete,
                      'mae': None, 'rmse': None, 'max_relative_error': None, 'passed': False}
            if complete:
                actual = np.array([record['actual'][key] for record in used]); predicted = np.array([record['predicted'][key] for record in used])
                errors = predicted-actual
                result['mae'] = float(np.mean(abs(errors))); result['rmse'] = float(np.sqrt(np.mean(errors**2)))
                if 'max_relative_error' in rule:
                    result['relative_floor'] = rule['relative_floor']
                    result['max_relative_error'] = float(np.max(abs(errors)/np.maximum(abs(actual), rule['relative_floor'])))
                checks = [result[metric] <= rule[threshold] for metric, threshold in
                          [('mae', 'max_mae'), ('rmse', 'max_rmse'), ('max_relative_error', 'max_relative_error')] if threshold in rule]
                result['passed'] = bool(checks) and all(checks)
            if not any(field in rule for field in ('max_mae', 'max_rmse', 'max_relative_error')):
                reasons.append(f'{key}: no explicit acceptance criterion; exploratory only')
            elif complete and not result['passed']:
                reasons.append(f'{split}/{key}: declared prediction-error criterion not met')
            metric_results[key] = result
        split_reports[split] = {'expected': len(declared), 'valid': len(used), 'complete': complete, 'metrics': metric_results}
    passed = not reasons and all(item['complete'] and all(metric['passed'] for metric in item['metrics'].values()) for item in split_reports.values())
    return {'result_version': 1, 'kind': 'surrogate_evaluation', 'model_sha256': bundle['model_sha256'],
            'profile_id': bundle['profile_id'], 'profile_sha256': bundle['profile_sha256'],
            'native_model_sha256': bundle['native_model_sha256'], 'evidence_type': bundle['evidence_type'],
            'passed': passed, 'criteria': rules, 'criteria_sha256': canonical_hash(rules),
            'dataset_sha256': dataset['dataset_sha256'], 'splits': split_reports, 'records': records,
            'reasons': sorted(set(reasons)), 'scope': 'Error checks against supplied simulator outputs, not physical validation.'}


def fit(dataset, config=None):
    """Fit one ordinary normalized GP per response on the declared training rows only."""
    config = config or {}
    if not isinstance(config, dict) or set(config)-{'criteria', 'noise_level'}:
        raise SurrogateError('Fit config supports only criteria and optional noise_level')
    audit = audit_dataset(dataset)
    rules = _criteria(config, dataset['responses'])
    rows, input_ids = audit['training_rows'], [spec['id'] for spec in dataset['inputs']]
    raw = np.array([[row['inputs'][key] for key in input_ids] for row in rows], float)
    mean, scale = raw.mean(axis=0), raw.std(axis=0, ddof=0)
    if not np.isfinite(mean).all() or not np.isfinite(scale).all() or np.any(scale <= 0):
        raise SurrogateError('Training input scales must be finite and nonzero; constant inputs require a narrower profile')
    scaled = (raw-mean)/scale
    if np.linalg.matrix_rank(scaled) < len(input_ids):
        raise SurrogateError('Scaled training inputs must span every declared continuous dimension; dependent inputs require a narrower profile')
    noise = config.get('noise_level', 1e-8)
    if not _finite(noise) or noise <= 0:
        raise SurrogateError('noise_level must be a positive explicit normalized-output variance')
    state = {'family': 'constant_times_matern52_plus_fixed_white', 'inputs': copy.deepcopy(dataset['inputs']),
             'responses': copy.deepcopy(dataset['responses']), 'input_scaler': {'mean': mean.tolist(), 'scale': scale.tolist()},
             'training_case_ids': [row['id'] for row in rows], 'training_inputs_raw': raw.tolist(),
             'training_inputs_scaled': scaled.tolist(), 'regressors': {}, 'kernel_cross_covariance': 'WhiteKernel excluded, including identical-coordinate queries'}
    fit_warnings = []
    for spec in dataset['responses']:
        target = np.array([row['outputs'][spec['id']] for row in rows], float)
        kernel = ConstantKernel(1., (1e-3, 1e3))*Matern(np.ones(len(input_ids)), (1e-2, 1e2), nu=2.5)+WhiteKernel(noise, 'fixed')
        estimator = GaussianProcessRegressor(kernel=kernel, normalize_y=True, alpha=1e-10,
                                             random_state=20261117, n_restarts_optimizer=0)
        with warnings.catch_warnings(record=True) as caught, threadpool_limits(limits=1):
            warnings.simplefilter('always'); estimator.fit(scaled, target)
        fit_warnings.extend({'response': spec['id'], 'message': str(item.message)} for item in caught)
        fitted = estimator.kernel_
        state['regressors'][spec['id']] = {'constant_value': float(fitted.k1.k1.constant_value),
                                          'length_scale': np.atleast_1d(fitted.k1.k2.length_scale).tolist(),
                                          'white_noise_level': float(fitted.k2.noise_level), 'alpha': float(estimator.alpha),
                                          'dual_coefficients': estimator.alpha_.tolist(),
                                          'output_mean': float(estimator._y_train_mean),
                                          'output_scale': float(estimator._y_train_std),
                                          'fitted_kernel': str(fitted)}
        # Validate the serialized posterior mean against sklearn before releasing a bundle.
        restored = np.array([_mean({**state, 'responses': [spec]}, row['inputs'])[spec['id']] for row in rows])
        if not np.allclose(restored, estimator.predict(scaled), rtol=1e-9, atol=1e-10):
            raise SurrogateError('Serialized GP mean differs from sklearn at training points')
    bundle = {'bundle_version': 1, 'kind': 'process_surrogate', 'profile_id': dataset['profile_id'],
              'profile_sha256': dataset['profile_sha256'], 'native_model_sha256': dataset['model_sha256'],
              'dataset_sha256': dataset['dataset_sha256'], 'evidence_type': dataset['evidence_type'],
              'dataset_metadata': {key: copy.deepcopy(value) for key, value in dataset.items() if key != 'rows'},
              'observations': copy.deepcopy(dataset['rows']), 'model': state, 'validation_policy': rules,
              'readiness': {'minimum_training_points': audit['minimum_training_points'], 'maximum_training_points': MAX_TRAINING,
                            'maximum_continuous_inputs': MAX_INPUTS, 'counts': audit['counts'], 'accepted_counts': audit['accepted_counts'],
                            'excluded_rows': audit['excluded_rows'], 'engineering_readiness_only': True},
              'training': {'selection': 'Fixed Matern 5/2 family; hyperparameters optimized using training-only marginal likelihood. No holdout-based model selection.',
                           'noise_level': noise, 'warnings': fit_warnings, 'ordinary_output_normalization': True},
              'lineage_statement': audit['lineage'], 'prediction_enabled': False,
              'scope': 'Mean-only interpolation inside declared bounds and actual training convex hull. No uncertainty bands, live Aspen execution or physical validation.'}
    _seal(bundle)
    bundle['validation'] = evaluate(bundle)
    bundle['prediction_enabled'] = bundle['validation']['passed'] and dataset['evidence_type'] == 'native_simulation'
    bundle['status'] = 'declared_simulator_error_checks_passed' if bundle['prediction_enabled'] else 'offline_fixture_demo' if dataset['evidence_type'] == 'offline_fixture' else 'exploratory'
    return _seal(bundle)


def predict(bundle, points, allow_exploratory=False, units=None):
    """Return labeled mean predictions; exploratory output requires explicit opt-in."""
    check_bundle(bundle)
    if not bundle['prediction_enabled'] and not allow_exploratory:
        raise SurrogateError('Prediction is disabled by default: validation criteria/coverage did not qualify, or this is an offline fixture. Explicit allow_exploratory is required.')
    if not isinstance(points, list) or not 1 <= len(points) <= MAX_QUERY_POINTS:
        raise SurrogateError(f'Provide 1–{MAX_QUERY_POINTS} query points')
    expected_units = {spec['id']: spec['unit'] for spec in bundle['model']['inputs']}
    if units is not None and units != expected_units:
        raise SurrogateError('Query units differ from model input units; automatic unit conversion is not performed')
    records = []
    for index, values in enumerate(points):
        record = {'id': f'prediction-{index+1}', 'kind': 'prediction', 'inputs': values, 'outputs': None,
                  'source_id': bundle['model_sha256'], 'native_source_model_sha256': bundle['native_model_sha256'],
                  'split': 'prediction', 'constraints_passed': False, 'errors': [],
                  'exploratory': not bundle['prediction_enabled']}
        try:
            record['outputs'] = _mean(bundle['model'], values)
            record['errors'] = [spec['id']+': predicted mean outside declared response domain' for spec in bundle['model']['responses']
                                if not _response_allowed(record['outputs'][spec['id']], spec)]
            record['constraints_passed'] = not record['errors']
        except SurrogateError as error:
            record['errors'] = error.issues
        records.append(record)
    return {'result_version': 1, 'kind': 'surrogate_prediction', 'model_sha256': bundle['model_sha256'],
            'dataset_sha256': bundle['dataset_sha256'], 'profile_id': bundle['profile_id'],
            'evidence_type': bundle['evidence_type'], 'inputs': bundle['model']['inputs'], 'responses': bundle['model']['responses'],
            'records': records, 'all_queries_supported': all(row['constraints_passed'] for row in records),
            'scope': bundle['scope'], 'exploratory': not bundle['prediction_enabled']}


def _read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def _write(path, value):
    target = Path(path); target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    fitting = commands.add_parser('fit'); fitting.add_argument('dataset', type=Path); fitting.add_argument('--config', type=Path); fitting.add_argument('--output', type=Path, required=True)
    evaluation = commands.add_parser('evaluate'); evaluation.add_argument('bundle', type=Path); evaluation.add_argument('--dataset', type=Path); evaluation.add_argument('--config', type=Path); evaluation.add_argument('--output', type=Path, required=True)
    prediction = commands.add_parser('predict'); prediction.add_argument('bundle', type=Path); prediction.add_argument('--points', type=Path, required=True); prediction.add_argument('--output', type=Path, required=True); prediction.add_argument('--allow-exploratory', action='store_true')
    args = parser.parse_args()
    try:
        if args.command == 'fit':
            result = fit(_read(args.dataset), _read(args.config) if args.config else {})
        elif args.command == 'evaluate':
            result = evaluate(_read(args.bundle), _read(args.dataset) if args.dataset else None,
                              _read(args.config).get('criteria') if args.config else None)
        else:
            query = _read(args.points)
            result = predict(_read(args.bundle), query['points'], args.allow_exploratory, query.get('units'))
        _write(args.output, result)
        print(json.dumps({'output': str(args.output), 'status': result.get('status'), 'prediction_enabled': result.get('prediction_enabled'),
                          'passed': result.get('passed'), 'all_queries_supported': result.get('all_queries_supported')}, ensure_ascii=False))
    except (SurrogateError, KeyError, TypeError, ValueError) as error:
        print(json.dumps({'status': 'blocked', 'error': str(error), 'issues': getattr(error, 'issues', [str(error)])}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2)


if __name__ == '__main__':
    main()
