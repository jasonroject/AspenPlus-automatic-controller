"""Deterministic operating/preference scenarios for a frozen GP mean bundle.

This module does not run Aspen, refit models, resample uncertainty, or recalculate
LCA backgrounds. Scenario fractions describe the supplied finite design only.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from fractions import Fraction
import json
import math
from pathlib import Path
import sys

import numpy as np

from .profile import canonical_hash, identifier
from .surrogate import SurrogateError, check_bundle, predict


DEFAULT_QUERY_LIMIT = 1000
HARD_QUERY_LIMIT = 10000
MAX_PREFERENCES = 256
TIE_TOLERANCE = 1e-12
CONSTANT_EPS_MULTIPLIER = 16


def _finite(value):
    try:
        return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)
    except (OverflowError, TypeError):
        return False


def _config(bundle, config):
    allowed = {'config_version', 'candidates', 'perturbations', 'scenarios', 'preferences', 'max_total_queries'}
    if not isinstance(config, dict) or set(config)-allowed or type(config.get('config_version')) is not int or config['config_version'] != 1:
        raise SurrogateError('Expected robustness config_version 1 with only documented fields')
    inputs, responses = bundle['model']['inputs'], bundle['model']['responses']
    input_ids, response_ids = [row['id'] for row in inputs], [row['id'] for row in responses]
    if len(set(input_ids)) != len(input_ids) or len(set(response_ids)) != len(response_ids):
        raise SurrogateError('Model input and response IDs must be unique')
    if any(row.get('direction') not in ('min', 'max') for row in responses):
        raise SurrogateError('Every model response must declare its preference direction')
    candidates = config.get('candidates')
    if not isinstance(candidates, list) or not 2 <= len(candidates) <= 50:
        raise SurrogateError('Provide 2–50 candidate input conditions')
    seen = set()
    for row in candidates:
        if not isinstance(row, dict) or set(row) != {'id', 'inputs'}:
            raise SurrogateError('Each candidate needs exactly id and inputs')
        identifier(row['id'], 'candidate.id')
        if row['id'] in seen:
            raise SurrogateError('Candidate IDs must be unique')
        seen.add(row['id'])
        if not isinstance(row['inputs'], dict) or set(row['inputs']) != set(input_ids) or any(not _finite(v) for v in row['inputs'].values()):
            raise SurrogateError('Every candidate must provide every declared input as a finite native-unit number')
    perturbations = config.get('perturbations')
    if not isinstance(perturbations, dict) or set(perturbations) != set(input_ids):
        raise SurrogateError('Declare a perturbation unit and halfwidth for every model input')
    for spec in inputs:
        row = perturbations[spec['id']]
        if not isinstance(row, dict) or set(row) != {'unit', 'halfwidth'} or row['unit'] != spec['unit']:
            raise SurrogateError(f"{spec['id']}: perturbation unit must exactly match the native input unit")
        if not _finite(row['halfwidth']) or row['halfwidth'] < 0:
            raise SurrogateError('Input halfwidths must be finite and nonnegative')
    scenarios = config.get('scenarios')
    if not isinstance(scenarios, list) or not 1 <= len(scenarios) <= 256:
        raise SurrogateError('Provide 1–256 explicit deterministic scenarios including the center')
    seen, coordinates, effective_displacements, centers = set(), set(), set(), []
    for row in scenarios:
        if not isinstance(row, dict) or set(row) != {'id', 'offsets'}:
            raise SurrogateError('Each scenario needs exactly id and offsets')
        identifier(row['id'], 'scenario.id')
        if row['id'] in seen:
            raise SurrogateError('Scenario IDs must be unique')
        seen.add(row['id'])
        offsets = row['offsets']
        if not isinstance(offsets, dict) or set(offsets) != set(input_ids) or any(not _finite(v) or not -1 <= v <= 1 for v in offsets.values()):
            raise SurrogateError('Scenario offsets must contain every input as a finite number in [-1,1]')
        coordinate = tuple(offsets[key] for key in input_ids)
        if coordinate in coordinates:
            raise SurrogateError('Repeated normalized scenario vectors would silently change their frequency weight')
        coordinates.add(coordinate)
        displacement = tuple(perturbations[key]['halfwidth']*offsets[key] for key in input_ids)
        if displacement in effective_displacements:
            raise SurrogateError('Selected scenarios must represent distinct effective perturbations (halfwidth*offset), including zero or underflowed displacements; no implicit duplicate weighting')
        effective_displacements.add(displacement)
        if all(value == 0 for value in coordinate):
            centers.append(row['id'])
    if len(centers) != 1:
        raise SurrogateError('Include exactly one center scenario with all normalized offsets zero')
    preferences = config.get('preferences')
    if not isinstance(preferences, list) or not 1 <= len(preferences) <= MAX_PREFERENCES:
        raise SurrogateError(f'Provide 1–{MAX_PREFERENCES} explicit preference weight sets')
    normalized, seen = [], set()
    for row in preferences:
        if not isinstance(row, dict) or set(row) != {'id', 'weights'}:
            raise SurrogateError('Each preference needs exactly id and weights')
        identifier(row['id'], 'preference.id')
        if row['id'] in seen:
            raise SurrogateError('Preference IDs must be unique')
        seen.add(row['id'])
        weights = row['weights']
        if not isinstance(weights, dict) or set(weights) != set(response_ids) or any(not _finite(v) or v < 0 for v in weights.values()) or max(weights.values()) <= 0:
            raise SurrogateError('Give every response a nonnegative preference weight, with a positive total')
        maximum = max(weights.values())
        scaled = {key: value/maximum for key, value in weights.items()}
        total = math.fsum(scaled.values())
        normalized.append({'id': row['id'], 'weights': {key: value/total for key, value in scaled.items()}})
    limit = config.get('max_total_queries', DEFAULT_QUERY_LIMIT)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= HARD_QUERY_LIMIT:
        raise SurrogateError(f'max_total_queries must be an integer from 1 to {HARD_QUERY_LIMIT}')
    count = len(candidates)*len(scenarios)
    if count > limit:
        raise SurrogateError(f'Planned {count} queries exceed the explicit {limit}-query budget; no subset was sampled')
    effective = deepcopy(config)
    effective['max_total_queries'] = limit
    return effective, centers[0], normalized


def _ranks(scores):
    """Descending mean ranks; each tie group is anchored to its highest score."""
    values = np.asarray(scores, float)
    if values.ndim != 1 or not len(values) or not np.isfinite(values).all():
        raise SurrogateError('Ranks require a nonempty finite score vector')
    order = np.argsort(-values, kind='stable')
    ranks = np.empty(len(values), float)
    groups, start = [], 0
    while start < len(order):
        end = start+1
        while end < len(order) and values[order[start]]-values[order[end]] <= TIE_TOLERANCE:
            end += 1
        group = order[start:end].tolist()
        ranks[group] = (start+1+end)/2
        groups.append(group)
        start = end
    return ranks, groups[0]


def _spearman(nominal_ranks, scenario_ranks):
    left, right = np.asarray(nominal_ranks, float), np.asarray(scenario_ranks, float)
    left, right = left-left.mean(), right-right.mean()
    denominator = float(np.sqrt(np.sum(left**2)*np.sum(right**2)))
    if denominator == 0:
        return {'value': None, 'reason': 'constant_rank_vector'}
    return {'value': float(np.clip(np.dot(left, right)/denominator, -1, 1)), 'reason': None}


def _constant(lower, upper):
    return bool(upper-lower <= CONSTANT_EPS_MULTIPLIER*np.finfo(float).eps*max(abs(lower), abs(upper)))


def _utility(value, lower, upper, direction):
    if _constant(lower, upper):
        return .5
    # Handle the saturated cases before subtraction, including very large signed values.
    if value <= lower:
        fraction = 0.
    elif value >= upper:
        fraction = 1.
    else:
        scale = max(abs(lower), abs(upper), 1.)
        fraction = (value/scale-lower/scale)/(upper/scale-lower/scale)
    return min(1., max(0., fraction if direction == 'max' else 1-fraction))


def _metric(records, response, nominal, complete):
    ident = response['id']
    value = nominal['outputs'].get(ident) if nominal['constraints_passed'] else None
    result = {'unit': response['unit'], 'direction': response['direction'], 'complete': complete,
              'nominal': value, 'min': None, 'max': None, 'relative_span_pct': None,
              'relative_span_reason': 'incomplete_scenario_coverage'}
    if complete:
        values = [row['outputs'][ident] for row in records]
        lower, upper = min(values), max(values)
        result.update(min=lower, max=upper)
        if value == 0:
            result['relative_span_reason'] = 'zero_nominal_denominator'
        else:
            difference = upper-lower
            span = (difference/abs(value) if math.isfinite(difference) else upper/abs(value)-lower/abs(value))*100
            result['relative_span_pct'] = span if math.isfinite(span) else None
            result['relative_span_reason'] = None if math.isfinite(span) else 'nonfinite_relative_span'
    return result


def analyze_robustness(bundle, config, allow_exploratory=False):
    """Retain all finite-design queries; never rank surviving candidates alone."""
    check_bundle(bundle)
    if not isinstance(allow_exploratory, bool):
        raise SurrogateError('allow_exploratory must be an explicit boolean')
    if not bundle['prediction_enabled'] and not allow_exploratory:
        raise SurrogateError('Ordinary prediction is disabled; explicit allow_exploratory is required')
    effective, center_id, preferences = _config(bundle, config)
    responses, inputs = bundle['model']['responses'], bundle['model']['inputs']
    units = {row['id']: row['unit'] for row in inputs}
    records, candidates, lookup = [], [], {}
    for candidate in effective['candidates']:
        group = []
        for scenario in effective['scenarios']:
            values = {key: value+effective['perturbations'][key]['halfwidth']*scenario['offsets'][key]
                      for key, value in candidate['inputs'].items()}
            overflow = [key for key, value in values.items() if not math.isfinite(value)]
            for key in overflow:
                values[key] = None
            record = {'id': f"{candidate['id']}::{scenario['id']}", 'candidate_id': candidate['id'],
                      'scenario_id': scenario['id'], 'kind': 'prediction', 'split': 'prediction',
                      'inputs': values, 'outputs': None, 'constraints_passed': False, 'errors': [],
                      'source_id': bundle['model_sha256'], 'exploratory': not bundle['prediction_enabled']}
            try:
                if overflow:
                    raise SurrogateError('Input perturbation overflow: '+', '.join(overflow))
                predicted = predict(bundle, [values], allow_exploratory=allow_exploratory, units=units)['records'][0]
                record.update({key: predicted[key] for key in ('outputs', 'constraints_passed', 'errors')})
                # Protect the result envelope even if a callable/backend returns an incomplete record.
                if not isinstance(record['outputs'], dict) or set(record['outputs']) != {row['id'] for row in responses} or any(not _finite(value) for value in record['outputs'].values()):
                    record['constraints_passed'] = False
                    record['errors'].append('Prediction did not return every declared response as a finite number')
            except (SurrogateError, ValueError, KeyError, TypeError, OverflowError) as error:
                record['constraints_passed'] = False
                record['errors'] = getattr(error, 'issues', [str(error)])
            if isinstance(record['outputs'], dict):
                record['outputs'] = {key: value if _finite(value) else None for key, value in record['outputs'].items()}
            group.append(record)
            records.append(record)
            lookup[(candidate['id'], scenario['id'])] = record
        valid = sum(row['constraints_passed'] for row in group)
        complete = valid == len(group)
        nominal = lookup[(candidate['id'], center_id)]
        candidates.append({'id': candidate['id'], 'inputs': deepcopy(candidate['inputs']),
                           'coverage': {'expected': len(group), 'valid': valid, 'unsupported': len(group)-valid, 'complete': complete},
                           'metrics': {row['id']: _metric(group, row, nominal, complete) for row in responses}})
    rank_complete = all(row['coverage']['complete'] for row in candidates)
    rankings, anchors = [], {}
    if rank_complete:
        ids = [row['id'] for row in candidates]
        for response in responses:
            nominal = [lookup[(ident, center_id)]['outputs'][response['id']] for ident in ids]
            anchors[response['id']] = {'unit': response['unit'], 'direction': response['direction'],
                                        'min': min(nominal), 'max': max(nominal), 'constant': _constant(min(nominal), max(nominal))}
        for preference in preferences:
            def scores(scenario_id):
                return [math.fsum(preference['weights'][response['id']]*_utility(
                    lookup[(ident, scenario_id)]['outputs'][response['id']], anchors[response['id']]['min'],
                    anchors[response['id']]['max'], response['direction']) for response in responses) for ident in ids]
            nominal_scores = scores(center_id)
            nominal_ranks, _ = _ranks(nominal_scores)
            credits = [Fraction(0) for _ in ids]
            rank_vectors, scenario_results = [], []
            for scenario in effective['scenarios']:
                scenario_scores = scores(scenario['id'])
                ranks, leaders = _ranks(scenario_scores)
                rank_vectors.append(ranks)
                for index in leaders:
                    credits[index] += Fraction(1, len(leaders))
                scenario_results.append({'id': scenario['id'], 'scores': dict(zip(ids, scenario_scores)),
                                          'ranks': dict(zip(ids, ranks.tolist())), 'top_ids': [ids[index] for index in leaders],
                                          'spearman_vs_nominal': _spearman(nominal_ranks, ranks)})
            rank_vectors = np.asarray(rank_vectors)
            summary = [{'id': ident, 'nominal_score': nominal_scores[index], 'nominal_rank': float(nominal_ranks[index]),
                        'rank_min': float(rank_vectors[:, index].min()), 'rank_max': float(rank_vectors[:, index].max()),
                        'top_share_pct': float(credits[index]*100/len(effective['scenarios']))} for index, ident in enumerate(ids)]
            rankings.append({'id': preference['id'], 'weights': preference['weights'], 'candidates': summary,
                             'scenarios': scenario_results, 'total_top_share_pct': math.fsum(row['top_share_pct'] for row in summary)})
    result = {'result_version': 1, 'kind': 'process_robustness', 'model_sha256': bundle['model_sha256'],
              'bundle_sha256': bundle['bundle_sha256'], 'dataset_sha256': bundle['dataset_sha256'],
              'profile_id': bundle['profile_id'], 'profile_sha256': bundle['profile_sha256'],
              'native_model_sha256': bundle['native_model_sha256'], 'evidence_type': bundle['evidence_type'],
              'config_sha256': canonical_hash(effective), 'config': effective,
              'inputs': deepcopy(inputs), 'responses': deepcopy(responses),
              'exploratory': not bundle['prediction_enabled'], 'native_execution_performed': False,
              'model_refitted': False, 'background_lca_recomputed': False, 'physical_validation': False,
              'center_scenario_id': center_id, 'query_count': len(records), 'candidates': candidates, 'records': records,
              'rank_complete': rank_complete, 'rank_incomplete_reason': None if rank_complete else 'At least one candidate has unsupported or invalid scenarios; no global ranking was issued',
              'nominal_anchors': anchors, 'preferences': rankings,
              'methods': {'scenarios': 'User-supplied finite deterministic offsets; no probability model or random sampling',
                          'relative_span': '100*(maximum-minimum)/abs(nominal); zero denominator is null; incomplete coverage is null',
                          'score': 'Weighted utility clamped to [0,1] using fixed nominal candidate min/max; numerically constant nominal response utility=0.5',
                          'constant_metric': 'Nominal span <= 16*machine epsilon*max(abs(min),abs(max)); no unit-sized absolute floor',
                          'ties': 'Absolute score tolerance 1e-12; descending groups anchored to each group highest score; average ranks',
                          'spearman': 'Pearson correlation of tie-aware average ranks; constant rank vector returns null',
                          'top_share': 'Equal credit among tied leaders in each supplied scenario; averaged per preference; selected-scenario shares, not probabilities',
                          'unsupported': 'All records retained; any unsupported candidate/scenario suppresses every complete global ranking'},
              'scope': 'Finite scenario sensitivity of frozen surrogate means. Not model uncertainty, a robustness guarantee, physical validation, or recalculated background LCA.'}
    result['result_sha256'] = canonical_hash(result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--allow-exploratory', action='store_true')
    args = parser.parse_args()
    try:
        read = lambda path: json.loads(path.read_text(encoding='utf-8-sig'))
        result = analyze_robustness(read(args.bundle), read(args.config), args.allow_exploratory)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2)+'\n', encoding='utf-8')
        print(json.dumps({'output': str(args.output), 'query_count': result['query_count'],
                          'rank_complete': result['rank_complete'], 'exploratory': result['exploratory']}))
    except (SurrogateError, ValueError, TypeError, KeyError) as error:
        print(json.dumps({'status': 'blocked', 'error': str(error), 'issues': getattr(error, 'issues', [str(error)])}), file=sys.stderr)
        raise SystemExit(2)


if __name__ == '__main__':
    main()
