"""Inspect and reproduce a manuscript anchor using an isolated Aspen document."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import pythoncom
from aspen_connection import create_aspen_document
from test_datacatch import capture_all

def main():
    out = ROOT / 'outputs' / 'htl_pipeline'
    out.mkdir(parents=True, exist_ok=True)
    source = ROOT.parent / 'aspenmodel' / 'heatrecovery.bkp'
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    copy = out / 'heatrecovery.bkp'
    shutil.copy2(source, copy)
    pythoncom.CoInitialize()
    app = None
    try:
        app = create_aspen_document()
        app.InitFromArchive2(str(copy))
        app.Visible = 0
        app.SuppressDialogs = 1
        inputs = {}
        for block in ['REACTOR', 'HEATER', 'PUMP', 'HEATCHAG']:
            node = app.Tree.FindNode('\\Data\\Blocks\\' + block + r'\Input')
            for child in node.Elements:
                try:
                    if child.Value is not None:
                        inputs[block + '.' + child.Name] = {'value':child.Value, 'unit':child.UnitString}
                except Exception:
                    pass
        (out / 'input_probe.json').write_text(json.dumps(inputs, indent=2), encoding='utf-8')
        print(json.dumps({k:v for k,v in inputs.items() if any(s in k for s in ['TEMP','LENG','PRES','VALUE'])}), flush=True)
        app.Engine.Reinit()
        for block, parameter, value in [('REACTOR','REAC_TEMP',603),('HEATER','TEMP',603),('REACTOR','LENGTH',10)]:
            node=app.Tree.FindNode('\\Data\\Blocks\\'+block+'\\Input\\'+parameter)
            if node is None:
                raise RuntimeError('Missing '+block+'.'+parameter)
            node.Value=value
            print(block,parameter,node.Value,node.UnitString,flush=True)
        start=time.monotonic()
        app.Engine.Run2(1)
        while app.Engine.IsRunning:
            if time.monotonic()-start>180:
                app.Engine.Stop()
                raise TimeoutError('Aspen exceeded 180 s')
            time.sleep(.2)
        data=capture_all(app,copy)
        data['source_sha256']=before
        (out/'anchor_raw.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
        print('RUN STATUS',data['aspen_run_status'],flush=True)
        print('BLOCKS',json.dumps(data['blocks']),flush=True)
    finally:
        if app is not None: app.Close(False)
        pythoncom.CoUninitialize()
        assert hashlib.sha256(source.read_bytes()).hexdigest()==before

if __name__=='__main__': main()
