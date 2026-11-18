"""Run a bounded fresh-Aspen pilot, retaining every failed attempt."""
import json
from pathlib import Path
import subprocess
import sys
import argparse
import hashlib
import math
import shutil

ROOT = Path(__file__).resolve().parents[1]
LIVE = ROOT / 'outputs/htl_pipeline/live'
DESIGN = [(325.0, 8.5), (335.0, 12.5), (345.0, 7.5)]

def main():
    if len(sys.argv) > 1 and sys.argv[1] == 'worker':
        import native_scan
        native_scan.O = LIVE
        t, length = map(float, sys.argv[2:])
        native_scan.worker(('pilot_' + native_scan.key(t, length), [{
            'temperature_C': t, 'length_m': length,
            'phase': 'pilot', 'split': 'fresh_verification',
            'region': 'original_operating_domain'}]))
        return
    parser = argparse.ArgumentParser()
    parser.add_argument('--design', type=Path, help='JSON plan downloaded from the analysis website')
    parser.add_argument('--model', type=Path, help='Private reference source_HR.bkp; copied without modifying the original')
    args = parser.parse_args()
    design = DESIGN
    if args.design:
        plan = json.loads(args.design.read_text(encoding='utf-8'))
        design = [(r['temperature_C'], r['length_m']) for r in plan['points']]
    if not 1 <= len(design) <= 100:
        raise ValueError('A bounded run must contain 1–100 cases')
    for t, length in design:
        if not math.isfinite(t) or not math.isfinite(length) or not (310 <= t <= 350 and 5 <= length <= 20):
            raise ValueError('Design outside the validated temperature/length domain')
        if abs(t-round(t,2))>1e-8 or abs(length-round(length,2))>1e-8:
            raise ValueError('Native plan coordinates must have at most two decimal places')
    expected = json.loads((Path(__file__).parent/'reference/protocol.json').read_text())['source_sha256']
    if args.model:
        if hashlib.sha256(args.model.read_bytes()).hexdigest() != expected:
            raise ValueError('Supplied native model differs from the reference model')
        LIVE.mkdir(parents=True, exist_ok=True)
        if args.model.resolve() != (LIVE/'source_HR.bkp').resolve():
            shutil.copy2(args.model,LIVE/'source_HR.bkp')
    (LIVE/'raw').mkdir(parents=True, exist_ok=True)
    if hashlib.sha256((LIVE/'source_HR.bkp').read_bytes()).hexdigest() != expected:
        raise ValueError('Native model hash differs from the reference model')
    outcomes = []
    for t, length in design:
        from native_scan import key
        cached = LIVE/'raw'/(key(t,length)+'.json')
        if cached.exists():
            record = json.loads(cached.read_text(encoding='utf-8'))
            if record.get('source_sha256') != expected or not record.get('completed'):
                raise ValueError(f'Existing failed or mismatched case retained: {cached}. Inspect before retrying.')
            outcomes.append({'temperature_C':t,'length_m':length,'status':'cached_completed'})
            continue
        run = subprocess.run([sys.executable, '-X', 'utf8', str(Path(__file__)),
                              'worker', str(t), str(length)], check=False)
        outcomes.append({'temperature_C': t, 'length_m': length, 'exit_code': run.returncode})
        (LIVE / 'execution.json').write_text(json.dumps(outcomes, indent=2))
        if run.returncode:
            raise RuntimeError('Worker failed; preserved previous results; inspect execution.json')
        record = json.loads(cached.read_text(encoding='utf-8'))
        if not record.get('completed'):
            raise RuntimeError(f'Native calculation failed; record retained: {cached}')
    (LIVE / 'execution.json').write_text(json.dumps(outcomes, indent=2),encoding='utf-8')

if __name__ == '__main__':
    main()
