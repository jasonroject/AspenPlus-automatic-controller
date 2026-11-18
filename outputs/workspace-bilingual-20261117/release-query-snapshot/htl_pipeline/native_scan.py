"""Copy-only Aspen samples for a continuous temperature/length surrogate."""
from pathlib import Path
import json, sys, time, shutil, hashlib, gzip, traceback
from concurrent.futures import ProcessPoolExecutor

O = Path(__file__).resolve().parent
COMPS = ['GUAIA-01','CAT','ANISOLE','PPE','PEA','STYRENE','ETHYLBEN','DPE','PHENO-01','BENZENE','O-CRE-01','CH4O','ACETI-01','CH2O','H2O','CH4','CO2','H2','C2H2','C','CO']
STREAMS = ['FEED','S2','S3','S4','S5','S6','S7','S8','S9','S10']
BLOCKS = ['PUMP','HEATCHAG','HEATER','REACTOR','COOLER','VALVE','B6']

def key(t,l):
    return f'T{t:.2f}_L{l:.2f}'.replace('.', 'p')

def report_warnings(text):
    lines = text.splitlines()
    messages = []
    for i,line in enumerate(lines):
        if any(s in line.lower() for s in ['warning','severe error','error:']):
            messages.append(line.strip(' *'))
            if 'completed with warnings:' in line.lower() and i+1<len(lines):
                messages.append(lines[i+1].strip(' *'))
    return messages

def worker(args):
    import win32com.client
    wid, jobs = args
    work = O/'work'/str(wid); work.mkdir(parents=True, exist_ok=True)
    src = O/'source_HR.bkp'; inp = work/'input.bkp'; shutil.copy2(src,inp)
    app = win32com.client.DispatchEx('Apwn.Document.41.0')
    def node(p):
        n=app.Tree.FindNode(p)
        if n is None: raise KeyError(p)
        return n
    def get(p):
        try:
            n=node(p); return {'value':n.Value,'unit':n.UnitString}
        except Exception as e: return {'value':None,'error':str(e)}
    try:
        app.SuppressDialogs=1; app.InitFromArchive2(str(inp)); app.Visible=0; app.SuppressDialogs=1
        for _ in range(40):
            n=app.Tree.FindNode(r'\Data\Blocks\REACTOR\Input\LENGTH')
            if n is not None and n.Value is not None: break
            time.sleep(1)
        node(r'\Data\Blocks\REACTOR\Input\INT_TOL').Value=1e-4
        node(r'\Data\Blocks\REACTOR\Input\MAX_NSTEP').Value=100000
        app.WriteArchive2(str(work/'configured.bkp'),0)
        for j in jobs:
            t,l=j['temperature_C'],j['length_m']; name=key(t,l)+j.get('attempt_suffix',''); out=O/'raw'/(name+'.json')
            if out.exists(): continue
            rec={**j,'T':t,'T_K':t+273.15,'L':l,'mode':'field_HR','completed':False,
                 'int_tol':1e-4,'max_nstep':100000,'source_sha256':hashlib.sha256(src.read_bytes()).hexdigest()}
            try:
                for p,v in [(r'\Data\Blocks\REACTOR\Input\LENGTH',l),(r'\Data\Blocks\REACTOR\Input\REAC_TEMP',t+273.15),(r'\Data\Blocks\HEATER\Input\TEMP',t+273.15)]: node(p).Value=float(v)
                rec['input_readback']={n:get('\\Data\\Blocks\\REACTOR\\Input\\'+n) for n in ['LENGTH','REAC_TEMP','INT_TOL','MAX_NSTEP']}
                print('START',name,j['split'],flush=True)
                app.Engine.Reinit(); start=time.monotonic(); app.Engine.Run2(1)
                while app.Engine.IsRunning:
                    if time.monotonic()-start>1200:
                        app.Engine.Stop(); rec['timeout']=True; break
                    time.sleep(.3)
                rec['seconds']=time.monotonic()-start
                rp=out.with_suffix('.rep'); app.Export(2,str(rp)); text=rp.read_text(errors='replace')
                rec['completed']=not rec.get('timeout') and any(s in text for s in ['Calculations were completed with warnings','Calculations were completed normally','All blocks were completed normally']) and 'completed with errors' not in text and 'STATUS: NOT CONVERGED' not in text
                rec['streams']={}
                for s in STREAMS:
                    root='\\Data\\Streams\\'+s+'\\Output\\'
                    rec['streams'][s]={k:get(root+k+'\\MIXED') for k in ['MASSFLMX','MOLEFLMX','HMX_MASS','TEMP_OUT','PRES_OUT','RHOMX_MASS','VFRAC']}
                    for k in ['MASSFLOW','MOLEFLOW']:
                        rec['streams'][s][k]={'\\MIXED\\'+c:get(root+k+'\\MIXED\\'+c) for c in COMPS}
                rec['blocks']={b:{'\\'+k:get('\\Data\\Blocks\\'+b+'\\Output\\'+k) for k in ['BLKSTAT','BLKMSG','QCALC','WNET','RES_TIME']} for b in BLOCKS}
                rec['warnings']=report_warnings(text)
                if not rec['completed']:
                    rec['error']='Native completion gate failed'
                    for i,f in enumerate(work.glob('*.his')):
                        with f.open('rb') as a, gzip.open(O/'raw'/f'{name}.history{i}.gz','wb') as b: shutil.copyfileobj(a,b)
            except Exception as e:
                rec['error']=repr(e); rec['traceback']=traceback.format_exc()
            out.write_text(json.dumps(rec,indent=2,default=str),encoding='utf8')
            print('DONE',name,rec['completed'],round(rec.get('seconds',0),1),rec.get('error',''),flush=True)
    finally:
        try: app.Close(False)
        except Exception: pass

if __name__=='__main__':
    phase=sys.argv[1]
    workers=int(sys.argv[2]) if len(sys.argv)>2 else 2
    jobs=[j for j in json.loads((O/'design.json').read_text()) if (phase=='pending' or j['phase']==phase) and not (O/'raw'/(key(j['temperature_C'],j['length_m'])+j.get('attempt_suffix','')+'.json')).exists()]
    if not jobs: print('No pending samples'); sys.exit()
    with ProcessPoolExecutor(max_workers=workers) as pool:
        # A fresh document per point prevents cumulative Aspen history-size limits.
        list(pool.map(worker,[(phase+'_'+key(j['temperature_C'],j['length_m'])+j.get('attempt_suffix',''),[j]) for j in jobs]))
