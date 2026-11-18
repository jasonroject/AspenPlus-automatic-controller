"""Audit native outputs; reconstruct the fixed-background foreground CF."""
from pathlib import Path
import numpy as np
from native_scan import COMPS

O=Path(__file__).resolve().parent
CAL=4.1868
PORTS={'PUMP':(['FEED'],['S2']),'HEATCHAG':(['S4','S2'],['S10','S9']),
       'HEATER':(['S9'],['S3']),'REACTOR':(['S3'],['S4']),'COOLER':(['S10'],['S5']),
       'VALVE':(['S5'],['S6']),'B6':(['S6'],['S7','S8'])}

def scalar(d,k): return float(d[k]['value'])
def flow(r,s,c,kind='MASSFLOW'): return scalar(r['streams'][s][kind],'\\MIXED\\'+c)
def hflow(r,s):
    d=r['streams'][s]
    # An absent outlet phase has exactly zero flow and undefined specific enthalpy.
    if scalar(d,'MASSFLMX')==0: return 0.
    assert d['MASSFLMX']['unit']=='kg/hr' and d['HMX_MASS']['unit']=='cal/gm'
    return scalar(d,'MASSFLMX')*scalar(d,'HMX_MASS')*CAL/3600

def extract(r,src,coeff,atoms):
    for stream in r['streams'].values():
        assert stream['MASSFLMX']['unit']=='kg/hr' and stream['TEMP_OUT']['unit']=='K'
        assert all(v['unit']=='kg/hr' for v in stream['MASSFLOW'].values())
        assert all(v['unit']=='kmol/hr' for v in stream['MOLEFLOW'].values())
    for block in ['HEATER','REACTOR','COOLER','B6']:
        assert r['blocks'][block]['\\QCALC']['unit']=='cal/sec'
    assert r['blocks']['PUMP']['\\WNET']['unit']=='kW'
    is_std='HEATCHAG' not in r['blocks']
    meta={'temperature_C':r['T_K']-273.15,'temperature_K':r['T_K'],'length_m':r['L'],'split':r.get('split','train'),'origin':'new_native' if src.parent.name=='raw' else 'archived_native','source_file':str(src.relative_to(O)),'completed':r['completed'],'seconds':r.get('seconds'), 'region':r.get('region','training')}
    v={**meta}
    assert abs(scalar(r['streams']['FEED'],'MASSFLMX')-100)<1e-8
    assert abs(scalar(r['streams']['S3'],'TEMP_OUT')-r['T_K'])<1e-6
    assert abs(scalar(r['streams']['S4'],'TEMP_OUT')-r['T_K'])<1e-6
    v['target_kg_h']=sum(flow(r,s,c) for s in ['S7','S8'] for c in ['CAT','O-CRE-01'])
    v['char_kg_h']=sum(flow(r,s,'C') for s in ['S7','S8'])
    v['water_kg_h']=sum(flow(r,s,'H2O') for s in ['S7','S8'])
    v['direct_kgCO2eq_h']=sum(flow(r,s,'CO2')+36*flow(r,s,'CH4') for s in ['S7','S8'])
    v['min_component_mass_kg_h']=min(flow(r,s,c) for s in r['streams'] for c in COMPS)
    v['mass_residual_kg_h']=sum(scalar(r['streams'][s],'MASSFLMX') for s in ['S7','S8'])-scalar(r['streams']['FEED'],'MASSFLMX')
    v['chem_element_max_relative_residual']=max(abs(sum(flow(r,s,c,'MOLEFLOW')*atoms[c].get(e,0) for s in ['S7','S8'] for c in COMPS)/sum(flow(r,'FEED',c,'MOLEFLOW')*atoms[c].get(e,0) for c in COMPS)-1) for e in ['C','H','O'])
    ports=PORTS.copy()
    if is_std:
        ports.pop('HEATCHAG');ports['HEATER']=(['S2'],['S3']);ports['COOLER']=(['S4'],['S5'])
    residual=[]
    for b,(ins,outs) in ports.items():
        q=scalar(r['blocks'][b],'\\QCALC')*CAL/1000 if b not in ['PUMP','HEATCHAG','VALVE'] else 0
        w=scalar(r['blocks'][b],'\\WNET') if b=='PUMP' else 0
        residual.append(sum(hflow(r,s) for s in outs)-sum(hflow(r,s) for s in ins)-q-w)
    v['max_block_energy_residual_kW']=max(abs(x) for x in residual)
    v['reactor_kW']=scalar(r['blocks']['REACTOR'],'\\QCALC')*CAL/1000
    v['STD_preheater_kW']=hflow(r,'S3')-hflow(r,'S2')
    v['HR_preheater_kW']=np.nan if is_std else scalar(r['blocks']['HEATER'],'\\QCALC')*CAL/1000
    v['pump_kW']=scalar(r['blocks']['PUMP'],'\\WNET')
    v['residence_time_h']=scalar(r['blocks']['REACTOR'],'\\RES_TIME')
    for s in ['STD','HR']:
        v[s+'_electricity_kWh']=max(0,v[s+'_preheater_kW'])+max(0,v['reactor_kW'])+coeff['pump_inventory_kWh'] if np.isfinite(v[s+'_preheater_kW']) else np.nan
        v['GWP_'+s]=coeff['fixed_feed_GWP']+coeff['electricity_beta']*v[s+'_electricity_kWh']+v['direct_kgCO2eq_h']+coeff['wastewater_gamma']*v['water_kg_h']/1000
        v['CF_'+s]=v['GWP_'+s]/v['target_kg_h'] if v['target_kg_h']>0 else np.nan
    v['accepted']=all(np.isfinite(v[k]) for k in ['target_kg_h','char_kg_h','GWP_STD','mass_residual_kg_h','chem_element_max_relative_residual','max_block_energy_residual_kW']) and v['target_kg_h']>0 and v['char_kg_h']>=0 and v['min_component_mass_kg_h']>=-1e-10 and abs(v['mass_residual_kg_h'])<=.01 and v['chem_element_max_relative_residual']<=1e-3 and v['max_block_energy_residual_kW']<=.01
    return v
