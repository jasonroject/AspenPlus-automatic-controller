"""Verify the Aspen result-node paths for block types that are still marked [推断] in aspen_rules.RECIPES.

Needs Windows + Aspen Plus + pywin32 (run on Roice's PC). Nothing here edits a model: each model is copied to a
private temp dir, run, read, closed (the same adapter as `probe`).

    python -m aspen_study.verify_nodes find   "<Aspen>\\GUI\\Examples" ["<dir 2>" ...]   # which example files hold the target block types
    python -m aspen_study.verify_nodes verify "<model.bkp>" ["<model2.bkp>" ...] [--timeout 1200]   # run + read candidates + write fixtures
    python -m aspen_study.verify_nodes check  [fixtures dir]                                      # offline: same checks the tests run

`verify` writes, per model, into aspen_study/tests/fixtures/live/nodes/ (commit these files):
    <stem>.nodes.json            aspen-node-verification/1: per target block, every candidate node read (value+UnitString),
                                 the child names under ...\\Output, which node the recipe used, and the work-sign check
    <stem>.probe-summary.json    the normal aspen-probe/1.1 summary of the same run
    <stem>.graph.json            the aspen-model-graph/1 of the same run
and `aspen_study/tests/test_live_node_fixtures.py` consumes them (every test is skipped until a fixture exists).
Target types: Compr, MCompr, RStoic, RYield, RGibbs, RCSTR, Flash3 (+ turbine = a Compr whose outlet pressure is below its inlet).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path

from .adapters import aspen_rules as R
from .adapters.errors import AspenError

SCHEMA = "aspen-node-verification/1"
TARGET_TYPES = ("Compr", "MCompr", "RStoic", "RYield", "RGibbs", "RCSTR", "Flash3")
FIXTURE_DIR = Path(__file__).resolve().parent / "tests" / "fixtures" / "live" / "nodes"
OUT = r"\Data\Blocks\{b}\Output"
INP = r"\Data\Blocks\{b}\Input"

# Candidate Output nodes to try per type, beyond the recipe's own nodes. Real names are also listed in
# `output_children`, so a node missing here can still be found from the fixture.
COMMON = ["BLKSTAT", "QCALC", "QNET", "HX_DUTY", "DUTY", "NET_DUTY", "B_TEMP", "B_PRES", "POC", "PRES_OUT"]
WORK = ["WNET", "BRAKE_POWER", "ELEC_POWER", "IND_POWER", "WORK", "POWER", "TOT_POWER", "NET_WORK"]
EXTRA = {"compr": WORK + ["PRES_RATIO", "HEAD", "EFF_ISEN", "EFF_POLY", "TYPE"],
         "mcompr": WORK + ["TOT_WORK", "TOT_DUTY", "QCALC_STAGE"],
         "flash3": ["B_PRES", "QCALC", "QNET", "B_TEMP"]}
# Input nodes that say what a Compr/MCompr is configured as (read-only context for the turbine check)
INPUT_CONTEXT = {"compr": ["TYPE", "PRES", "PRATIO", "PDROP"], "mcompr": ["NSTAGE", "TYPE"]}
SKIP = {"BLKSTAT"}


def _type_key(model):
    return str(model or "").strip().lower()


def candidates_for(model):
    recipe = R.recipe_for(model) or {"energy": [], "temp": []}
    names = []
    for _, _, nodes, _ in recipe["energy"]:
        names += nodes
    names += recipe["temp"] + COMMON + EXTRA.get(_type_key(model), [])
    seen, out = set(), []
    for name in names:
        if name not in seen and name not in SKIP:
            seen.add(name)
            out.append(name)
    return out


def _read(adapter, path):
    r = adapter.read(path)
    item = {"path": path, "exists": r.error is None or r.error != "节点不存在"}
    if r.error is not None:
        item["readable"] = False
        item["error"] = r.error
        return item
    scalar = adapter.scalar(path)
    item["readable"] = True
    item["scalar"] = scalar is not None            # False: vector / collection placeholder (Value is not a real number)
    item["value"] = r.value if isinstance(r.value, (int, float, str, bool)) or r.value is None else str(r.value)
    item["unit"] = r.unit
    return item


def _pressure_of(stream):
    total = stream.get("total") or {}
    return total.get("P"), total.get("P_unit")


def work_sign_check(block, graph_streams, calorie_J):
    """Compare the sign of a Compr/MCompr work with what its pressures imply.
    Returns None for other types. Expected: outlet P > inlet P => work > 0 (compressor); outlet P < inlet P => work < 0 (turbine/expander)."""
    if _type_key(block["type"]) not in ("compr", "mcompr"):
        return None
    work = next((e for e in block["energy"] if e["kind"] == "work"), None)
    streams = {s["id"]: s for s in graph_streams}
    p_in = [_pressure_of(streams[s]) for s in block["ports"]["in"] if s in streams and streams[s]["class"] == "MATERIAL"]
    p_out = [_pressure_of(streams[s]) for s in block["ports"]["out"] if s in streams and streams[s]["class"] == "MATERIAL"]
    p_in = [p for p in p_in if p[0] is not None]
    p_out = [p for p in p_out if p[0] is not None]
    check = {"block": block["id"], "work": None if work is None else {"value": work["value"], "unit": work["unit"], "path": work["path"]}}
    if not p_in or not p_out:
        return dict(check, verdict="unknown", why="material inlet/outlet pressure not readable")
    (pi, ui), (po, uo) = p_in[0], p_out[0]
    if ui != uo:
        return dict(check, p_in={"value": pi, "unit": ui}, p_out={"value": po, "unit": uo}, verdict="unknown",
                    why="inlet and outlet pressure units differ")
    expected = "positive" if po > pi else "negative" if po < pi else "zero"
    check.update(p_in={"value": pi, "unit": ui}, p_out={"value": po, "unit": uo}, expected_sign=expected,
                 kind="compressor" if po > pi else "turbine" if po < pi else "no pressure change")
    if work is None:
        return dict(check, verdict="no_work_node", why="no work node was read for this block")
    v = work["value"]
    observed = "positive" if v > 0 else "negative" if v < 0 else "zero"
    check["observed_sign"] = observed
    check["verdict"] = "consistent" if observed == expected or "zero" in (observed, expected) else "inverted"
    return check


def verify_model(model, *, calorie_J=4.1868, timeout_s=1200, adapter_factory=None, log=print, **adapter_kw):
    """Open + run `model`, read all candidates for every block. Returns (verification, summary, graph)."""
    from .adapters.aspen_com import AspenPlusCOMAdapter
    from .probe import build_summary, energy_table
    model = Path(model)
    started = time.monotonic()
    adapter = (adapter_factory or AspenPlusCOMAdapter)(calorie_J=calorie_J, timeout_s=timeout_s, **adapter_kw)
    run_error = None
    try:
        log(f"打开 {model.name}（临时副本）…")
        adapter.open(model)
        try:
            adapter.run(timeout_s)
        except AspenError as exc:
            run_error = str(exc)
        graph = adapter.discover()
        report = adapter.run_report()
        blocks = []
        for b in graph["blocks"]:
            bid = b["id"]
            entry = {"id": bid, "type": b["type"], "target": any(b["type"].lower() == t.lower() for t in TARGET_TYPES),
                     "recipe": "verified" if (R.recipe_for(b["type"]) and all(e[3] for e in R.recipe_for(b["type"])["energy"]))
                     else ("unverified" if R.recipe_for(b["type"]) else "none"),
                     "status": (report["blocks"].get(bid) or {}).get("state", "unknown"),
                     "ports": b["ports"], "energy_read": b["energy"],
                     "output_children": adapter.children(OUT.format(b=bid)),
                     "candidates": [_read(adapter, OUT.format(b=bid) + "\\" + n) for n in candidates_for(b["type"])]}
            if "outlet_temperature" in b:
                entry["outlet_temperature"] = b["outlet_temperature"]
            ctx = [_read(adapter, INP.format(b=bid) + "\\" + n) for n in INPUT_CONTEXT.get(_type_key(b["type"]), [])]
            if ctx:
                entry["input_context"] = ctx
            sign = work_sign_check(b, graph["streams"], calorie_J)
            if sign:
                entry["work_sign"] = sign
            blocks.append(entry)
    finally:
        adapter.close()
    rows = energy_table(graph, report, calorie_J, adapter.energy_verified() if hasattr(adapter, "energy_verified") else None)
    summary = build_summary(graph, adapter, rows, report, time.monotonic() - started, calorie_J, adapter.source_unchanged)
    doc = {"schema": SCHEMA, "created": datetime.now().astimezone().isoformat(timespec="seconds"),
           "model": dict(graph["model"], source_unchanged=adapter.source_unchanged), "calorie_J": calorie_J,
           "run": {"state": report["state"], "run_completed": report["run_completed"], "run_error": run_error},
           "units": graph.get("units", {}), "blocks": blocks, "coverage": coverage([{"blocks": blocks}])}
    return doc, summary, graph


def coverage(docs):
    """Which target types (and the turbine case) the given verifications cover (blocks that read an energy node)."""
    got = {t: [] for t in TARGET_TYPES}
    turbine = []
    for doc in docs:
        for b in doc["blocks"]:
            for t in TARGET_TYPES:
                if b["type"].lower() == t.lower() and b["energy_read"]:
                    got[t].append(b["id"])
            ws = b.get("work_sign")
            if ws and ws.get("kind") == "turbine" and ws.get("work"):
                turbine.append(b["id"])
    return {"types": {t: bool(v) for t, v in got.items()}, "turbine": bool(turbine),
            "missing": [t for t, v in got.items() if not v] + ([] if turbine else ["turbine"])}


def check_verification(doc):
    """Problems (list of strings) a verification fixture shows. Empty list = every target block in it is sound.

    Rules: the run must have completed without errors; each target block must read an energy node whose unit is
    understood (to_kW); the node used must be one the recipe lists (otherwise RECIPES needs a new name); a work
    node's sign must agree with the pressure change (compressor > 0, turbine < 0).
    """
    problems = []
    if doc.get("schema") != SCHEMA:
        return [f"schema is {doc.get('schema')!r}, expected {SCHEMA}"]
    if doc["run"]["state"] == "error" or not doc["run"]["run_completed"]:
        problems.append(f"the run itself failed ({doc['run'].get('run_error') or doc['run']['state']}); fix the model first")
    if doc["model"].get("source_unchanged") is False:
        problems.append("the source model file changed during the run")
    for b in doc["blocks"]:
        if not b["target"]:
            continue
        where = f"{b['id']} ({b['type']})"
        recipe = R.recipe_for(b["type"])
        listed = {n for _, _, nodes, _ in recipe["energy"] for n in nodes} if recipe else set()
        if not b["energy_read"]:
            alt = [c["path"].rsplit("\\", 1)[-1] for c in b["candidates"] if c.get("readable") and c.get("scalar")
                   and isinstance(c.get("value"), (int, float)) and c["path"].rsplit("\\", 1)[-1] not in ("B_TEMP", "B_PRES", "POC")]
            problems.append(f"{where}: no energy node read by RECIPES; readable scalar nodes here: {alt or 'none'}; "
                            f"all Output children: {b.get('output_children')}")
        for e in b["energy_read"]:
            name = e["path"].rsplit("\\", 1)[-1]
            if name not in listed:
                problems.append(f"{where}: read {name}, which RECIPES does not list")
            if not e.get("unit"):
                problems.append(f"{where}: {name} has no UnitString")
            else:
                kw, why = R.to_kW(e["value"], e["unit"], doc["calorie_J"])
                if kw is None:
                    problems.append(f"{where}: {name} unit {e['unit']!r} is not understood by to_kW ({why})")
        ws = b.get("work_sign")
        if ws and ws.get("verdict") == "inverted":
            problems.append(f"{where}: work sign inverted: {ws['kind']} ({ws['p_in']['value']} -> {ws['p_out']['value']} "
                            f"{ws['p_in']['unit']}) but work = {ws['work']['value']} {ws['work']['unit']}")
        if ws and ws.get("verdict") in ("unknown", "no_work_node"):
            problems.append(f"{where}: work sign not checked ({ws.get('why')})")
    return problems


# ------------------------------------------------------------------------------------------------ find
BLOCK_LINE = re.compile(rb"^\s*BLOCK\s+\S+\s+([A-Za-z0-9]+)\s*$", re.M | re.I)
# 真机核对：Aspen V15 示例 .bkp 里块类型写成 `BLKTYPE = "COMPR"`，大多数文件没有 `BLOCK id TYPE` 行
BLKTYPE_ATTR = re.compile(rb'BLKTYPE\s*=\s*"([A-Za-z0-9]+)"', re.I)


def find_models(directories):
    """{type: [(size, path)]} from a text scan of .bkp files: lines like `BLOCK B1 COMPR`.
    [推断] An .bkp is expected to carry its input summary as text; a file with no hits is not proof of absence."""
    found = {t: [] for t in TARGET_TYPES}
    scanned = 0
    for directory in directories:
        for path in sorted(Path(directory).rglob("*.bkp")):
            scanned += 1
            try:
                data = path.read_bytes()
            except OSError:
                continue
            types = {m.group(1).decode("ascii", "ignore").lower() for rx in (BLOCK_LINE, BLKTYPE_ATTR) for m in rx.finditer(data)}
            for t in TARGET_TYPES:
                if t.lower() in types:
                    found[t].append((len(data), str(path)))
    for t in found:
        found[t].sort()
    return found, scanned


# ------------------------------------------------------------------------------------------------- CLI
def _stem(path):
    return re.sub(r"[^A-Za-z0-9._-]+", "_", Path(path).stem).strip("_") or "model"


def load_fixtures(directory=FIXTURE_DIR):
    return [(p, json.loads(p.read_text(encoding="utf-8"))) for p in sorted(Path(directory).glob("*.nodes.json"))]


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m aspen_study.verify_nodes", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("find", help="list example .bkp files that contain the target block types (text scan, no Aspen)")
    f.add_argument("dirs", nargs="+")
    v = sub.add_parser("verify", help="run each model and write the fixtures (needs Aspen)")
    v.add_argument("models", nargs="+")
    v.add_argument("--out-dir", default=str(FIXTURE_DIR))
    v.add_argument("--timeout", type=int, default=1200)
    v.add_argument("--calorie-J", type=float, choices=[4.184, 4.1868], default=4.1868)
    c = sub.add_parser("check", help="apply the fixture checks to the saved fixtures (no Aspen)")
    c.add_argument("dir", nargs="?", default=str(FIXTURE_DIR))
    args = parser.parse_args(argv)
    if args.cmd == "find":
        found, scanned = find_models(args.dirs)
        print(f"scanned {scanned} .bkp files")
        for t in TARGET_TYPES:
            files = found[t]
            print(f"{t}: " + (", ".join(f"{Path(p).name} ({s // 1024} KB)" for s, p in files[:5]) if files else "NONE found by text scan"))
            for _, p in files[:5]:
                print(f"    {p}")
        return 0
    if args.cmd == "verify":
        out = Path(args.out_dir)
        out.mkdir(parents=True, exist_ok=True)
        docs, status = [], 0
        for model in args.models:
            try:
                doc, summary, graph = verify_model(model, calorie_J=args.calorie_J, timeout_s=args.timeout)
            except AspenError as exc:
                print(f"{Path(model).name}: {exc}", file=sys.stderr)
                status = 3
                continue
            stem = _stem(model)
            for suffix, data in ((".nodes.json", doc), (".probe-summary.json", summary), (".graph.json", graph)):
                (out / f"{stem}{suffix}").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
            docs.append(doc)
            print(f"{Path(model).name}: run={doc['run']['state']}, wrote {out / (stem + '.nodes.json')}")
            for p in check_verification(doc):
                print("  PROBLEM:", p)
        if docs:
            cov = coverage(docs)
            print("coverage:", json.dumps(cov["types"]), "turbine:", cov["turbine"])
            if cov["missing"]:
                print("NOT covered yet:", ", ".join(cov["missing"]))
        return status
    fixtures = load_fixtures(args.dir)
    if not fixtures:
        print(f"no *.nodes.json in {args.dir} (nothing verified yet)")
        return 0
    bad = 0
    for path, doc in fixtures:
        problems = check_verification(doc)
        print(f"{path.name}: {'ok' if not problems else str(len(problems)) + ' problem(s)'}")
        for p in problems:
            print("  PROBLEM:", p)
        bad += len(problems)
    cov = coverage([d for _, d in fixtures])
    print("coverage:", json.dumps(cov["types"]), "turbine:", cov["turbine"])
    if cov["missing"]:
        print("NOT covered yet:", ", ".join(cov["missing"]))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
