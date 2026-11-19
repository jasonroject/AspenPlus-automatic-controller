"""Scientific accounting, failure gates and published-artifact regression checks."""
import copy
import json
from pathlib import Path
import sys
import unittest
import numpy as np
import pandas as pd
from model import carbon, predict
from native_scan import report_warnings

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from aspen_study.pipeline_to_study import read, reassemble  # published artifact is an aspen-study/2 package
OUT = HERE.parent/'outputs/htl_pipeline'

class AccountingTests(unittest.TestCase):
    def test_independent_carbon_balance(self):
        coeff={'fixed_feed_GWP':10.,'electricity_beta':.5,'wastewater_gamma':2.}
        # 10 feed + 4 electricity + 3 direct + 1 wastewater, over 2 kg product.
        self.assertEqual(float(carbon(2,8,3,500,coeff)),9.)
        self.assertEqual(float(carbon(2,8,3,500,coeff,1.1)),9.2)
        for bad in [0,-1,np.nan]:
            with self.assertRaises(ValueError): carbon(bad,8,3,500,coeff)

    def test_extrapolation_rejected_before_model_call(self):
        for t,l in [(309.9,10),(350.1,10),(330,4.9),(330,20.1),(np.nan,10)]:
            with self.assertRaises(ValueError): predict({}, {}, t,l)

    def test_lowercase_aspen_warning_and_block_names_retained(self):
        warnings=report_warnings('* Calculations were completed with warnings *\n* completed with warnings: *\n* COOLER REACTOR VALVE *')
        self.assertIn('COOLER REACTOR VALVE',warnings)

    @unittest.skipUnless((OUT/'live/raw/T325p00_L8p50.json').exists(),'Private native outputs are local only')
    def test_native_balance_failure_and_unit_mismatch(self):
        import audit
        audit.O=OUT/'live'
        path=OUT/'live/raw/T325p00_L8p50.json'
        raw=json.loads(path.read_text())
        coeff=json.loads((HERE/'reference/lca_coefficients.json').read_text())
        atoms={r.component:json.loads(r.chemical_atoms) for _,r in pd.read_csv(HERE/'reference/component_element_bases.csv').iterrows()}
        self.assertTrue(audit.extract(raw,path,coeff,atoms)['accepted'])
        changed=copy.deepcopy(raw)
        changed['streams']['S7']['MASSFLMX']['value']+=1
        self.assertFalse(audit.extract(changed,path,coeff,atoms)['accepted'])
        changed=copy.deepcopy(raw)
        changed['blocks']['HEATER']['\\QCALC']['unit']='kW'
        with self.assertRaises(AssertionError): audit.extract(changed,path,coeff,atoms)

class ArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data=reassemble(read(HERE.parent/'analysis_web/data/study'))[0]

    def test_native_holdout_and_training_coordinates_disjoint(self):
        reference=pd.read_csv(HERE/'reference/native_samples.csv')
        coords=lambda d:set(zip(d.temperature_C.round(5),d.length_m.round(5)))
        train=coords(reference[reference.split=='train'])
        self.assertFalse(train & coords(reference[reference.split=='holdout']))
        fresh={(r['temperature_C'],r['length_m']) for r in self.data['fresh_runs']}
        self.assertFalse(train & fresh)
        self.assertTrue(all(r['accepted'] for r in self.data['fresh_runs']))

    def test_grid_coverage_finiteness_and_accounting(self):
        rows=pd.DataFrame(self.data['grid']['rows'])
        self.assertEqual(len(rows),81*61)
        self.assertEqual(len(rows.drop_duplicates(['temperature_C','length_m'])),len(rows))
        self.assertTrue(np.isfinite(rows.to_numpy()).all())
        for scenario in ['STD','HR']:
            expected=carbon(rows.target_kg_h,rows[scenario+'_electricity_kWh'],rows.direct_kgCO2eq_h,rows.water_kg_h,self.data['accounting'])
            np.testing.assert_allclose(rows['CF_'+scenario],expected,rtol=1e-12)

    def test_rank_conservation_and_intervals(self):
        robustness=self.data['robustness']
        for rows in robustness['scenarios'].values():
            self.assertEqual(len(rows),266)
            self.assertEqual(sorted(r['nominal_rank'] for r in rows),list(range(1,267)))
            self.assertAlmostEqual(sum(r['top1_fraction'] for r in rows),1)
            self.assertAlmostEqual(sum(r['top5_fraction'] for r in rows),5)
            for row in rows:
                self.assertLessEqual(row['top1_fraction'],row['top5_fraction'])
                for interval in [row['rank_p05_p50_p95'],*row['intervals'].values()]:
                    self.assertEqual(interval,sorted(interval))
                self.assertGreaterEqual(row['temperature_C']-2,310)
                self.assertLessEqual(row['temperature_C']+2,350)

if __name__=='__main__': unittest.main()
