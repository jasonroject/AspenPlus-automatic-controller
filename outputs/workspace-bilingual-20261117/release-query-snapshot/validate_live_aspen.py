"""Opt-in integration check: python -X utf8 validate_live_aspen.py.

Uses a private COM document, leaves the archive untouched, and writes only to validation/.
"""
import hashlib
import json
from pathlib import Path

import batch_runner
import test_datacatch
from parameter_catalog import build_cases


def main():
    root = Path(__file__).resolve().parent / "validation"
    batch_runner.OUTPUT_ROOT = test_datacatch.OUTPUT_ROOT = root / "live"
    model = root.parent.parent / "aspenmodel" / "heatrecovery.bkp"
    before = hashlib.sha256(model.read_bytes()).hexdigest()
    catalog = json.loads((root / "heatrecovery_catalog.json").read_text(encoding="utf-8"))
    rules = {"Blocks.REACTOR.REAC_TEMP": [603, 608], "Blocks.HEATER.TEMP": [603, 608],
             "Blocks.PUMP.PRES": [25, 24], "Blocks.HEATCHAG.VALUE": [15, 16],
             "Streams.FEED.TEMP/MIXED": [298.15, 300.15]}
    capture = test_datacatch.capture_all
    probes = []

    def capture_probe(aspen, path):
        captured = capture(aspen, path)
        record = {}
        def read(node, attr):
            try:
                return getattr(node, attr)
            except Exception:
                return None
        for node_path in [r"\Data\Results Summary\Run-Status\Output",
                          r"\Data\Blocks\HEATER\Output\QCALC",
                          r"\Data\Streams\FEED\Output\PRES_OUT\MIXED",
                          r"\Data\Streams\FEED\Output\MASSFLMX\MIXED"]:
            node = aspen.Tree.FindNode(node_path)
            if node is None:
                continue
            children = []
            try:
                elements = node.Elements
                for i in range(elements.Count):
                    child = elements.Item(i)
                    if child is not None:
                        children.append([child.Name, read(child, "Value")])
            except Exception:
                pass  # Scalar Aspen nodes may reject the Elements property.
            record[node_path] = dict(value=read(node, "Value"), unit=read(node, "UnitString"), children=children)
        probes.append(record)
        return captured

    test_datacatch.capture_all = capture_probe
    try:
        runner = batch_runner.BatchRunner(model, {}, [], catalog)
        results = runner.run_batch(build_cases(rules), ["multi_device_603", "multi_device_608"])
        runner.save_batch_summary()
    finally:
        test_datacatch.capture_all = capture
    after = hashlib.sha256(model.read_bytes()).hexdigest()
    (root / "live_verification.json").write_text(json.dumps(dict(
        model_unchanged=before == after, sha256=after, results=results, probes=probes),
        ensure_ascii=False, indent=2), encoding="utf-8")
    assert before == after, "Original archive changed"
    assert all(r["status"] == "success" for r in results), "Integration check failed"
    for result, temperature, pressure in zip(results, (25, 27), (25, 24)):
        assert len(result["applied_parameters"]) == 5
        assert result["streams"]["FEED"]["temperature_C"] == temperature
        assert result["streams"]["FEED"]["mass_flow_kg_h"] == 100
        assert result["streams"]["S2"]["pressure_MPa"] == pressure
        assert result["blocks"]["HEATER"]["heat_kW"] > 4
    print("PASS: two cases, five simultaneous inputs, original archive unchanged")


if __name__ == "__main__":
    main()
