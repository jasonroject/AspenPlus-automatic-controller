"""Train on frozen splits, audit fresh runs, and export a bounded web artifact."""
import hashlib
import json
from pathlib import Path
import sys
import warnings
import joblib
import numpy as np
import pandas as pd
from threadpoolctl import threadpool_limits
from model import train, predict, metrics, TARGETS, BOUNDS
from diagnostics import frozen_training_audit, metric_variability, scenario_diagnostics

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT / 'outputs/htl_pipeline'
REF = HERE / 'reference'
WEB = ROOT / 'analysis_web/data/pipeline.json'

def save(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False), encoding='utf-8')

def fitting():
    data = pd.read_csv(REF / 'native_samples.csv')
    with warnings.catch_warnings(record=True) as caught, threadpool_limits(limits=1):
        warnings.simplefilter('always')
        models, specification = train(data)
    joblib.dump(models, OUT / 'models.joblib')
    save(OUT / 'training.json', {'models': specification,
        'warnings': sorted(set(str(w.message) for w in caught)),
        'reference_sha256': hashlib.sha256((REF/'native_samples.csv').read_bytes()).hexdigest(),
        'selection': 'Training-only four-fold CV; reserved holdouts and fresh points never fitted.',
        'use_gate': 'For each energy/target/CF: holdout median APE <=2%, p95 APE <=5%; report all failures.'})
    print('Models fitted', specification, flush=True)

def fresh_records(coefficients):
    import audit
    audit.O = OUT / 'live'
    from audit import extract
    from native_scan import report_warnings
    expected = json.loads((REF/'protocol.json').read_text())['source_sha256']
    atoms = {r.component: json.loads(r.chemical_atoms) for _, r in
             pd.read_csv(REF/'component_element_bases.csv').iterrows()}
    accepted, ledger = [], []
    for path in sorted((OUT/'live/raw').glob('*.json')):
        raw = json.loads(path.read_text())
        record = {'temperature_C': raw['T_K']-273.15, 'length_m': raw['L'],
                  'completed': raw.get('completed', False), 'accepted': False,
                  'source_sha256': raw['source_sha256'], 'warnings': raw.get('warnings', [])}
        try:
            if not raw.get('completed'): raise ValueError(raw.get('error','Native run failed'))
            if raw['source_sha256'] != expected: raise ValueError('Reference model hash mismatch')
            report = path.with_suffix('.rep').read_text(errors='replace')
            record['warnings'] = report_warnings(report)
            if 'completed with errors' in report or 'STATUS: NOT CONVERGED' in report:
                raise ValueError('Native report rejects completion')
            row = extract(raw, path, coefficients, atoms)
            record.update({k:row[k] for k in ['accepted','mass_residual_kg_h',
                           'chem_element_max_relative_residual','max_block_energy_residual_kW']})
            if row['accepted']: accepted.append(row)
        except Exception as error:
            record['error'] = str(error)
        ledger.append(record)
    return pd.DataFrame(accepted), ledger

def validation(models, coeff, data):
    columns = ['target_kg_h','STD_electricity_kWh','HR_electricity_kWh','CF_STD','CF_HR']
    coordinates_finite = np.isfinite(data[['temperature_C','length_m']].to_numpy(float)).all(axis=1)
    usable = data[data.temperature_C.between(310,350) & data.length_m.between(5,20)]
    coverage = {'complete': False, 'expected_in_domain': len(usable),
                'nonfinite_coordinates': int((~coordinates_finite).sum()),
                'unaccepted_in_domain': int((~usable.accepted.astype(bool)).sum()), 'metrics': {}}
    if usable.empty:
        coverage['error'] = 'No in-domain validation points'
        return {}, [], coverage
    try:
        predicted = predict(models, coeff, usable.temperature_C, usable.length_m)
    except (ValueError, KeyError, FloatingPointError) as error:
        coverage['error'] = str(error)
        return {}, [], coverage
    scores = {}
    for key in columns:
        actual = usable[key].to_numpy(float)
        predictions = np.asarray(predicted[key], float)
        valid = np.isfinite(actual) & np.isfinite(predictions) & (actual > 0) & (predictions > 0)
        coverage['metrics'][key] = {'expected': len(usable), 'valid_pairs': int(valid.sum()),
                                    'complete': bool(valid.all())}
        try:
            scores[key] = metrics(actual, predictions)
        except ValueError as error:
            coverage['metrics'][key]['error'] = str(error)
    coverage['complete'] = (not coverage['nonfinite_coordinates'] and not coverage['unaccepted_in_domain']
                            and len(scores) == len(columns) and
                            all(row['complete'] for row in coverage['metrics'].values()))
    comparison = []
    finite_or_none = lambda value: float(value) if np.isfinite(value) else None
    for i, (_, row) in enumerate(usable.iterrows()):
        comparison.append({'temperature_C':row.temperature_C,'length_m':row.length_m,
                           'actual':{k:finite_or_none(row[k]) for k in columns},
                           'prediction':{k:finite_or_none(predicted[k][i]) for k in columns}})
    return scores, comparison, coverage

def robustness(models, coeff):
    # Interior candidates permit the complete perturbation box, without clipping.
    tt,ll = np.meshgrid(np.arange(312.,349.,2.),np.arange(6.,20.,1.),indexing='ij')
    tt,ll = tt.ravel(),ll.ravel()
    n = 1024
    shared = np.random.default_rng(20261117).uniform(-1,1,(n,3))
    nominal = predict(models, coeff, tt, ll)
    output, diagnostics = {}, {}
    for scenario in ['STD','HR']:
        energy_key, cf_key = scenario+'_electricity_kWh', 'CF_'+scenario
        arrays = {k:np.empty((len(tt),n)) for k in ['target_kg_h',energy_key,cf_key]}
        for i,(t,l) in enumerate(zip(tt,ll)):
            sampled = predict(models, coeff,t+2*shared[:,0],l+.25*shared[:,1],1+.1*shared[:,2])
            for key in arrays: arrays[key][i] = sampled[key]
        # Fixed nominal ranges; scenario samples never redefine scoring limits.
        score = np.zeros((len(tt),n))
        nominal_score = np.zeros(len(tt))
        for key,direction in [('target_kg_h',1),(energy_key,-1),(cf_key,-1)]:
            lo,hi = np.min(nominal[key]),np.max(nominal[key])
            score += direction*(arrays[key]-lo)/(hi-lo)/3
            nominal_score += direction*(nominal[key]-lo)/(hi-lo)/3
        order = np.argsort(-score,axis=0)
        ranks = np.empty_like(order)
        np.put_along_axis(ranks,order,np.arange(1,len(tt)+1)[:,None],axis=0)
        nominal_rank = np.argsort(np.argsort(-nominal_score))+1
        diagnostics[scenario] = scenario_diagnostics(score, nominal_score, ranks, nominal_rank, tt, ll)
        rows=[]
        for i,(t,l) in enumerate(zip(tt,ll)):
            rows.append({'temperature_C':t,'length_m':l,'nominal_rank':int(nominal_rank[i]),
                         'top1_fraction':float(np.mean(ranks[i]==1)),
                         'top5_fraction':float(np.mean(ranks[i]<=5)),
                         'rank_p05_p50_p95':np.quantile(ranks[i],[.05,.5,.95]).tolist(),
                         'first_half_top1':float(np.mean(ranks[i,:n//2]==1)),
                         'second_half_top1':float(np.mean(ranks[i,n//2:]==1)),
                         'intervals':{k:np.quantile(a[i],[.05,.5,.95]).tolist() for k,a in arrays.items()},
                         'variability':{k:metric_variability(a[i], nominal[k][i]) for k,a in arrays.items()}})
        rows.sort(key=lambda r:(-r['top1_fraction'],r['nominal_rank']))
        output[scenario]=rows
    return {'samples':n,'candidate_count':len(tt),'seed':20261117,
            'temperature_half_width_C':2,'effective_length_half_width_m':.25,
            'electricity_factor_half_width_fraction':.1,'distribution':'independent uniform scenario assumptions',
            'common_random_numbers':True,'weights':{'yield':1/3,'energy':1/3,'carbon':1/3},
            'scope':'Conditional operating/background-factor scenario sensitivity, not physical reliability. No pass/fail threshold. GP, kinetic and thermophysical uncertainty are not jointly propagated.',
            'candidate_scope':'312–348 °C in 2 °C steps; 6–19 m in 1 m steps. Full perturbation boxes remain inside the prediction domain.',
            'variability_definition':'Population standard deviation of the finite scenario ensemble (ddof=0). CV=100*SD/abs(mean); relative P05-P95 span=100*(P95-P05)/abs(P50). Zero denominators are explicitly unavailable.',
            'method_metadata':{'numpy_version':np.__version__,
                'quantiles':{'method':'numpy.quantile linear (Hyndman-Fan type 7)',
                             'position':'p*(N-1), linearly interpolated between neighboring sorted values'},
                'standard_deviation_ddof':0,
                'zero_denominators':'null with explicit reason; no replacement epsilon',
                'spearman':'Pearson correlation of average ranks; exact score ties use midranks',
                'ordinal_rank_assignment':'Existing numpy.argsort default (quicksort in this runtime); not stable for exact ties',
                'top1_tie_policy':'One ordinal first place per draw; exact top-score ties are not given fractional credit. Their order may depend on NumPy version.',
                'sampling_interpretation':'Nested-prefix frequency drift is descriptive only; it establishes neither model accuracy nor sufficient Monte Carlo sample size.'},
            'diagnostics':diagnostics, 'scenarios':output}

def analyze():
    coeff = json.loads((REF/'lca_coefficients.json').read_text())
    models = joblib.load(OUT/'models.joblib')
    data = pd.read_csv(REF/'native_samples.csv')
    training = json.loads((OUT/'training.json').read_text())
    fresh, ledger = fresh_records(coeff)
    integrity = frozen_training_audit(models, data, training, (REF/'native_samples.csv').read_bytes(),
                                     (OUT/'models.joblib').read_bytes(), (REF/'lca_coefficients.json').read_bytes(),
                                     zip(fresh.temperature_C, fresh.length_m) if len(fresh) else ())
    hold_scores, hold_rows, hold_coverage = validation(models,coeff,data[data.split=='holdout'])
    fresh_scores, fresh_rows, fresh_coverage = validation(models,coeff,fresh) if len(fresh) else ({},[],{'complete':False,'expected_in_domain':0,'error':'No accepted fresh verification points'})
    required = {(325.,8.5),(335.,12.5),(345.,7.5)}
    checked = set(zip(fresh.temperature_C, fresh.length_m)) if len(fresh) else set()
    gate = bool(integrity['passed'] and hold_coverage['complete'] and fresh_coverage['complete']
                and required <= checked and all(r['accepted'] for r in ledger)) and all(s['median_APE_pct']<=2 and s['p95_APE_pct']<=5 for s in hold_scores.values())
    # Fresh verification is an additional release gate, not training data.
    gate = gate and all(s['max_APE_pct']<=5 for s in fresh_scores.values())
    tt,ll=np.meshgrid(np.arange(310.,350.001,.5),np.arange(5.,20.001,.25),indexing='ij')
    columns=['temperature_C','length_m']+TARGETS+['CF_STD','CF_HR']
    values=predict(models,coeff,tt,ll) if integrity['passed'] else {}
    grid=pd.DataFrame({k:values[k] for k in columns}) if values else pd.DataFrame(columns=columns)
    grid.to_csv(OUT/'prediction_grid.csv',index=False)
    result={'version':'htl-pilot-20261117','status':'validated_simulator_pilot' if gate else 'validation_failed',
        'prediction_enabled':bool(gate),'bounds':BOUNDS,'basis':{'wet_feed_kg':100,'duration_h':1,'pressure_MPa':25},
        'scope':'Original HTL model compounds; CAT plus o-cresol at reactor outlet. Simulator validation only.',
        'accounting':coeff,'native_reference_count':len(data),'training':training,
        'validation_integrity':integrity,'validation_coverage':{'holdout':hold_coverage,'fresh':fresh_coverage},
        'holdout_metrics':hold_scores,'fresh_metrics':fresh_scores,'fresh_runs':ledger,
        'historical_failed_attempts':pd.read_csv(REF/'failed_samples.csv').fillna('').to_dict('records'),
        'grid':{'temperature_step_C':.5,'length_step_m':.25,'rows':grid.to_dict('records')},
        'robustness':robustness(models,coeff) if gate else None,
        'limitations':['Fixed-background climate calculation, not a new openLCA run or complete multi-impact LCIA.',
                      'Native cal/s converted using 4.1868 J/cal; archived website results remain unchanged.',
                      'Actual Celsius is used; archived manuscript labels used Kelvin minus 273.',
                      'One archived 330 °C / 10 m inventory offset is retained as an exception, not fitted away.',
                      'Dense grid cells are surrogate predictions, not additional Aspen simulations.']}
    save(OUT/'holdout_comparison.json',hold_rows)
    save(OUT/'fresh_comparison.json',fresh_rows)
    save(OUT/'pipeline.json',result)
    WEB.write_text(json.dumps(result,separators=(',',':'),allow_nan=False),encoding='utf-8')
    print(json.dumps({'status':result['status'],'holdout':hold_scores,'fresh':fresh_scores,'native':ledger},indent=2),flush=True)

if __name__=='__main__':
    OUT.mkdir(exist_ok=True,parents=True)
    with threadpool_limits(limits=1):
        if sys.argv[1]=='train': fitting()
        elif sys.argv[1]=='analyze': analyze()
        else: raise SystemExit('Use train or analyze')
