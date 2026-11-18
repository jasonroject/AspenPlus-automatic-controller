"""Integrity gates and descriptive diagnostics for the frozen HTL simulator pilot.

These checks establish data/model consistency and finite-scenario sensitivity.
They do not establish experimental accuracy or physical reliability.
"""
import hashlib
import numpy as np
from model import TARGETS, coordinates


def frozen_training_audit(models, frame, training, reference_bytes, model_bytes,
                          coefficient_bytes, fresh_coordinates=()):
    """Bind a loaded estimator to the exact accepted, train-only reference rows."""
    errors, checked = [], {}
    reference_hash = hashlib.sha256(reference_bytes).hexdigest()
    if reference_hash != training.get('reference_sha256'):
        errors.append('reference_hash_mismatch')
    if set(models) != set(TARGETS):
        errors.append('model_target_set_mismatch')
    if not np.isfinite(frame[['temperature_C', 'length_m']].to_numpy(float)).all():
        errors.append('reference_coordinates_nonfinite')
    coords = lambda subset: set(zip(subset.temperature_C.round(10), subset.length_m.round(10)))
    training_coords = coords(frame[frame.accepted & (frame.split == 'train')])
    reserved_coords = coords(frame[frame.accepted & (frame.split != 'train')])
    if training_coords & reserved_coords:
        errors.append('training_reserved_coordinate_overlap')
    if training_coords & {(round(float(t), 10), round(float(l), 10)) for t, l in fresh_coordinates}:
        errors.append('training_fresh_coordinate_overlap')
    for target in TARGETS:
        expected = frame[frame.accepted & (frame.split == 'train') &
                         frame[target].notna() & (frame[target] > 0)]
        result = {'expected_training_count': len(expected), 'coordinates_match': False,
                  'responses_match': False, 'metadata_count_matches': False, 'kernel_metadata_matches': False}
        try:
            estimator = models[target]
            actual_x = np.asarray(estimator.X_train_)
            expected_x = coordinates(expected.temperature_C, expected.length_m)
            result['coordinates_match'] = bool(actual_x.shape == expected_x.shape and
                                              np.allclose(actual_x, expected_x, rtol=1e-12, atol=1e-14))
            # sklearn stores normalized log-response labels when normalize_y=True.
            expected_y = ((np.log(expected[target].to_numpy()) - estimator._y_train_mean) /
                          estimator._y_train_std)
            actual_y = np.asarray(estimator.y_train_)
            result['responses_match'] = bool(actual_y.shape == expected_y.shape and
                                            np.isfinite(expected_y).all() and
                                            np.allclose(actual_y, expected_y, rtol=1e-12, atol=1e-14))
            result['metadata_count_matches'] = training.get('models', {}).get(target, {}).get('training_count') == len(expected)
            result['kernel_metadata_matches'] = str(estimator.kernel_) == training.get('models', {}).get(target, {}).get('fitted_kernel')
            result['actual_training_count'] = len(actual_x)
        except (KeyError, AttributeError, ValueError, TypeError) as error:
            result['error'] = type(error).__name__
        if not all(result[k] for k in ['coordinates_match', 'responses_match', 'metadata_count_matches', 'kernel_metadata_matches']):
            errors.append('frozen_training_mismatch:' + target)
        checked[target] = result
    return {'passed': not errors, 'errors': errors, 'models': checked,
            'reference_sha256': reference_hash,
            'training_reference_sha256': training.get('reference_sha256'),
            'estimator_sha256': hashlib.sha256(model_bytes).hexdigest(),
            'coefficients_sha256': hashlib.sha256(coefficient_bytes).hexdigest(),
            'scope': 'Exact source hash, train-only coordinates and normalized training labels. Not physical validation.'}


def average_ranks(values):
    """Ascending ranks, with average ranks for exact ties (one-based)."""
    values = np.asarray(values, float)
    if values.ndim != 1 or not np.isfinite(values).all():
        raise ValueError('Ranks require a finite one-dimensional vector')
    order = np.argsort(values, kind='mergesort')
    ordered = values[order]
    starts = np.r_[0, np.flatnonzero(np.diff(ordered) != 0) + 1]
    ends = np.r_[starts[1:], len(values)]
    result = np.empty(len(values), float)
    for start, end in zip(starts, ends):
        result[order[start:end]] = (start + end - 1) / 2 + 1
    return result


def rank_correlations(nominal_scores, scenario_scores):
    """Spearman agreement per draw, including average-rank handling of ties."""
    nominal = average_ranks(nominal_scores)
    scenarios = np.asarray(scenario_scores, float)
    if scenarios.ndim != 2 or scenarios.shape[0] != len(nominal):
        raise ValueError('Scenario scores must have candidate rows and draw columns')
    nominal -= nominal.mean()
    denominator_nominal = np.sum(nominal ** 2)
    result = []
    for column in scenarios.T:
        ranked = average_ranks(column)
        ranked -= ranked.mean()
        denominator = np.sqrt(denominator_nominal * np.sum(ranked ** 2))
        result.append(float(np.clip(np.dot(nominal, ranked) / denominator, -1, 1)) if denominator else np.nan)
    return np.asarray(result)


def metric_variability(values, nominal):
    """Descriptive moments and support widths of the supplied finite scenario set."""
    values = np.asarray(values, float)
    if values.ndim != 1 or not len(values) or not np.isfinite(values).all():
        raise ValueError('Variability needs non-empty finite scenario values')
    mean, median = float(np.mean(values)), float(np.median(values))
    standard_deviation = float(np.std(values, ddof=0))
    lo, hi = np.quantile(values, [.05, .95])
    return {'mean': mean, 'standard_deviation': standard_deviation,
            'CV_pct': standard_deviation / abs(mean) * 100 if mean else None,
            'relative_P05_P95_span_pct': float((hi-lo)/abs(median)*100) if median else None,
            'mean_shift_from_nominal_pct': float((mean-nominal)/abs(nominal)*100) if nominal else None,
            'CV_undefined_reason': None if mean else 'zero_mean',
            'relative_span_undefined_reason': None if median else 'zero_median'}


def scenario_diagnostics(scores, nominal_scores, ranks, nominal_ranks, temperatures, lengths):
    """Sampling diagnostics use exactly the existing shared scenario draws."""
    scores, ranks = np.asarray(scores), np.asarray(ranks)
    if scores.shape != ranks.shape or scores.ndim != 2:
        raise ValueError('Score and rank arrays must have the same candidate-by-draw shape')
    correlation = rank_correlations(nominal_scores, scores)
    sorted_scores = np.sort(scores, axis=0)
    tied_draws = np.any(np.diff(sorted_scores, axis=0) == 0, axis=0)
    top_multiplicity = np.sum(scores == np.max(scores, axis=0, keepdims=True), axis=0)
    nominal_scores = np.asarray(nominal_scores)
    defined = correlation[np.isfinite(correlation)]
    shifts = np.mean(np.abs(ranks-np.asarray(nominal_ranks)[:, None]), axis=0)
    nominal_leader = int(np.argmin(nominal_ranks))
    prefixes, previous = [], None
    sizes = [n for n in [128, 256, 512, 1024] if n <= ranks.shape[1]]
    if not sizes or sizes[-1] != ranks.shape[1]:
        sizes.append(ranks.shape[1])
    for size in sizes:
        frequencies = np.mean(ranks[:, :size] == 1, axis=1)
        leader = int(np.argmax(frequencies))
        prefixes.append({'samples': size,
                         'leader_temperature_C': float(temperatures[leader]),
                         'leader_length_m': float(lengths[leader]),
                         'leader_top1_fraction': float(frequencies[leader]),
                         'nominal_leader_top1_fraction': float(frequencies[nominal_leader]),
                         'max_top1_change_from_previous_pp': float(np.max(abs(frequencies-previous))*100) if previous is not None else None,
                         'top1_frequency_sum': float(frequencies.sum())})
        previous = frequencies
    return {'exact_tie_audit': {'nominal_adjacent_duplicate_scores': int(np.sum(np.diff(np.sort(nominal_scores)) == 0)),
                              'nominal_top_score_multiplicity': int(np.sum(nominal_scores == np.max(nominal_scores))),
                              'draws_with_any_exact_score_tie': int(tied_draws.sum()),
                              'draws_with_exact_top_score_tie': int(np.sum(top_multiplicity > 1)),
                              'maximum_top_score_multiplicity': int(top_multiplicity.max())},
            'rank_agreement': {'statistic': 'Pearson correlation of average ranks (Spearman); exact ties use midranks',
                              'mean': float(defined.mean()) if len(defined) else None,
                              'p05_p50_p95': np.quantile(defined, [.05, .5, .95]).tolist() if len(defined) else None,
                              'defined_samples': len(defined),
                              'undefined_samples': int(len(correlation)-len(defined)),
                              'undefined_reason': 'constant_rank_vector' if len(defined)<len(correlation) else None},
            'mean_absolute_rank_shift_p05_p50_p95': np.quantile(shifts, [.05, .5, .95]).tolist(),
            'sampling_prefixes': prefixes,
            'interpretation': 'Finite-sample diagnostics under the specified scenario distribution. Prefix stability is not a convergence guarantee, prediction confidence or physical reliability.'}
