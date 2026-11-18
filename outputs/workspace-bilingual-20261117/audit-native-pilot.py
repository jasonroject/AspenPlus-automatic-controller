"""Read-only arithmetic/lineage audit of the frozen 17-point pilot's outputs.

No Aspen API, model fitting, file mutation, or production analysis imports.
Prints a JSON report; redirect stdout if a persistent review record is needed.
This checks recorded arithmetic and local evidence, not thermophysical accuracy.
"""
import argparse
import hashlib
import json
import math
from collections import Counter
from pathlib import Path
import sys


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def canonical(value):
    data = json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
    return hashlib.sha256(data.encode('utf-8')).hexdigest()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition, label):
    if not condition:
        raise ValueError(label)


def near(actual, expected, label, atol=1e-10, rtol=1e-9):
    require(isinstance(actual, (int, float)) and not isinstance(actual, bool)
            and math.isfinite(actual) and math.isfinite(expected)
            and math.isclose(actual, expected, abs_tol=atol, rel_tol=rtol),
            f'{label}: {actual!r} != {expected!r}')


def sealed(value, field):
    require(canonical({k: v for k, v in value.items() if k != field}) == value[field], field)


def posterior_mean(model, inputs):
    """Scalar Matérn-5/2 cross covariance; independently sum frozen coefficients."""
    normalized = [(inputs[s['id']]-model['input_scaler']['mean'][i])/model['input_scaler']['scale'][i]
                  for i, s in enumerate(model['inputs'])]
    answer = {}
    for response in model['responses']:
        reg = model['regressors'][response['id']]
        terms = []
        for train, coefficient in zip(model['training_inputs_scaled'], reg['dual_coefficients']):
            radius = math.sqrt(math.fsum(((a-b)/length)**2 for a, b, length in zip(train, normalized, reg['length_scale'])))
            q = math.sqrt(5)*radius
            terms.append(coefficient*reg['constant_value']*(1+q+5*radius**2/3)*math.exp(-q))
        answer[response['id']] = math.fsum(terms)*reg['output_scale']+reg['output_mean']
    return answer


def prediction_values(model, inputs, outputs, label):
    expected = posterior_mean(model, inputs)
    require(set(outputs) == set(expected), label+' response coverage')
    for key, value in expected.items():
        near(outputs[key], value, label+'/'+key, atol=2e-8, rtol=2e-8)


def quantity(spec, raw):
    if 'readout' in spec:
        return raw['readouts'][spec['readout']]['value']
    if 'constant' in spec:
        return spec['constant']
    if 'sum' in spec:
        return math.fsum(quantity(item, raw) for item in spec['sum'])
    if 'positive' in spec:
        return max(0, quantity(spec['positive'], raw))
    return quantity(spec['quantity'], raw)*spec['scale']


def quantity_unit(spec, raw):
    if 'readout' in spec:
        return raw['readouts'][spec['readout']]['unit']
    if 'constant' in spec:
        return spec['unit']
    if 'sum' in spec:
        units = {quantity_unit(item, raw) for item in spec['sum']}
        require(len(units) == 1, 'Sum native units')
        return next(iter(units))
    return quantity_unit(spec.get('positive', spec.get('quantity')), raw)


def audit_controls(profile, raw, parameters):
    controls = [(spec, parameters[spec['id']]) for spec in profile['variables']]
    controls += [(spec, parameters[spec['source_id']]) for spec in profile.get('linked_inputs', [])]
    controls += [(spec, spec['value']) for spec in profile.get('fixed_inputs', [])]
    for field in ('input_readback', 'input_readback_after_run'):
        require(set(raw[field]) == {spec['id'] for spec, _ in controls}, field+' complete controls')
        for spec, value in controls:
            record = raw[field][spec['id']]
            require(record['path'] == spec['path'] and record['unit'] == spec['native_unit'] and not record.get('error'), field+'/'+spec['id']+' declaration')
            near(record['value'], value, field+'/'+spec['id'], atol=1e-9, rtol=1e-9)
    for spec in profile['readouts']:
        captured = raw['readouts'][spec['id']]
        require(captured['path'] == spec['path'] and captured['unit'] == spec['native_unit'] and not captured.get('error') and math.isfinite(captured['value']), 'Captured readout declaration '+spec['id'])


def audit_case(profile, raw, project, assessment, row):
    """Independent unit conversion and signed energy sums for this HTL profile."""
    ident = row['id']; case = project['cases'][0]; mapping = profile['mapping']
    require(case['id'] == ident, ident+' project ID')
    require(project['factors'] == mapping['factors'], ident+' frozen LCIA factors')
    require(all(project['meta'][key] == value for key, value in mapping['meta'].items()), ident+' frozen accounting basis')
    require(case['allocation'] == mapping['product']['allocation'], ident+' allocation')
    for key, declaration in [('product_rate', mapping['product']['quantity']), ('feed_rate', mapping['product']['feed'])]:
        near(case[key], quantity(declaration, raw), ident+'/'+key+' raw mapping')
    require(case['mass_unit'] in ('kg/hr', 'kg/h'), 'Audit only supports this pilot mass unit')
    calorie = project['meta']['calorie_J']
    def power(value, unit):
        require(unit in ('cal/sec', 'kW'), 'Unexpected pilot power unit '+unit)
        return value*calorie/1000 if unit == 'cal/sec' else value
    streams, blocks = {}, {}
    for source, spec in zip(project['streams'], mapping['streams']):
        require(source['id'] == spec['id'], ident+' stream order')
        require(source['from'] == spec['from'] and source['to'] == spec['to'], ident+' fixed stream topology')
        near(source['mass_flow'], quantity(spec['mass'], raw), ident+'/'+source['id']+' raw mass')
        near(source['specific_enthalpy'], quantity(spec['specific_enthalpy'], raw), ident+'/'+source['id']+' raw enthalpy')
        require(source['mass_unit'] in ('kg/hr', 'kg/h') and source['enthalpy_unit'] == 'cal/gm', 'Unexpected pilot stream unit')
        streams[source['id']] = {**source, 'm': source['mass_flow'], 'h': source['mass_flow']*source['specific_enthalpy']*calorie/3600}
    for source, spec in zip(project['blocks'], mapping['blocks']):
        require(source['id'] == spec['id'], ident+' block order')
        near(source['heat'], quantity(spec['heat'], raw), ident+'/'+source['id']+' raw heat')
        near(source['power'], quantity(spec['power'], raw), ident+'/'+source['id']+' raw work')
        require(source['heat_unit'] == quantity_unit(spec['heat'], raw) and source['power_unit'] == quantity_unit(spec['power'], raw), ident+' block native units')
        blocks[source['id']] = {'heat': power(source['heat'], source['heat_unit']), 'power': power(source['power'], source['power_unit'])}
    result = assessment['report']['results'][0]
    balance = result['balance']; expected_closed = True
    require(len(streams) == len(mapping['streams']) == len(balance['streams']), ident+' stream completeness')
    require(len(blocks) == len(mapping['blocks']) == len(balance['blocks']), ident+' block completeness')
    for reported in balance['streams']:
        source = streams[reported['id']]
        near(reported['mass'], source['m'], ident+' converted mass')
        near(reported['enthalpy'], source['h'], ident+' converted enthalpy')
    maximum_mass, maximum_energy = 0, 0
    for reported in balance['blocks']:
        key = reported['id']; block = blocks[key]
        incoming = [s for s in streams.values() if s['to'] == key]
        outgoing = [s for s in streams.values() if s['from'] == key]
        mi, mo = math.fsum(s['m'] for s in incoming), math.fsum(s['m'] for s in outgoing)
        hi, ho = math.fsum(s['h'] for s in incoming), math.fsum(s['h'] for s in outgoing)
        mr, er = mo-mi, ho-hi-block['heat']-block['power']
        near(reported['mass_residual_kg_h'], mr, ident+'/'+key+' mass residual')
        near(reported['energy_residual_kW'], er, ident+'/'+key+' energy residual')
        closed = abs(mr) <= max(.01, .001*max(mi, mo, 1e-12)) and abs(er) <= max(.01, .001*max(abs(hi), abs(ho), abs(block['heat'])+abs(block['power']), 1e-12))
        require(reported['within_tolerance'] == closed, ident+'/'+key+' numerical gate')
        expected_closed = expected_closed and closed
        maximum_mass, maximum_energy = max(maximum_mass, abs(mr)), max(maximum_energy, abs(er))
    inbound = [s for s in streams.values() if s['from'] == 'BOUNDARY']
    outbound = [s for s in streams.values() if s['to'] == 'BOUNDARY']
    near(balance['total']['mass_residual_kg_h'], math.fsum(s['m'] for s in outbound)-math.fsum(s['m'] for s in inbound), ident+' boundary mass')
    near(balance['total']['energy_residual_kW'], math.fsum(s['h'] for s in outbound)-math.fsum(s['h'] for s in inbound)-math.fsum(b['heat']+b['power'] for b in blocks.values()), ident+' boundary energy')
    require(balance['within_tolerance'] == expected_closed == row['gates']['numerical_closure'], ident+' numerical closure')
    product, allocation = case['product_rate'], case['allocation']
    factors = {factor['id']: factor for factor in project['factors']}
    energy, impacts = 0, {}
    require(len(project['inventory']) == len(mapping['inventory']), ident+' inventory completeness')
    for inventory, spec in zip(project['inventory'], mapping['inventory']):
        require(inventory['id'] == spec['id'], ident+' inventory identity')
        near(inventory['amount'], quantity(spec['quantity'], raw), ident+'/'+inventory['id']+' raw inventory')
        require(inventory['unit'] == quantity_unit(spec['quantity'], raw) and inventory['factor_id'] == spec['factor_id'] and inventory['kind'] == spec['kind'], ident+' inventory mapping units/factor')
        factor = factors[inventory['factor_id']]
        if inventory['kind'] == 'energy':
            amount = power(inventory['amount'], inventory['unit'])
            require(factor['denominator_unit'] == 'kWh', ident+' energy factor unit')
            energy += amount
        else:
            require(inventory['unit'] in ('kg/hr', 'kg/h') and factor['denominator_unit'] == 'kg', ident+' mass factor unit')
            amount = inventory['amount']
        impacts.setdefault(factor['category'], []).append(amount*factor['value']*allocation/product)
    near(row['metrics']['purchased_energy_kWh_kg'], energy*allocation/product, ident+' purchased inventory energy')
    near(row['metrics']['yield_fraction'], product/case['feed_rate'], ident+' target/feed ratio')
    for category, contributions in impacts.items():
        value = math.fsum(contributions)
        near(row['metrics']['impacts'][category]['value'], value, ident+'/'+category+' impact subtotal')
        near(next(item for item in result['impacts'] if item['category'] == category)['nominal_subtotal'], value, ident+'/'+category+' report subtotal')
    return {'id': ident, 'maximum_block_mass_residual_kg_h': maximum_mass, 'maximum_block_energy_residual_kW': maximum_energy}


def audit_evaluation(bundle, evaluation, criteria, dataset):
    require(evaluation == bundle['validation'], 'Bundle/evaluation mismatch')
    require(evaluation['criteria'] == criteria['criteria'] == bundle['validation_policy'], 'Frozen criteria mismatch')
    require(evaluation['criteria_sha256'] == canonical(criteria['criteria']), 'Criteria hash')
    model = bundle['model']; rows = {row['id']: row for row in dataset['rows']}
    require({record['id'] for record in evaluation['records']} == {row['id'] for row in rows.values() if row['split'] != 'training'}, 'Validation row retention')
    checks = {}
    for split in ('holdout', 'verification'):
        records = [record for record in evaluation['records'] if record['split'] == split]
        valid = [record for record in records if record['constraints_passed']]
        for record in records:
            row = rows[record['id']]
            require(record['inputs'] == row['inputs'] and record['actual'] == row['outputs'] and record['split'] == row['split'], 'Evaluation identity')
            if record['constraints_passed']:
                require(row['accepted'], 'Failed native row used for validation')
                prediction_values(model, record['inputs'], record['predicted'], record['id'])
        report = evaluation['splits'][split]
        require(report['expected'] == len(records) and report['valid'] == len(valid) and report['complete'] == (len(records) == len(valid) > 0), split+' coverage')
        checks[split] = {}
        for key, metric in report['metrics'].items():
            require(metric['expected'] == len(records) and metric['valid_pairs'] == len(valid) and metric['complete'] == report['complete'], split+'/'+key+' metric coverage')
            if not report['complete']:
                require(metric['passed'] is False and all(metric[k] is None for k in ('mae', 'rmse', 'max_relative_error')), split+' no survivor-only pass')
                continue
            error = [record['predicted'][key]-record['actual'][key] for record in valid]
            rule = criteria['criteria'][key]
            expected = {'mae': math.fsum(abs(e) for e in error)/len(error), 'rmse': math.sqrt(math.fsum(e*e for e in error)/len(error)),
                        'max_relative_error': max(abs(e)/max(abs(record['actual'][key]), rule['relative_floor']) for record, e in zip(valid, error))}
            for name, value in expected.items():
                near(metric[name], value, split+'/'+key+'/'+name)
            passed = expected['max_relative_error'] <= rule['max_relative_error']
            require(metric['passed'] == passed, split+'/'+key+' criterion')
            checks[split][key] = expected
    expected_pass = all(report['complete'] and all(metric['passed'] for metric in report['metrics'].values()) for report in evaluation['splits'].values())
    require(evaluation['passed'] == expected_pass == bundle['prediction_enabled'], 'Validation/qualification gate')
    return checks


def audit_robustness(bundle, result, design):
    sealed(result, 'result_sha256')
    require(result['config_sha256'] == canonical(result['config']), 'Robustness config hash')
    for key in design:
        require(result['config'][key] == design[key], 'Changed prospective robustness '+key)
    require(result['model_sha256'] == bundle['model_sha256'] and result['bundle_sha256'] == bundle['bundle_sha256'], 'Robustness source binding')
    config = result['config']; lookup = {(row['candidate_id'], row['scenario_id']): row for row in result['records']}
    require(len(lookup) == len(result['records']) == result['query_count'] == len(config['candidates'])*len(config['scenarios']), 'All robustness queries retained')
    for candidate in config['candidates']:
        for scenario in config['scenarios']:
            row = lookup[candidate['id'], scenario['id']]
            expected = {key: value+config['perturbations'][key]['halfwidth']*scenario['offsets'][key] for key, value in candidate['inputs'].items()}
            require(row['inputs'] == expected, row['id']+' prospective coordinates')
            if row['constraints_passed']:
                prediction_values(bundle['model'], expected, row['outputs'], row['id'])
    require(result['rank_complete'] == all(row['constraints_passed'] for row in result['records']), 'No survivor-only global ranking')
    for candidate in result['candidates']:
        records = [row for row in result['records'] if row['candidate_id'] == candidate['id']]
        valid = [row for row in records if row['constraints_passed']]
        require(candidate['coverage']['valid'] == len(valid) and candidate['coverage']['expected'] == len(records), 'Candidate coverage')
        if len(valid) == len(records):
            nominal = lookup[candidate['id'], result['center_scenario_id']]['outputs']
            for key, metric in candidate['metrics'].items():
                values = [row['outputs'][key] for row in valid]
                for name, value in [('min', min(values)), ('max', max(values)), ('nominal', nominal[key])]:
                    near(metric[name], value, candidate['id']+'/'+key+'/'+name)
                if nominal[key] == 0:
                    require(metric['relative_span_pct'] is None, 'Zero relative-span denominator')
                else:
                    near(metric['relative_span_pct'], 100*(max(values)-min(values))/abs(nominal[key]), 'Relative span')
    if not result['rank_complete']:
        require(not result['preferences'] and not result['nominal_anchors'], 'Incomplete ranking withheld')
    else:
        ids = [row['id'] for row in result['candidates']]
        center = result['center_scenario_id']
        for response in result['responses']:
            key = response['id']; anchor = result['nominal_anchors'][key]
            values = [lookup[ident, center]['outputs'][key] for ident in ids]
            near(anchor['min'], min(values), key+' nominal minimum anchor')
            near(anchor['max'], max(values), key+' nominal maximum anchor')
            require(anchor['direction'] == response['direction'], key+' metric direction')
        design_preferences = {row['id']: row for row in design['preferences']}
        require({row['id'] for row in result['preferences']} == set(design_preferences), 'Every declared preference retained')
        for preference in result['preferences']:
            declared = design_preferences[preference['id']]['weights']; total = math.fsum(declared.values())
            for key, weight in declared.items():
                near(preference['weights'][key], weight/total, key+' fixed preference weight')
            credits = Counter(); rankings = {ident: [] for ident in ids}
            nominal_scenario = next(row for row in preference['scenarios'] if row['id'] == center)
            for scenario in preference['scenarios']:
                scores = {}
                for ident in ids:
                    terms = []
                    for key, weight in preference['weights'].items():
                        anchor = result['nominal_anchors'][key]
                        value = lookup[ident, scenario['id']]['outputs'][key]
                        low, high = anchor['min'], anchor['max']
                        constant = high-low <= 16*sys.float_info.epsilon*max(abs(low), abs(high))
                        require(anchor['constant'] == constant, 'Scale-relative constant anchor')
                        utility = .5 if constant else max(0, min(1, (value-low)/(high-low)))
                        if not constant and anchor['direction'] == 'min':
                            utility = 1-utility
                        terms.append(weight*utility)
                    scores[ident] = math.fsum(terms)
                    near(scenario['scores'][ident], scores[ident], ident+' weighted score')
                order = sorted(ids, key=lambda ident: -scores[ident]); start = 0
                leaders = []
                while start < len(order):
                    end = start+1
                    while end < len(order) and scores[order[start]]-scores[order[end]] <= 1e-12:
                        end += 1
                    rank = (start+1+end)/2
                    for ident in order[start:end]:
                        near(scenario['ranks'][ident], rank, ident+' tie-aware rank')
                        rankings[ident].append(rank)
                    if start == 0:
                        leaders = order[start:end]
                    start = end
                require(set(scenario['top_ids']) == set(leaders), 'Tied leaders')
                for ident in leaders:
                    credits[ident] += 1/len(leaders)
                left = [nominal_scenario['ranks'][ident] for ident in ids]
                right = [scenario['ranks'][ident] for ident in ids]
                lm, rm = math.fsum(left)/len(left), math.fsum(right)/len(right)
                denominator = math.sqrt(math.fsum((v-lm)**2 for v in left)*math.fsum((v-rm)**2 for v in right))
                correlation = scenario['spearman_vs_nominal']
                if denominator == 0:
                    require(correlation['value'] is None and correlation['reason'] == 'constant_rank_vector', 'Undefined rank correlation')
                else:
                    near(correlation['value'], math.fsum((a-lm)*(b-rm) for a, b in zip(left, right))/denominator, 'Spearman rank correlation')
            for candidate in preference['candidates']:
                ident = candidate['id']
                near(candidate['nominal_score'], nominal_scenario['scores'][ident], 'Nominal score')
                near(candidate['nominal_rank'], nominal_scenario['ranks'][ident], 'Nominal rank')
                near(candidate['rank_min'], min(rankings[ident]), 'Minimum rank')
                near(candidate['rank_max'], max(rankings[ident]), 'Maximum rank')
                near(candidate['top_share_pct'], 100*credits[ident]/len(config['scenarios']), 'Tied first-place share')
            near(sum(candidate['top_share_pct'] for candidate in preference['candidates']), 100, 'Shares sum to 100')
    return {'queries': result['query_count'], 'complete': result['rank_complete'], 'preferences': len(result['preferences'])}


def audit(base):
    design, run, output = base/'generic-pilot-plan', base/'generic-native-pilot-17', base/'generic-native-pilot-analysis'
    manifest, profile, plan = read(design/'manifest.json'), read(design/'profile.json'), read(design/'plan.json')
    ledger, dataset = read(run/'ledger.json'), read(run/'dataset.json')
    bundle, evaluation, predictions, robust, summary = [read(output/name) for name in ('model.bundle.json', 'evaluation.json', 'predictions.json', 'robustness.json', 'summary.json')]
    for filename, value in manifest['file_sha256'].items():
        require(digest(design/filename) == value, 'Frozen file '+filename)
    for filename, value in summary['artifact_sha256'].items():
        require(digest(output/filename) == value, 'Analysis artifact '+filename)
    require(ledger['finished_at'] and ledger['source_unchanged'] is True and ledger['all_planned_cases_retained'] is True, 'Native batch incomplete')
    require(canonical(profile) == ledger['profile_sha256'] == bundle['profile_sha256'] == manifest['profile_sha256'], 'Profile lineage')
    require(canonical(plan) == ledger['plan_sha256'], 'Frozen plan lineage')
    require(ledger['model_sha256'] == bundle['native_model_sha256'] == manifest['native_model_sha256'], 'Native source lineage')
    sealed(dataset, 'dataset_sha256'); sealed(bundle, 'bundle_sha256')
    require(canonical(bundle['model']) == bundle['model_sha256'], 'Frozen model hash')
    require(dataset == {**bundle['dataset_metadata'], 'rows': bundle['observations']}, 'Observation dataset completeness')
    require(len(plan['points']) == len(ledger['cases']) == len(dataset['rows']) == 17, '17 rows retained')
    planned = {point['id']: point for point in plan['points']}; observed = {row['id']: row for row in dataset['rows']}
    require(len(planned) == len(observed) == 17, 'Unique IDs')
    require(Counter(row['split'] for row in dataset['rows']) == {'training': 12, 'holdout': 3, 'verification': 2}, 'Frozen 12/3/2 split')
    residuals = []
    for row in ledger['cases']:
        ident = row['id']; point = planned[ident]; observation = observed[ident]
        require(row['inputs'] == point['parameters'] == observation['inputs'] and row['split'] == point['split'] == observation['split'], ident+' frozen design')
        require(row['source'] == f'runs/{ident}/raw.json', ident+' raw source path')
        case_dir = run/'runs'/ident; raw = read(case_dir/'raw.json')
        require(raw['case_id'] == ident and raw['parameters'] == point['parameters'], ident+' capture identity')
        require(row['accepted'] == observation['accepted'] == all(row['gates'].values()), ident+' accepted gates')
        if row['accepted']:
            require(raw['private_document_closed'] is True and raw['source_unchanged'] is True, ident+' isolated cleanup')
            require(raw['profile_sha256'] == ledger['profile_sha256'] and raw['model_sha256'] == ledger['model_sha256'], ident+' raw lineage')
            require(digest(case_dir/'input.bkp') == ledger['model_sha256'] and digest(case_dir/'aspen-report.rep') == raw['report_sha256'], ident+' local evidence hashes')
            audit_controls(profile, raw, point['parameters'])
            residuals.append(audit_case(profile, raw, read(case_dir/'project.json'), read(case_dir/'assessment.json'), row))
        expected = {'purchased_energy_kWh_kg': row.get('metrics', {}).get('purchased_energy_kWh_kg'), 'yield_fraction': row.get('metrics', {}).get('yield_fraction')}
        expected.update({'impact:'+key: value['value'] for key, value in row.get('metrics', {}).get('impacts', {}).items()})
        for key, value in observation['outputs'].items():
            require(value == expected.get(key), ident+' dataset response '+key)
    accepted = sum(row['accepted'] for row in ledger['cases'])
    require(ledger['accepted_count'] == accepted and ledger['failed_count'] == 17-accepted, 'Native acceptance counts')
    training = [row for row in dataset['rows'] if row['split'] == 'training' and row['accepted']]
    require(bundle['model']['training_case_ids'] == [row['id'] for row in training], 'Only accepted frozen training rows fitted')
    require(bundle['model']['training_inputs_raw'] == [[row['inputs'][spec['id']] for spec in dataset['inputs']] for row in training], 'Training coordinates')
    model = bundle['model']
    for i, spec in enumerate(model['inputs']):
        values = [row['inputs'][spec['id']] for row in training]; mean = math.fsum(values)/len(values)
        scale = math.sqrt(math.fsum((v-mean)**2 for v in values)/len(values))
        near(model['input_scaler']['mean'][i], mean, spec['id']+' training-only mean')
        near(model['input_scaler']['scale'][i], scale, spec['id']+' training-only scale')
        for row, value in zip(model['training_inputs_scaled'], values):
            near(row[i], (value-mean)/scale, spec['id']+' scaled training coordinate')
    for spec in model['responses']:
        key = spec['id']; reg = model['regressors'][key]; values = [row['outputs'][key] for row in training]
        mean = math.fsum(values)/len(values); scale = math.sqrt(math.fsum((v-mean)**2 for v in values)/len(values)) or 1
        near(reg['output_mean'], mean, key+' training-only output mean')
        near(reg['output_scale'], scale, key+' training-only output scale')
        # Multiply the saved covariance by alpha; this checks fitted coefficients
        # against training targets without solving, selecting, or fitting anything.
        for i, row in enumerate(model['training_inputs_scaled']):
            terms = []
            for j, other in enumerate(model['training_inputs_scaled']):
                radius = math.sqrt(math.fsum(((a-b)/length)**2 for a, b, length in zip(row, other, reg['length_scale'])))
                q = math.sqrt(5)*radius
                covariance = reg['constant_value']*(1+q+5*radius**2/3)*math.exp(-q)
                if i == j:
                    covariance += reg['white_noise_level']+reg['alpha']
                terms.append(covariance*reg['dual_coefficients'][j])
            near(math.fsum(terms), (values[i]-mean)/scale, key+' posterior coefficient training equation', atol=2e-5, rtol=2e-6)
    errors = audit_evaluation(bundle, evaluation, read(design/'criteria.json'), dataset)
    queries = read(design/'queries.json')
    require([row['inputs'] for row in predictions['records']] == queries['points'], 'All frozen queries retained')
    require(predictions['model_sha256'] == bundle['model_sha256'] and predictions['dataset_sha256'] == dataset['dataset_sha256'], 'Prediction lineage')
    for record in predictions['records']:
        if record['constraints_passed']:
            prediction_values(bundle['model'], record['inputs'], record['outputs'], record['id'])
            for heldout in evaluation['records']:
                if heldout['constraints_passed'] and heldout['inputs'] == record['inputs']:
                    require(heldout['predicted'] == record['outputs'], 'Verification/query identical-coordinate prediction')
    require(predictions['all_queries_supported'] == all(row['constraints_passed'] for row in predictions['records']), 'Prediction coverage')
    require(predictions['exploratory'] == robust['exploratory'] == (not bundle['prediction_enabled']), 'Exploratory labels')
    robust_check = audit_robustness(bundle, robust, read(design/'robustness.config.json'))
    return {'audit_passed': True, 'native_cases': 17, 'accepted_cases': accepted, 'split_counts': dict(Counter(row['split'] for row in dataset['rows'])),
            'validation_passed': evaluation['passed'], 'prediction_enabled': bundle['prediction_enabled'], 'validation_arithmetic': errors,
            'residual_checks': residuals, 'robustness': robust_check, 'model_refitted': False, 'native_execution_performed': False,
            'scope': 'Independent scalar posterior mean, signed residual sums, native-unit conversions, fixed-inventory LCIA arithmetic, frozen split/error checks and scenario rank summaries. Local evidence consistency only; no thermophysical or external authenticity validation.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    try:
        print(json.dumps(audit(args.base), ensure_ascii=False, allow_nan=False, indent=2))
    except (KeyError, ValueError, TypeError, OSError, OverflowError) as error:
        print(json.dumps({'audit_passed': False, 'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2)
