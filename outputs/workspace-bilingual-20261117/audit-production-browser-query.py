"""Read-only comparison of downloaded browser means with the frozen Python model.

No fit, native application, background LCA calculation, or source mutation.
"""
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from process_pipeline.surrogate import predict


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def main():
    folder = Path(__file__).parent
    public = ROOT / 'analysis_web/data/generic-htl-extension'
    output = folder / 'production-v2-direct-query-python-audit.json'
    if output.exists():
        raise RuntimeError('Refusing to overwrite a completed production query audit')
    downloads = [folder / name for name in ('production-v2-direct-query.json', 'production-v2-direct-query-2.json')]
    watched = downloads + [public / name for name in ('model.bundle.json', 'index.json', 'profile.json')]
    before = {str(path.relative_to(ROOT)): sha(path) for path in watched}
    bundle = read(public / 'model.bundle.json')
    index = read(public / 'index.json')
    profile = read(public / 'profile.json')
    source_sha = sha(public / 'model.bundle.json')
    assert source_sha == index['files']['model.bundle.json']['sha256']
    assert (public / 'model.bundle.json').stat().st_size == index['files']['model.bundle.json']['bytes']
    assert bundle['prediction_enabled'] is True and bundle['validation']['passed'] is True
    assert bundle['model_sha256'] == index['model_sha256']
    assert bundle['dataset_metadata']['basis'] == {
        key: profile['mapping']['meta'].get(key)
        for key in ('functional_unit', 'boundary', 'allocation_method', 'enthalpy_basis', 'calorie_J')}
    input_units = {spec['id']: spec['unit'] for spec in bundle['model']['inputs']}
    response_units = {spec['id']: spec['unit'] for spec in bundle['model']['responses']}
    identity_keys = ('model_sha256', 'bundle_sha256', 'dataset_sha256', 'profile_id', 'profile_sha256', 'native_model_sha256')
    records = []
    maximum_absolute = maximum_relative = 0.0
    for path in downloads:
        artifact = read(path)
        assert artifact['result_version'] == 1 and artifact['kind'] == 'surrogate_prediction'
        assert artifact['evidence_type'] == 'browser_surrogate_prediction'
        assert artifact['exploratory'] is False
        assert artifact['native_execution_performed'] is False
        assert artifact['physical_validation'] is False
        assert artifact['dataset_metadata'] == bundle['dataset_metadata']
        assert artifact['inputs'] == bundle['model']['inputs']
        assert artifact['responses'] == bundle['model']['responses']
        for key in identity_keys:
            assert artifact[key] == bundle[key], (path.name, key)
        assert artifact['source_file'] == {
            'path': 'data/generic-htl-extension/model.bundle.json',
            'sha256': source_sha, 'byte_sha256_verified': True}
        assert 'No new Aspen run' in artifact['scope']
        assert 'energy/LCA recalculation' in artifact['scope']
        assert 'uncertainty interval' in artifact['scope']
        assert len(artifact['records']) == 1
        row = artifact['records'][0]
        assert row['kind'] == 'prediction' and row['constraints_passed'] is True and row['errors'] == []
        assert row['input_units'] == input_units and row['units'] == response_units
        expected = predict(bundle, [row['inputs']], units=row['input_units'])
        assert expected['all_queries_supported'] is True and expected['exploratory'] is False
        python_means = expected['records'][0]['outputs']
        assert set(row['outputs']) == set(python_means)
        comparison = {}
        for response, mean in python_means.items():
            browser_mean = row['outputs'][response]
            assert isinstance(browser_mean, (int, float)) and not isinstance(browser_mean, bool) and math.isfinite(browser_mean)
            absolute = abs(browser_mean - mean)
            relative = absolute / abs(mean) if mean != 0 else None
            assert absolute <= 1e-9 + 1e-10 * abs(mean), (path.name, response, browser_mean, mean)
            maximum_absolute = max(maximum_absolute, absolute)
            if relative is not None:
                maximum_relative = max(maximum_relative, relative)
            comparison[response] = {'unit': response_units[response], 'browser_mean': browser_mean,
                                    'python_mean': mean, 'absolute_difference': absolute,
                                    'relative_difference': relative}
        records.append({'file': str(path.relative_to(ROOT)), 'file_sha256': sha(path), 'inputs': row['inputs'],
                        'input_units': input_units, 'all_checks_passed': True, 'responses': comparison})
    after = {str(path.relative_to(ROOT)): sha(path) for path in watched}
    assert before == after
    report = {
        'audit_version': 1, 'audit_utc': datetime.now(timezone.utc).isoformat(), 'passed': True,
        'method': 'process_pipeline.surrogate.predict on the unchanged public v2 frozen posterior, using downloaded exact native inputs and unit maps',
        'query_count': len(records), 'scalar_response_count': sum(len(row['responses']) for row in records),
        'maximum_absolute_difference': maximum_absolute, 'maximum_relative_difference': maximum_relative,
        'numeric_agreement_policy': {'absolute_tolerance': 1e-9, 'relative_tolerance': 1e-10,
                                     'zero_reference_relative_difference': None},
        'model_identity': {key: bundle[key] for key in identity_keys},
        'source_bundle_file_sha256': source_sha,
        'accounting_basis': bundle['dataset_metadata']['basis'],
        'response_interpretation': {'purchased_energy_kWh_kg': 'Purchased energy per kg declared target product; inherited partial utility boundary.',
                                    'yield_fraction': 'Declared target-product mass divided by feed mass; dimensionless fraction, not percent.',
                                    'impact:Climate change': 'Fixed-background climate impact per kg declared target product; not a new LCA/background calculation.'},
        'source_files_unchanged': True, 'audited_file_sha256': before,
        'native_execution_performed': False, 'model_refitted': False, 'background_lca_recomputed': False,
        'physical_validation': False, 'uncertainty_estimated': False,
        'scope': 'This checks downloaded mean arithmetic, exact units, accounting metadata and source identities against the frozen local public bundle. It is not fresh native execution, physical validation, a model accuracy assessment, or independent authentication of arbitrary native provenance claims.',
        'records': records}
    output.write_text(json.dumps(report, ensure_ascii=False, allow_nan=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'passed': True, 'query_count': len(records), 'maximum_absolute_difference': maximum_absolute,
                      'maximum_relative_difference': maximum_relative, 'output': str(output)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
