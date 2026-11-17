"""Build a blocked HTL profile draft only from already captured paths and units.

No Aspen connection. The missing heater Input TEMP unit and global completion
status must be reviewed against a read-only copied-model inspection.
"""
import argparse
from pathlib import Path
import json

from .profile import digest, validate_profile


ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--discovery', type=Path, help='Reviewed copy-only discovery evidence for the exact source hash')
    args = parser.parse_args()
    raw = json.loads((ROOT / 'outputs/htl_pipeline/live/raw/T325p00_L8p50.json').read_text(encoding='utf-8'))
    declared = json.loads((ROOT / 'analysis_web/data/universal-htl.json').read_text(encoding='utf-8'))
    coefficient = json.loads((ROOT / 'htl_pipeline/reference/lca_coefficients.json').read_text(encoding='utf-8'))
    readouts = []
    def read(ident, path, record):
        if record.get('value') is None or 'unit' not in record:
            raise ValueError('Reference does not verify this readout: ' + path)
        readouts.append({'id': ident, 'path': path, 'native_unit': record['unit']})
        return {'readout': ident}
    source = 'Mapping rule reused from audited HTL T325p00_L8p50 export (2026-11-17); each case value comes from its current raw capture'
    zero = {'constant': 0, 'unit': 'kW', 'source': source + '; explicit zero external duty/work convention from audited topology'}
    streams = []
    for stream in declared['streams']:
        ident = stream['id']; captured = raw['streams'][ident]
        streams.append({'id': ident, 'from': stream['from'], 'to': stream['to'],
            'mass': read('mass_' + ident, f'\\Data\\Streams\\{ident}\\Output\\MASSFLMX\\MIXED', captured['MASSFLMX']),
            'specific_enthalpy': read('h_' + ident, f'\\Data\\Streams\\{ident}\\Output\\HMX_MASS\\MIXED', captured['HMX_MASS'])})
    blocks = []
    for block in declared['blocks']:
        ident = block['id']; captured = raw['blocks'][ident]
        heat = zero if ident in ('PUMP', 'HEATCHAG', 'VALVE') else read('heat_' + ident, f'\\Data\\Blocks\\{ident}\\Output\\QCALC', captured['\\QCALC'])
        power = read('power_' + ident, f'\\Data\\Blocks\\{ident}\\Output\\WNET', captured['\\WNET']) if ident == 'PUMP' else zero
        blocks.append({'id': ident, 'heat': heat, 'power': power, 'source': source})
    components = {}
    for component in ('CAT', 'O-CRE-01', 'CO2', 'CH4', 'H2O'):
        components[component] = {'sum': [read(f'{stream}_{component}', f'\\Data\\Streams\\{stream}\\Output\\MASSFLOW\\MIXED\\{component}',
            raw['streams'][stream]['MASSFLOW']['\\MIXED\\' + component]) for stream in ('S7', 'S8')],
            'source': source + '; component mass across both terminal streams'}
    product = {'sum': [components['CAT'], components['O-CRE-01']], 'source': 'Catechol + o-cresol outlet mass, not isolated recovery'}
    energy = {'sum': [
        {'positive': {'readout': 'heat_HEATER'}, 'source': 'Inherited unity useful-heat to equivalent-electricity assumption'},
        {'positive': {'readout': 'heat_REACTOR'}, 'source': 'Inherited unity useful-heat to equivalent-electricity assumption'},
        {'constant': coefficient['pump_inventory_kWh'] * 1000 / 4.1868, 'unit': 'cal/sec',
         'source': 'Fixed pump inventory 2.172 kWh/h converted explicitly to cal/sec using 4.1868 J/cal; not pump native work'}],
        'source': 'Inherited restricted HTL energy inventory: heater + reactor + fixed pump; excludes separator heat and cooling service'}
    quantities = {'feed': {'readout': 'mass_FEED'}, 'electricity': energy, 'CO2': components['CO2'], 'CH4': components['CH4'], 'wastewater': components['H2O']}
    inventory = [{key: row[key] for key in ('id', 'name', 'kind', 'factor_id')} |
                 {'source': source + '; inherited inventory rule: ' + row['id'], 'quantity': quantities[row['id']]}
                 for row in declared['inventory']]
    meta = {key: value for key, value in declared['meta'].items() if key not in ('source_sha256', 'native_warnings')}
    meta['name'] = 'HTL native model profile · restricted inherited inventory'
    meta['comparable_cases'] = True
    profile = {'profile_version': 1, 'id': 'htl-reference-hr', 'name': 'Existing HTL HR reference model (review required)',
        'model': {'path': 'source_HR.bkp', 'sha256': raw['source_sha256']},
        'variables': [
            {'id': 'reactor_temperature_K', 'path': '\\Data\\Blocks\\REACTOR\\Input\\REAC_TEMP', 'native_unit': raw['input_readback']['REAC_TEMP']['unit'], 'min': 583.15, 'max': 623.15},
            {'id': 'heater_temperature_K', 'path': '\\Data\\Blocks\\HEATER\\Input\\TEMP', 'native_unit': 'UNVERIFIED', 'min': 583.15, 'max': 623.15},
            {'id': 'tube_length_m', 'path': '\\Data\\Blocks\\REACTOR\\Input\\LENGTH', 'native_unit': raw['input_readback']['LENGTH']['unit'], 'min': 5, 'max': 20}],
        'readouts': readouts,
        'solver_checks': [{'path': '\\Data\\Results Summary\\Run-Status\\Output\\CVSTAT', 'accepted_values': [], 'label': 'Global completion code: inspection required'}],
        'mapping': {'meta': meta, 'product': {'quantity': product, 'feed': {'readout': 'mass_FEED'}, 'allocation': 1, 'source': source},
            'streams': streams, 'blocks': blocks, 'inventory': inventory, 'factors': declared['factors']},
        'limits': {'max_cases': 100, 'timeout_seconds': 1200},
        'review': {'state': 'incomplete_draft', 'reference_capture': 'T325p00_L8p50, 2026-11-17',
            'required': ['Verify exact HEATER Input TEMP UnitString in this same source hash',
                         'Inspect global native completion nodes and define accepted solver codes',
                         'Review linked heater/reactor temperature controls; the published HTL domain assumes equal setpoints',
                         'Review fixed integration controls INT_TOL=1e-4 and MAX_NSTEP=100000 against source settings before a native scan'],
            'notes': ['Declared temperature domain is 310–350 degrees Celsius expressed as native kelvin',
                      'All process/output units above come from the native captured reference; no unit was inferred',
                      'This factor mapping is the existing restricted foreground climate inventory, not complete whole-plant LCA']}}
    if args.discovery:
        discovery = json.loads(args.discovery.read_text(encoding='utf-8'))
        if discovery.get('model_sha256') != raw['source_sha256'] or discovery.get('native_run_performed') is not False or discovery.get('original_unchanged') is not True or discovery.get('private_document_closed') is not True:
            raise ValueError('Expected completed copy-only inspection with this exact preserved source hash')
        records = {row['path']: row for row in discovery['nodes']}
        heater = profile['variables'].pop(1)
        actual = records[heater['path']]
        if actual.get('unit') != profile['variables'][0]['native_unit'] or not isinstance(actual.get('value'), (float, int)):
            raise ValueError('Inspected heater temperature must share the exact native kelvin unit')
        profile['linked_inputs'] = [{'id': heater['id'], 'source_id': 'reactor_temperature_K', 'path': heater['path'],
                                     'native_unit': actual['unit'], 'source': 'HTL operating domain requires equal heater/reactor temperature setpoints'}]
        profile['fixed_inputs'] = []
        for ident, node_name, value in [('integration_tolerance', 'INT_TOL', raw['int_tol']), ('maximum_integration_steps', 'MAX_NSTEP', raw['max_nstep'])]:
            path = '\\Data\\Blocks\\REACTOR\\Input\\' + node_name
            actual = records[path]
            if actual.get('unit') != '' or not isinstance(actual.get('value'), (float, int)):
                raise ValueError('Missing numeric dimensionless integration control: ' + path)
            profile['fixed_inputs'].append({'id': ident, 'path': path, 'native_unit': actual['unit'], 'value': value,
                'source': 'Explicitly reuse audited HTL integration control; differs from unmodified archive setting'})
        profile['solver_checks'] = [{'path': '\\Data\\Blocks\\' + block['id'] + '\\Output\\BLKSTAT', 'accepted_values': [0, 2],
            'label': block['id'] + ' native block status (0 normal, 2 retained warning); completion report also required'} for block in blocks]
        profile['limits']['timeout_seconds'] = 300
        profile['name'] = 'Existing HTL HR reference model · reviewed mapping'
        profile['review'] = {'state': 'reviewed', 'discovery_source': args.discovery.name,
            'discovery_sha256': digest(args.discovery), 'reference_capture': 'T325p00_L8p50, 2026-11-17',
            'reference_capture_sha256': digest(ROOT / 'outputs/htl_pipeline/live/raw/T325p00_L8p50.json'),
            'native_adapter_validation': 'pending bounded single-point run; read-only discovery is not execution validation',
            'notes': ['All paths/native units verified against retained native export and copy-only discovery',
                      'Global Run-Status branch is unavailable before solving; use all declared block statuses plus required explicit report completion',
                      'Warning status 2 is retained, not represented as warning-free convergence',
                      'Heater temperature equals reactor temperature through one identity-linked control',
                      'INT_TOL=1e-4 and MAX_NSTEP=100000 are explicit fixed writes, with runtime readback required',
                      'Inherited restricted foreground climate inventory excludes separator heat and cooling service upstream burdens']}
        validate_profile(profile)
    for path in (ROOT / 'process_pipeline/examples/htl-model-profile.json', ROOT / 'analysis_web/data/htl-model-profile.json'):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(profile, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Wrote ' + profile['review']['state'] + ' HTL profile; no Aspen application was started.')


if __name__ == '__main__': main()
