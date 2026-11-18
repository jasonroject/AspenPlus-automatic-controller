import json,hashlib,sys
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from process_pipeline.profile import canonical_hash,validate_plan
BASE=Path(__file__).resolve().parent;DESIGN=BASE/'generic-pilot-plan';OUT=BASE/'local-perturbation-plan'
read=lambda p:json.loads(p.read_text(encoding='utf-8'))
assert not (BASE/'generic-native-pilot-analysis').exists(),'Freeze before looking at the fitted model'
assert not OUT.exists(),'Preserve prior preregistration'
profile=read(DESIGN/'profile.json');config=read(DESIGN/'robustness.config.json');original=read(DESIGN/'plan.json')
candidate=next(c for c in config['candidates'] if c['id']=='HTL-T330-L12p5')
original_by_coord={tuple(p['parameters'][v['id']] for v in profile['variables']):p for p in original['points']}
points=[];mapping=[]
for index,scenario in enumerate(config['scenarios'],1):
    inputs={key:value+config['perturbations'][key]['halfwidth']*scenario['offsets'][key] for key,value in candidate['inputs'].items()}
    existing=original_by_coord.get(tuple(inputs[v['id']] for v in profile['variables']))
    point={'id':f'local-{index:02d}','parameters':inputs,'split':'verification'};points.append(point)
    mapping.append({'id':point['id'],'scenario_id':scenario['id'],'prediction_record_id':candidate['id']+'::'+scenario['id'],
                    'new_coordinate':existing is None,'original_point_id':existing['id'] if existing else None,'original_split':existing['split'] if existing else None})
assert len(points)==9 and sum(r['new_coordinate'] for r in mapping)==8
plan={'plan_version':1,'profile_id':profile['id'],'model_sha256':profile['model']['sha256'],'points':points}
validate_plan(plan,profile)
OUT.mkdir()
for name,value in [('plan.json',plan),('mapping.json',mapping)]:
    (OUT/name).write_text(json.dumps(value,ensure_ascii=False,allow_nan=False,indent=2)+'\n',encoding='utf-8')
manifest={'created_at':datetime.now(timezone.utc).isoformat(),'design_origin':'Coordinate-center candidate fixed before fitting, not chosen from the rank results',
 'candidate_id':candidate['id'],'candidate_inputs':candidate['inputs'],'native_model_sha256':profile['model']['sha256'],
 'profile_sha256':canonical_hash(profile),'config_sha256':canonical_hash(config),'plan_sha256':canonical_hash(plan),
 'criteria_sha256':canonical_hash(read(DESIGN/'criteria.json')),'file_sha256':{name:hashlib.sha256((OUT/name).read_bytes()).hexdigest() for name in ['plan.json','mapping.json']},
 'case_count':9,'new_coordinate_count':8,'repeat_original_holdout_count':1,'split':'verification',
 'fitting_performed_before_preparation':False,'model_sha256':None,'model_binding':'Bind to the original frozen 17-point pilot bundle in the later comparison result; never refit using these runs',
 'reporting':'All nine requests retained. Report new-eight mean-prediction errors separately; center repeat checks execution repeatability against the original holdout. Any failed point prevents a complete-check pass; no replacement or survivor-only pass.',
 'criteria':'Reuse the original 5 percent relative error rules and explicit response-unit floors; prediction checks, not operating performance thresholds.',
 'scope':'One local perturbation neighborhood. Does not validate nine-candidate rankings, continuous-region extrema, probabilities, GP predictive uncertainty, LCA backgrounds, or physical reliability.'}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(manifest,ensure_ascii=False,indent=2))
