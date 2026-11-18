"""Evaluate the frozen pilot once; never tune using its held-out responses."""
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from process_pipeline.profile import canonical_hash
from process_pipeline.surrogate import fit,evaluate,predict
from process_pipeline.robustness import analyze_robustness
from process_pipeline.runner import build_dataset,report_messages

BASE=Path(__file__).resolve().parent
DESIGN=BASE/'generic-pilot-plan'
RUN=BASE/'generic-native-pilot-17'
OUT=BASE/'generic-native-pilot-analysis'
read=lambda path:json.loads(path.read_text(encoding='utf-8'))
file_hash=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
ledger=read(RUN/'ledger.json')
if not ledger.get('finished_at') or not ledger.get('all_planned_cases_retained'):
    raise SystemExit('Native scan is still incomplete; nothing fitted.')
if ledger.get('source_unchanged') is not True:
    raise SystemExit('Source identity check failed; nothing fitted.')
manifest=read(DESIGN/'manifest.json')
for filename,digest in manifest['file_sha256'].items():
    assert file_hash(DESIGN/filename)==digest,filename+' was changed'
robust_manifest=read(DESIGN/'robustness-manifest.json')
assert file_hash(DESIGN/'robustness.config.json')==robust_manifest['config_file_sha256']
assert ledger['planned_count']==17 and len(ledger['cases'])==17
profile=read(DESIGN/'profile.json')
assert canonical_hash(profile)==ledger['profile_sha256']==manifest['profile_sha256']
assert canonical_hash(read(DESIGN/'plan.json'))==ledger['plan_sha256']
assert ledger['model_sha256']==manifest['native_model_sha256']
plan=read(DESIGN/'plan.json');points={point['id']:point for point in plan['points']}
assert len(points)==17 and {row['id'] for row in ledger['cases']}==set(points)
assert ledger['accepted_count']==sum(row['accepted'] is True for row in ledger['cases'])
assert ledger['failed_count']==17-ledger['accepted_count']
assert {split:sum(row['split']==split for row in ledger['cases']) for split in ['training','holdout','verification']}=={'training':12,'holdout':3,'verification':2}
assert file_hash(ROOT/'outputs/htl_pipeline/live/source_HR.bkp')==manifest['native_model_sha256']
checks=[]
for row in ledger['cases']:
    point=points[row['id']]
    assert row['split']==point['split'] and row['inputs']==point['parameters'],row['id']+' frozen point'
    assert row['source']==f"runs/{row['id']}/raw.json",row['id']+' source path'
    raw_path=(RUN/row['source']).resolve();raw_path.relative_to(RUN.resolve());raw=read(raw_path)
    assert raw['case_id']==row['id'] and raw['split']==point['split'],row['id']+' raw identity'
    assert raw['parameters']==point['parameters'],row['id']+' raw inputs'
    assert raw['profile_id']==profile['id']
    lineage_complete=raw.get('profile_sha256')==ledger['profile_sha256']
    if raw.get('profile_sha256') is not None:assert lineage_complete,row['id']+' profile binding'
    if row['accepted']:assert lineage_complete,row['id']+' accepted without complete lineage'
    assert raw['model_sha256']==ledger['model_sha256']
    if row.get('attempted'):
        assert raw.get('private_document_closed') is True,row['id']+' cleanup'
        assert raw.get('source_unchanged') is True,row['id']+' source'
        assert file_hash(raw_path.parent/'input.bkp')==ledger['model_sha256'],row['id']+' isolated source copy'
    if raw.get('report_available'):
        report=raw_path.parent/'aspen-report.rep'
        assert file_hash(report)==raw['report_sha256'],row['id']+' report hash'
        warnings,rejected,completed=report_messages(report.read_text(errors='replace'))
        assert raw['report_completion_accepted']==(completed and not rejected)
    if row['accepted']:
        assert raw.get('report_available') is True and raw.get('report_completion_accepted') is True
        assert all(row['gates'].values()) and raw.get('solver_accepted') is True and raw.get('control_succeeded') is True
    checks.append({'id':row['id'],'split':row['split'],'gates':row['gates'],
                   'accepted':row['accepted'],'error':row.get('error'),'warnings':row['warnings'],
                   'raw_file_sha256':file_hash(raw_path),'report_sha256':raw.get('report_sha256'),
                   'profile_lineage_complete':lineage_complete,
                   'private_document_closed':raw.get('private_document_closed'),
                   'source_unchanged':raw.get('source_unchanged'),
                   'native_elapsed_seconds':raw.get('elapsed_seconds')})
if OUT.exists():raise SystemExit('Analysis output already exists; prior results retained.')
dataset=read(RUN/'dataset.json')
assert canonical_hash(dataset)==canonical_hash(build_dataset(profile,ledger)),'Dataset does not match the verified frozen ledger'
bundle=fit(dataset,read(DESIGN/'criteria.json'))
evaluation=evaluate(bundle)
assert evaluation==bundle['validation']
queries=read(DESIGN/'queries.json')
exploratory=not bundle['prediction_enabled']
predictions=predict(bundle,queries['points'],allow_exploratory=exploratory,units=queries['units'])
robustness=analyze_robustness(bundle,read(DESIGN/'robustness.config.json'),allow_exploratory=exploratory)
OUT.mkdir()
artifacts={'model.bundle.json':bundle,'evaluation.json':evaluation,
           'predictions.json':predictions,'robustness.json':robustness,
           'native-checks.json':{'created_at':datetime.now(timezone.utc).isoformat(),
             'source_unchanged':True,'planned_count':17,'accepted_count':ledger['accepted_count'],
             'failed_count':ledger['failed_count'],'all_planned_cases_retained':True,
             'model_sha256':ledger['model_sha256'],'profile_sha256':ledger['profile_sha256'],
             'plan_sha256':ledger['plan_sha256'],'started_at':ledger['started_at'],
             'finished_at':ledger['finished_at'],'cases':checks,'physical_validation':False,
             'scope':'Recorded checks from this local copied-model run; public JSON does not independently authenticate native execution.'}}
for name,value in artifacts.items():
    (OUT/name).write_text(json.dumps(value,ensure_ascii=False,allow_nan=False,indent=2)+'\n',encoding='utf-8')
summary={'created_at':datetime.now(timezone.utc).isoformat(),
 'native_cases':len(ledger['cases']),'accepted_cases':ledger['accepted_count'],
 'counts':bundle['readiness']['counts'],'prediction_enabled':bundle['prediction_enabled'],
 'validation_passed':evaluation['passed'],'splits':evaluation['splits'],'reasons':evaluation['reasons'],
 'all_queries_supported':predictions['all_queries_supported'],
 'scenario_queries':robustness['query_count'],'rank_complete':robustness['rank_complete'],
 'exploratory':exploratory,'physical_validation':False,
 'frozen_design_unchanged':True,'holdout_based_tuning_performed':False,
 'source_files':{str(p.relative_to(ROOT)):file_hash(p) for p in [ROOT/'process_pipeline/surrogate.py',ROOT/'process_pipeline/robustness.py']},
 'artifact_sha256':{name:file_hash(OUT/name) for name in artifacts}}
(OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,allow_nan=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False,indent=2))
