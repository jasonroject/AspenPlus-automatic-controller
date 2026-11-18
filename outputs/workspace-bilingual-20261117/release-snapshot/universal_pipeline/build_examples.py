"""Create hand-checkable examples and a provenance-bound native HTL adapter fixture."""
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
WEB=ROOT/'analysis_web/data'

def save(name,value):
    (WEB/name).write_text(json.dumps(value,indent=2,ensure_ascii=False),encoding='utf-8')

def meta(name,boundary):
    return {'name':name,'steady_state':True,'enthalpy_basis':'Complete material-stream enthalpy rates on one common reference; Q and W positive inward; no KE/PE or accumulation',
            'boundary':boundary,'functional_unit':'1 kg declared target product','allocation_method':'Single target; no co-product allocation; share 1',
            'calorie_J':4.1868,'inventory_complete':True,'comparable_cases':True}

def generic():
    p={'schema_version':1,'meta':meta('Synthetic two-case arithmetic example','Illustrative feed supply + electricity; not a real environmental inventory'),
       'streams':[],'blocks':[],'cases':[],'inventory':[],'factors':[]}
    source='Synthetic engineering check; not Aspen measurements or database factors'
    for id,power,product,product_low in [('A',10,2,1.8),('B',8,2.1,2.)]:
        p['cases'].append(dict(id=id,product_rate=product,product_low=product_low,product_high=2.2,feed_rate=10,mass_unit='kg/h',allocation=1,source=source))
        p['blocks'].append(dict(case_id=id,id='HEATER',heat=power,power=0,energy_unit='kW',source=source))
        p['streams'] += [dict(case_id=id,id='FEED',**{'from':'BOUNDARY','to':'HEATER'},mass_flow=10,mass_unit='kg/h',enthalpy_flow=0,energy_unit='kW',source=source),
                         dict(case_id=id,id='OUT',**{'from':'HEATER','to':'BOUNDARY'},mass_flow=10,mass_unit='kg/h',enthalpy_flow=power,energy_unit='kW',source=source)]
        p['inventory'] += [dict(case_id=id,id='electricity',name='Purchased electricity',kind='energy',amount=power,amount_low=power-1,amount_high=power+1,unit='kWh/h',factor_id='grid',source=source),
                           dict(case_id=id,id='feed',name='External feed',kind='material',amount=10,unit='kg/h',factor_id='feed',source=source)]
    for category,impact,grid,feed in [('Illustrative climate','kg CO2-eq',.5,.1),('Illustrative acidification','mol H+-eq',.02,.003)]:
        p['factors'] += [dict(id='grid',category=category,value=grid,low=grid*.8,high=grid*1.2,denominator_unit='kWh',impact_unit=impact,method='Synthetic arithmetic v1',source=source),
                         dict(id='feed',category=category,value=feed,denominator_unit='kg',impact_unit=impact,method='Synthetic arithmetic v1',source=source)]
    save('universal-example.json',p)

def htl():
    raw_path=ROOT/'outputs/htl_pipeline/live/raw/T325p00_L8p50.json'
    if not raw_path.exists():
        print('Native fixture unchanged: private raw report is unavailable');return
    r=json.loads(raw_path.read_text(encoding='utf-8'))
    coeff=json.loads((ROOT/'htl_pipeline/reference/lca_coefficients.json').read_text())
    p={'schema_version':1,'meta':meta('HTL native verification: 325 C / 8.5 m','Inherited HTL fixed-background accounting: feed, heater/reactor electricity, fixed pump inventory, direct CO2/CH4 and wastewater; excludes separator heat duty and cooling-service burdens; not a full-plant utility inventory'),
       'streams':[],'blocks':[],'cases':[],'inventory':[],'factors':[]}
    p['meta']['comparable_cases']=False
    p['meta']['source_sha256']=r['source_sha256']
    p['meta']['native_warnings']='COOLER, REACTOR, VALVE; numerically audited; not physical validation'
    source='Fresh native run T325p00_L8p50, 2026-11-17; INT_TOL 1e-4; source hash '+r['source_sha256']
    ports={'PUMP':(['FEED'],['S2']),'HEATCHAG':(['S4','S2'],['S10','S9']),'HEATER':(['S9'],['S3']),
           'REACTOR':(['S3'],['S4']),'COOLER':(['S10'],['S5']),'VALVE':(['S5'],['S6']),'B6':(['S6'],['S7','S8'])}
    number=lambda d,k:float(d[k]['value'])
    flow=lambda s,c:number(r['streams'][s]['MASSFLOW'],'\\MIXED\\'+c)
    target=sum(flow(s,c) for s in ['S7','S8'] for c in ['CAT','O-CRE-01'])
    p['cases']=[dict(id='HTL-325-8.5',product_rate=target,feed_rate=100,mass_unit='kg/h',allocation=1,source=source)]
    case='HTL-325-8.5'
    for id,s in r['streams'].items():
        mass=number(s,'MASSFLMX');h=mass*number(s,'HMX_MASS')*4.1868/3600 if mass else 0
        origin=next((b for b,(_,outs) in ports.items() if id in outs),'BOUNDARY')
        destination=next((b for b,(ins,_) in ports.items() if id in ins),'BOUNDARY')
        p['streams'].append(dict(case_id=case,id=id,**{'from':origin,'to':destination},mass_flow=mass,mass_unit='kg/h',enthalpy_flow=h,energy_unit='kW',source=source))
    for id,b in r['blocks'].items():
        q=0 if id in ['PUMP','HEATCHAG','VALVE'] else number(b,'\\QCALC')*4.1868/1000
        w=number(b,'\\WNET') if id=='PUMP' else 0
        p['blocks'].append(dict(case_id=case,id=id,heat=q,power=w,energy_unit='kW',source=source+'; zero-duty conventions from audited process ports'))
    energy=sum(max(0,b['heat']) for b in p['blocks'] if b['id'] in ['HEATER','REACTOR'])+coeff['pump_inventory_kWh']
    ref='Inherited HTL lca_coefficients.json; fixed original providers; not a fresh openLCA calculation'
    inventory=[('feed','material',100,'kg/h',coeff['fixed_feed_GWP']/100),('electricity','energy',energy,'kWh/h',coeff['electricity_beta']),
               ('CO2','emission',sum(flow(s,'CO2') for s in ['S7','S8']),'kg/h',1.),('CH4','emission',sum(flow(s,'CH4') for s in ['S7','S8']),'kg/h',36.),
               ('wastewater','waste',sum(flow(s,'H2O') for s in ['S7','S8']),'kg/h',coeff['wastewater_gamma']/1000)]
    for id,kind,amount,unit,value in inventory:
        p['inventory'].append(dict(case_id=case,id=id,name=id,kind=kind,amount=amount,unit=unit,factor_id=id,source=source+'; pump inventory fixed at 2.172 kWh/h' if id=='electricity' else source))
        p['factors'].append(dict(id=id,category='Climate change',value=value,low=value*.9 if id=='electricity' else value,high=value*1.1 if id=='electricity' else value,
                                 denominator_unit='kWh' if id=='electricity' else 'kg',impact_unit='kg CO2-eq',method='Inherited HTL fixed-background climate accounting',source=ref+('; +/-10% electricity factor is an illustrative fuzzy support' if id=='electricity' else '')))
    save('universal-htl.json',p)

if __name__=='__main__':generic();htl()
