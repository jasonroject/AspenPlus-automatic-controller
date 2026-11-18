"""Bounded simulator emulation and explicit fixed-background climate accounting."""
import numpy as np
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import ConstantKernel, Matern, RBF, WhiteKernel
from sklearn.model_selection import KFold

TARGETS = ['target_kg_h', 'STD_electricity_kWh', 'HR_electricity_kWh',
           'water_kg_h', 'direct_kgCO2eq_h']
BOUNDS = {'temperature_C': [310., 350.], 'length_m': [5., 20.]}

def coordinates(t, length):
    t, length = np.broadcast_arrays(np.asarray(t, float), np.asarray(length, float))
    return np.column_stack(((1 / (t.ravel() + 273.15) - 1 / 623.15) /
                           (1 / 373.15 - 1 / 623.15), np.log(length.ravel()) / np.log(20)))

def estimator(kind):
    base = RBF([.3, .5], (.02, 20)) if kind == 'RBF' else Matern([.3, .5], (.02, 20), nu=2.5)
    return GaussianProcessRegressor(kernel=ConstantKernel(1., (.001, 1000)) * base +
                                    WhiteKernel(1e-8, 'fixed'), normalize_y=True,
                                    alpha=1e-10, random_state=20261117, n_restarts_optimizer=0)

def train(frame):
    models, selection = {}, {}
    for target in TARGETS:
        data = frame[frame.accepted & (frame.split == 'train') & frame[target].notna() & (frame[target] > 0)]
        x, y = coordinates(data.temperature_C, data.length_m), np.log(data[target].to_numpy())
        candidates = []
        for kind in ['RBF', 'Matern52']:
            oof = np.empty(len(y))
            for fit, test in KFold(4, shuffle=True, random_state=20261117).split(x):
                model = estimator(kind).fit(x[fit], y[fit])
                oof[test] = model.predict(x[test])
            candidates.append((float(np.sqrt(np.mean((oof-y)**2))), kind))
        error, kind = min(candidates)
        models[target] = estimator(kind).fit(x, y)
        selection[target] = {'training_count': len(y), 'kernel': kind, 'CV_log_RMSE': error,
                             'fitted_kernel': str(models[target].kernel_)}
    return models, selection

def carbon(target, energy, direct, water, coefficients, electricity_multiplier=1.):
    values = [np.asarray(v, float) for v in (target, energy, direct, water, electricity_multiplier)]
    if any(not np.isfinite(v).all() for v in values) or np.any(values[0] <= 0) or any(np.any(v < 0) for v in values[1:]):
        raise ValueError('Non-finite or invalid physical input to carbon accounting')
    gwp = (coefficients['fixed_feed_GWP'] + coefficients['electricity_beta'] * values[4] * values[1]
           + values[2] + coefficients['wastewater_gamma'] * values[3] / 1000)
    return gwp / values[0]

def predict(models, coefficients, t, length, electricity_multiplier=1.):
    t, length = np.broadcast_arrays(np.asarray(t, float), np.asarray(length, float))
    if not np.isfinite(t).all() or not np.isfinite(length).all() or np.any((t < 310) | (t > 350) | (length < 5) | (length > 20)):
        raise ValueError('Prediction is limited to 310–350 °C and 5–20 m')
    x = coordinates(t, length)
    out = {'temperature_C': t.ravel(), 'length_m': length.ravel()}
    for target, model in models.items():
        mean, sd = model.predict(x, return_std=True)
        out[target] = np.exp(mean)
        out[target + '_log_sd'] = sd
    for scenario in ['STD', 'HR']:
        out['CF_' + scenario] = carbon(out['target_kg_h'], out[scenario + '_electricity_kWh'],
                                      out['direct_kgCO2eq_h'], out['water_kg_h'], coefficients,
                                      electricity_multiplier)
    return out

def metrics(actual, prediction):
    actual, prediction = np.asarray(actual, float), np.asarray(prediction, float)
    if (actual.ndim != 1 or prediction.shape != actual.shape or not len(actual) or
            not np.isfinite(actual).all() or not np.isfinite(prediction).all() or
            np.any(actual <= 0) or np.any(prediction <= 0)):
        raise ValueError('Validation requires complete, finite, positive actual/prediction pairs; no rows are dropped')
    error = abs(prediction / actual - 1) * 100
    return {'n': len(actual), 'RMSE': float(np.sqrt(np.mean((prediction-actual)**2))),
            'median_APE_pct': float(np.median(error)), 'p95_APE_pct': float(np.quantile(error,.95)),
            'max_APE_pct': float(np.max(error))}
