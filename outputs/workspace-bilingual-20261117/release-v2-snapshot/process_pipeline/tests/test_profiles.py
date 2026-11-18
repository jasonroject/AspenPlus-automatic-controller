from copy import deepcopy
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

from process_pipeline.adapter import apply_whitelist, check_solver, inspect_document, run_document
from process_pipeline.normalize import normalize_capture
from process_pipeline.profile import canonical_hash, controls_for_point, digest, validate_plan, validate_profile
from process_pipeline.runner import bound_profile, contained, draft_profile, inspect_model, native_case, replay


def fixture(model):
    variables = [{"id": "temperature", "path": r"\Data\Blocks\H\Input\TEMP", "native_unit": "K", "min": 280, "max": 400}]
    values = {"mass": (10, "kg/h"), "target": (2, "kg/h"), "heat": (10, "kW"), "hout": (10, "kW")}
    readouts = [{"id": key, "path": rf"\Data\Blocks\H\Output\{key}", "native_unit": unit} for key, (_, unit) in values.items()]
    zero = {"constant": 0, "unit": "kW", "source": "Synthetic reference enthalpy / no shaft work"}
    q = lambda name: {"readout": name}
    profile = {"profile_version": 1, "id": "synthetic-heater", "name": "Synthetic heater contract check",
        "model": {"path": str(model), "sha256": digest(model)}, "variables": variables, "readouts": readouts,
        "solver_checks": [{"path": r"\Data\Results Summary\Run-Status\Output\CVSTAT", "accepted_values": [0], "label": "Fixture completion code"}],
        "mapping": {"meta": {"name": "Synthetic heater", "steady_state": True, "boundary": "Synthetic electricity only",
            "functional_unit": "1 kg synthetic target", "allocation_method": "No allocation", "enthalpy_basis": "Synthetic common enthalpy reference",
            "calorie_J": None, "inventory_complete": True, "comparable_cases": True},
            "product": {"quantity": q("target"), "feed": q("mass"), "allocation": 1, "source": "Synthetic product / feed"},
            "streams": [{"id": "FEED", "from": "BOUNDARY", "to": "H", "mass": q("mass"), "enthalpy": zero},
                        {"id": "OUT", "from": "H", "to": "BOUNDARY", "mass": q("mass"), "enthalpy": q("hout")}],
            "blocks": [{"id": "H", "heat": q("heat"), "power": zero, "source": "Synthetic duty"}],
            "inventory": [{"id": "grid", "name": "Synthetic grid", "kind": "energy", "quantity": q("heat"), "factor_id": "grid", "source": "Synthetic unity heater efficiency"}],
            "factors": [{"id": "grid", "category": "Synthetic climate", "value": .5, "denominator_unit": "kWh", "impact_unit": "kg CO2-eq", "method": "Synthetic check", "source": "Synthetic, not a real LCA factor"}]},
        "limits": {"max_cases": 100, "timeout_seconds": 1}}
    point = {"id": "case-a", "parameters": {"temperature": 325}, "split": "training"}
    plan = {"plan_version": 1, "profile_id": profile["id"], "model_sha256": profile["model"]["sha256"], "points": [point]}
    raw = {"capture_version": 1, "profile_id": profile["id"], "model_sha256": profile["model"]["sha256"],
           "case_id": point["id"], "split": point["split"], "parameters": deepcopy(point["parameters"]),
           "evidence_type": "offline_fixture", "control_succeeded": True, "solver_accepted": True, "warnings": [],
           "readouts": {row["id"]: {"path": row["path"], "value": values[row["id"]][0], "unit": row["native_unit"]} for row in readouts},
           "input_readback_after_run": {"temperature": {"path": variables[0]["path"], "value": 325, "unit": "K"}}}
    return profile, plan, raw


class Elements:
    def __init__(self, nodes=()): self.nodes = list(nodes); self.Count = len(self.nodes)
    def Item(self, index): return self.nodes[index]


class Node:
    def __init__(self, name, value=None, unit="", children=()):
        self.Name = name; self.Value = value; self.UnitString = unit; self.Elements = Elements(children)


class Engine:
    def __init__(self): self.IsRunning = False; self.run_count = 0; self.stopped = False
    def Reinit(self): pass
    def Run2(self, asynchronous): self.run_count += 1
    def Stop(self): self.stopped = True; self.IsRunning = False


class FakeDocument:
    def __init__(self, profile, raw):
        self.Tree = self; self.Engine = Engine(); self.loaded_path = None; self.closed = None
        self.nodes = {record["path"]: Node(key, record["value"], record["unit"]) for key, record in raw["readouts"].items()}
        for variable in profile["variables"]:
            self.nodes[variable["path"]] = Node(variable["id"], 300, variable["native_unit"])
        for check in profile["solver_checks"]:
            self.nodes[check["path"]] = Node("status", 0)
        self.nodes[r"\Data\Blocks"] = Node("Blocks", children=[Node("H")])
        self.nodes[r"\Data\Streams"] = Node("Streams", children=[])
        self.nodes[r"\Data\Blocks\H\Input"] = Node("Input", children=[Node("TEMP", 300, "K")])
    def FindNode(self, path): return self.nodes.get(path)
    def InitFromArchive2(self, path): self.loaded_path = path
    def Close(self, save): self.closed = save
    def Export(self, kind, path): Path(path).write_text("Calculations were completed normally", encoding="utf-8")


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.model = self.root / "fixture.bkp"; self.model.write_bytes(b"Synthetic offline fixture; never load into real Aspen")
        self.profile, self.plan, self.raw = fixture(self.model)
    def tearDown(self): self.temp.cleanup()

    def test_hash_binding_and_portable_path_override(self):
        portable = deepcopy(self.profile); portable["model"]["path"] = "fixture.bkp"
        validate_profile(portable)
        with self.assertRaisesRegex(ValueError, "absolute"):
            bound_profile(portable)
        self.assertEqual(bound_profile(portable, self.model)["model"]["path"], str(self.model))
        self.model.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "hash"):
            bound_profile(portable, self.model)

    def test_no_arbitrary_output_write_or_expression(self):
        changed = deepcopy(self.profile); changed["variables"][0]["path"] = r"\Data\Blocks\H\Output\TEMP"
        with self.assertRaisesRegex(ValueError, "Input"):
            validate_profile(changed)
        changed = deepcopy(self.profile); changed["mapping"]["product"]["quantity"] = {"readout": "target", "expression": "danger()"}
        with self.assertRaisesRegex(ValueError, "expressions"):
            validate_profile(changed)

    def test_plan_freezes_splits_and_rejects_nonfinite_outside_range_unknown_inputs(self):
        validate_plan(self.plan, self.profile)
        for parameters in ({"temperature": 401}, {"temperature": float("nan")}, {"temperature": True}, {"other": 325}):
            bad = deepcopy(self.plan); bad["points"][0]["parameters"] = parameters
            with self.assertRaises(ValueError): validate_plan(bad, self.profile)
        bad = deepcopy(self.plan); bad["points"][0]["split"] = "auto"
        with self.assertRaisesRegex(ValueError, "split"): validate_plan(bad, self.profile)
        bad = deepcopy(self.plan); bad["points"] *= 101
        with self.assertRaisesRegex(ValueError, "count"): validate_plan(bad, self.profile)

    def test_unknown_metadata_and_draft_are_blocked(self):
        for edit in (lambda p:p["mapping"]["meta"].update(enthalpy_basis=""), lambda p:p.update(solver_checks=[]),
                     lambda p:p.update(review={"state":"incomplete_draft"}), lambda p:p["mapping"].update(streams=[])):
            bad=deepcopy(self.profile);edit(bad)
            with self.assertRaises(ValueError):validate_profile(bad)

    def test_linked_fixed_controls_are_explicit_preflighted_and_read_back(self):
        profile = deepcopy(self.profile)
        profile['linked_inputs'] = [{'id':'linked-temperature','source_id':'temperature','path':r'\Data\Blocks\H2\Input\TEMP','native_unit':'K'}]
        profile['fixed_inputs'] = [{'id':'tolerance','path':r'\Data\Blocks\H\Input\TOL','native_unit':'','value':.0001}]
        validate_profile(profile)
        document = FakeDocument(profile,self.raw)
        document.nodes[profile['linked_inputs'][0]['path']] = Node('TEMP',300,'K')
        document.nodes[profile['fixed_inputs'][0]['path']] = Node('TOL',.01,'bad-unit')
        specs, parameters = controls_for_point(profile,self.plan['points'][0]['parameters'])
        with self.assertRaisesRegex(ValueError,'unit'):apply_whitelist(document,specs,parameters)
        self.assertEqual(document.nodes[profile['variables'][0]['path']].Value,300)
        document.nodes[profile['fixed_inputs'][0]['path']].UnitString=''
        captured=run_document(document,profile,self.plan['points'][0])
        self.assertTrue(captured['control_succeeded'])
        self.assertEqual(captured['input_readback_after_run']['linked-temperature']['value'],325)
        self.assertEqual(captured['input_readback_after_run']['tolerance']['value'],.0001)
        for edit in (lambda p:p['linked_inputs'][0].update(native_unit='degC'),
                     lambda p:p['fixed_inputs'][0].update(value=True),
                     lambda p:p['fixed_inputs'][0].update(path=p['variables'][0]['path']),
                     lambda p:p['linked_inputs'][0].update(scale=1)):
            bad=deepcopy(profile);edit(bad)
            with self.assertRaises(ValueError):validate_profile(bad)

    def test_native_report_missing_completion_blocks_solver_acceptance(self):
        document=FakeDocument(self.profile,self.raw)
        document.Export=lambda kind,path:Path(path).write_text('Run summary without accepted completion evidence')
        com=types.SimpleNamespace(CoInitialize=lambda:None,CoUninitialize=lambda:None)
        with patch.dict('sys.modules',{'pythoncom':com}),patch('aspen_connection.create_aspen_document',return_value=document):
            captured=native_case(self.profile,self.plan['points'][0],self.root/'unknown-status')
        self.assertTrue(captured['control_succeeded'])
        self.assertFalse(captured['solver_accepted'])
        self.assertFalse(captured['report_completion_accepted'])

    def test_global_status_discovery_is_read_first_within_budget(self):
        document=FakeDocument(self.profile,self.raw)
        parent=r'\Data\Results Summary\Run-Status\Output'
        document.nodes[parent]=Node('Output',children=[Node('CVSTAT',0)])
        discovery=inspect_document(document,max_nodes=2)
        self.assertEqual(discovery['nodes'][0]['path'],parent+r'\CVSTAT')
        self.assertLessEqual(discovery['visited_nodes'],2)
        self.assertEqual(document.Engine.run_count,0)

    def test_preflight_unit_failure_writes_nothing(self):
        document = FakeDocument(self.profile, self.raw)
        other = {"id":"pressure","path":r"\Data\Blocks\H\Input\PRES","native_unit":"MPa","min":1,"max":30}
        document.nodes[other["path"]]=Node("PRES",20,"bar")
        with self.assertRaisesRegex(ValueError,"unit"):
            apply_whitelist(document,self.profile["variables"]+[other],{"temperature":325,"pressure":25})
        self.assertEqual(document.FindNode(self.profile["variables"][0]["path"]).Value,300)
        self.assertEqual(document.Engine.run_count,0)

    def test_solver_boolean_does_not_equal_zero_and_unknown_status_is_not_success(self):
        document=FakeDocument(self.profile,self.raw)
        path=self.profile["solver_checks"][0]["path"]
        for bad in (False,None,1):
            document.nodes[path].Value=bad
            accepted,_=check_solver(document,self.profile["solver_checks"])
            self.assertFalse(accepted)

    def test_timeout_requests_stop_and_retains_capture(self):
        document=FakeDocument(self.profile,self.raw);document.Engine.IsRunning=True
        with patch('process_pipeline.adapter.time.monotonic',side_effect=[0,2,3]):
            raw=run_document(document,self.profile,self.plan['points'][0],poll_seconds=0)
        self.assertTrue(document.Engine.stopped)
        self.assertFalse(raw['control_succeeded'])
        self.assertEqual(len(raw['readouts']),4)
        self.assertIn('timeout',raw['error'])

    def test_normalization_keeps_units_and_missing_information(self):
        result=normalize_capture(self.profile,self.raw)
        self.assertEqual(result['blocks'][0]['heat_unit'],'kW')
        broken=deepcopy(self.raw);broken['readouts']['heat']['value']=None
        with self.assertRaisesRegex(ValueError,'finite'):normalize_capture(self.profile,broken)
        broken=deepcopy(self.raw);broken['readouts']['heat']['unit']='MW'
        with self.assertRaisesRegex(ValueError,'unit mismatch'):normalize_capture(self.profile,broken)

    def test_fake_native_case_loads_only_copy_and_source_is_unchanged(self):
        document=FakeDocument(self.profile,self.raw)
        com=types.SimpleNamespace(CoInitialize=lambda:None,CoUninitialize=lambda:None)
        before=digest(self.model)
        with patch.dict('sys.modules',{'pythoncom':com}),patch('aspen_connection.create_aspen_document',return_value=document):
            raw=native_case(self.profile,self.plan['points'][0],self.root/'owned-run')
        self.assertTrue(raw['source_unchanged'])
        self.assertEqual(digest(self.model),before)
        self.assertNotEqual(Path(document.loaded_path),self.model)
        self.assertEqual(Path(document.loaded_path).parent,self.root/'owned-run')
        self.assertIs(document.closed,False)
        self.assertTrue(raw['solver_accepted'])

    def test_discovery_never_runs_and_draft_does_not_invent_mapping(self):
        document=FakeDocument(self.profile,self.raw)
        discovery=inspect_document(document)
        self.assertEqual(document.Engine.run_count,0)
        draft=draft_profile(self.model,digest(self.model),discovery)
        self.assertEqual(draft['mapping']['inventory'],[])
        self.assertEqual(draft['variables'],[])
        with self.assertRaisesRegex(ValueError,'draft'):validate_profile(draft)

    def test_replay_uses_real_core_and_retains_failed_and_missing_planned_cases(self):
        plan=deepcopy(self.plan)
        plan['points'] += [{'id':'case-b','parameters':{'temperature':330},'split':'holdout'},
                           {'id':'case-c','parameters':{'temperature':335},'split':'verification'}]
        failed=deepcopy(self.raw);failed.update(case_id='case-b',split='holdout',parameters={'temperature':330},solver_accepted=False,error='Synthetic nonconvergence')
        output=self.root/'replay'
        ledger=replay(self.profile,plan,[self.raw,failed],output)
        self.assertEqual((ledger['planned_count'],ledger['accepted_count'],ledger['failed_count']),(3,1,2))
        self.assertTrue(ledger['all_planned_cases_retained'])
        self.assertEqual(ledger['cases'][0]['metrics']['purchased_energy_kWh_kg'],5)
        self.assertEqual(ledger['cases'][0]['metrics']['impacts']['Synthetic climate']['value'],2.5)
        combined=json.loads((output/'project.json').read_text())
        self.assertEqual(combined['meta']['scan_audit']['failed'],2)
        self.assertEqual(combined['meta']['omitted_failed_case_ids'],['case-b','case-c'])
        dataset=json.loads((output/'dataset.json').read_text())
        sha=dataset.pop('dataset_sha256')
        self.assertEqual(sha,canonical_hash(dataset))
        self.assertEqual(len(dataset['rows']),3)
        self.assertFalse(dataset['rows'][2]['accepted'])
        self.assertEqual(dataset['evidence_type'],'offline_fixture')
        with self.assertRaisesRegex(ValueError,'empty'):replay(self.profile,plan,[self.raw,failed],output)

    def test_workspace_paths_cannot_escape(self):
        with self.assertRaisesRegex(ValueError,'escaped'):contained(self.root/'job',self.root/'outside.json')


if __name__=='__main__':unittest.main()
