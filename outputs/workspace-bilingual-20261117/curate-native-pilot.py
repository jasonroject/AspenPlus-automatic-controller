"""Copy reviewed derived evidence to the public frontend; never copy native archives."""
import hashlib,json,shutil,re
from pathlib import Path
BASE=Path(__file__).resolve().parent;ROOT=BASE.parents[1]
RUN=BASE/'generic-native-pilot-17';ANALYSIS=BASE/'generic-native-pilot-analysis';DESIGN=BASE/'generic-pilot-plan'
OUT=ROOT/'analysis_web/data/generic-htl-pilot'
assert not OUT.exists(),'Keep existing public evidence unchanged; review a new version explicitly.'
files={**{name:ANALYSIS/name for name in ['model.bundle.json','evaluation.json','predictions.json','robustness.json','native-checks.json','summary.json']},
       **{name:RUN/name for name in ['project.json','dataset.json']},
       **{name:DESIGN/name for name in ['profile.json','plan.json','criteria.json']},
       'scenario-config.json':DESIGN/'robustness.config.json',
       'scan-preregistration.json':DESIGN/'manifest.json','scenario-preregistration.json':DESIGN/'robustness-manifest.json'}
for name,path in files.items():
    content=path.read_text(encoding='utf-8');json.loads(content)
    assert not re.search(r'[A-Za-z]:\\\\|(?:api[_-]?key|access_token|refresh_token|VERCEL_OIDC_TOKEN)"\s*:',content,re.I),name+' needs private-data review'
OUT.mkdir()
for name,path in files.items():shutil.copy2(path,OUT/name)
summary=json.loads((OUT/'summary.json').read_text(encoding='utf-8'))
manifest={'version':1,'title':'HTL copied-model native pilot','native_case_count':17,
 'accepted_case_count':17,'training_count':12,'holdout_count':3,'verification_count':2,
 'prediction_enabled':summary['prediction_enabled'],'exploratory':summary['exploratory'],'physical_validation':False,
 'meaning':'All 17 native cases passed declared execution and accounting gates. The frozen surrogate did not meet its prespecified independent verification error criteria; prediction/scenario artifacts are exploratory.',
 'native_archives_included':False,'raw_private_execution_files_included':False,
 'files':{name:{'sha256':hashlib.sha256((OUT/name).read_bytes()).hexdigest(),'bytes':(OUT/name).stat().st_size} for name in files}}
(OUT/'index.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'files':len(files),'bytes':sum(v['bytes'] for v in manifest['files'].values()),'exploratory':manifest['exploratory']},indent=2))
