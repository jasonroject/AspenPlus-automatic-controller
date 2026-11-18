"""Export existing native values for UI chart markers; does not execute or fit Aspen."""
import csv
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / 'htl_pipeline/reference/native_samples.csv'
FRESH = ROOT / 'outputs/htl_pipeline/fresh_comparison.json'
OUTPUT = ROOT / 'analysis_web/data/pipeline-observations.json'
FIELDS = ['temperature_C', 'length_m', 'target_kg_h', 'STD_electricity_kWh',
          'HR_electricity_kWh', 'CF_STD', 'CF_HR']


def build():
    rows = []
    with REFERENCE.open(encoding='utf-8', newline='') as stream:
        for row in csv.DictReader(stream):
            if row['accepted'] != 'True' or not (310 <= float(row['temperature_C']) <= 350
                                                and 5 <= float(row['length_m']) <= 20):
                continue
            numeric = {key: float(row[key]) if row[key] else None for key in FIELDS}
            rows.append({**numeric, 'split': row['split'], 'source': 'native_reference',
                         'source_record': row['source_file']})
    for index, row in enumerate(json.loads(FRESH.read_text(encoding='utf-8'))):
        rows.append({'temperature_C': row['temperature_C'], 'length_m': row['length_m'],
                     **row['actual'], 'split': 'fresh_verification', 'source': 'fresh_comparison',
                     'source_record': str(index)})
    artifact = {
        'version': 1,
        'scope': 'Existing accepted native reference and verification values. No new simulations.',
        'basis': {'wet_feed_kg': 100, 'duration_h': 1, 'pressure_MPa': 25,
                  'temperature': 'actual Celsius (Kelvin minus 273.15)'},
        'sources': [{'id': 'native_reference', 'path': 'htl_pipeline/reference/native_samples.csv',
                     'sha256': hashlib.sha256(REFERENCE.read_bytes()).hexdigest()},
                    {'id': 'fresh_comparison', 'path': 'outputs/htl_pipeline/fresh_comparison.json',
                     'sha256': hashlib.sha256(FRESH.read_bytes()).hexdigest()}],
        'rows': rows,
    }
    OUTPUT.write_text(json.dumps(artifact, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    print(f'Exported {len(rows)} existing native records to {OUTPUT}')


if __name__ == '__main__':
    build()
