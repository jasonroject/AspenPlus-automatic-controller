"""Read-only discovery and explicitly whitelisted writes on a supplied document."""
from __future__ import annotations

import math
import time

from .profile import controls_for_point, finite


def read_node(document, path):
    result = {"path": path, "value": None, "unit": None}
    try:
        node = document.Tree.FindNode(path)
        if node is None:
            raise ValueError("Node does not exist")
        value = node.Value
        if not isinstance(value, (str, int, float, bool)) and value is not None:
            raise ValueError("Node is not scalar")
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("Node value is not finite")
        result["value"] = value
        try:
            result["unit"] = str(node.UnitString or "")
        except Exception as error:
            result["unit_error"] = str(error)
    except Exception as error:
        result["error"] = str(error)
    return result


def _children(node):
    try:
        elements = node.Elements
        count = elements.Count
    except Exception:
        return []
    return [elements.Item(index) for index in range(count)]


def inspect_document(document, max_nodes=20000, max_depth=20):
    """Enumerate structural names and candidate scalar leaves, without writing."""
    result = {"discovery_version": 1, "blocks": [], "streams": [], "nodes": [],
              "complete": True, "diagnostics": [],
              "writability": "Input leaves are candidates only; no writes were attempted"}
    visited = 0

    def walk(node, path, depth):
        nonlocal visited
        if visited >= max_nodes:
            result["complete"] = False
            return
        visited += 1
        if visited > max_nodes or depth > max_depth:
            result["complete"] = False
            return
        children = _children(node)
        if children:
            for child in children:
                if child is None:
                    continue
                if visited >= max_nodes:
                    result["complete"] = False
                    break
                walk(child, path + "\\" + str(child.Name), depth + 1)
        else:
            record = read_node(document, path)
            record["input_candidate"] = "\\Input\\" in path
            result["nodes"].append(record)

    # Capture completion metadata first so a large flowsheet cannot consume its
    # budget before this read-only global status branch is reached.
    status_path = "\\Data\\Results Summary\\Run-Status\\Output"
    try:
        status = document.Tree.FindNode(status_path)
        if status is not None:
            walk(status, status_path, 0)
        else:
            result["diagnostics"].append("Global run-status branch unavailable: " + status_path)
    except Exception as error:
        result["complete"] = False
        result["diagnostics"].append(f"{status_path}: {error}")

    for section, destination in (("Blocks", "blocks"), ("Streams", "streams")):
        root_path = "\\Data\\" + section
        root = document.Tree.FindNode(root_path)
        if root is None:
            result["complete"] = False
            result["diagnostics"].append("Missing structural root: " + root_path)
            continue
        try:
            for owner in _children(root):
                name = str(owner.Name)
                result[destination].append(name)
                for kind in ("Input", "Output"):
                    path = root_path + "\\" + name + "\\" + kind
                    node = document.Tree.FindNode(path)
                    if node is not None:
                        walk(node, path, 0)
        except Exception as error:
            result["complete"] = False
            result["diagnostics"].append(f"{root_path}: {error}")
    if visited >= max_nodes:
        result["diagnostics"].append("Discovery node budget reached; map only reviewed captured nodes or inspect a narrower model")
    result["visited_nodes"] = visited
    return result


def apply_whitelist(document, variables, parameters):
    """Preflight every path, numeric value and native unit before any write."""
    specs = {row["id"]: row for row in variables}
    if set(parameters) != set(specs):
        raise ValueError("Parameters must exactly match the reviewed whitelist")
    pending = []
    for ident, value in parameters.items():
        spec = specs[ident]
        finite(value, ident)
        if not spec["min"] <= value <= spec["max"]:
            raise ValueError(f"{ident}: outside the reviewed range")
        record = read_node(document, spec["path"])
        if record.get("error") or record["unit"] != spec["native_unit"]:
            raise ValueError(f"{ident}: input path or native unit mismatch")
        finite(record["value"], ident + " existing value")
        node = document.Tree.FindNode(spec["path"])
        if _children(node):
            raise ValueError(f"{ident}: only scalar leaves can be written")
        pending.append((ident, node, value))
    for ident, node, value in pending:
        try:
            node.Value = value
        except Exception as error:
            raise ValueError(f"{ident}: write rejected; this copied case will not run") from error
    return verify_inputs(document, variables, parameters)


def verify_inputs(document, variables, parameters):
    actual = {}
    for spec in variables:
        ident = spec["id"]
        record = read_node(document, spec["path"])
        if record.get("error") or record["unit"] != spec["native_unit"]:
            raise ValueError(f"{ident}: unit/readback mismatch")
        value = finite(record["value"], ident + " readback")
        if not math.isclose(value, parameters[ident], rel_tol=1e-8, abs_tol=1e-9):
            raise ValueError(f"{ident}: requested {parameters[ident]}, read back {value}")
        actual[ident] = record
    return actual


def capture_readouts(document, specs):
    result = {}
    for spec in specs:
        record = read_node(document, spec["path"])
        if not record.get("error"):
            try:
                finite(record["value"], spec["id"])
                if record["unit"] != spec["native_unit"]:
                    raise ValueError(f"Expected exact native unit {spec['native_unit']!r}; received {record['unit']!r}")
            except ValueError as error:
                record["error"] = str(error)
        result[spec["id"]] = record
    return result


def check_solver(document, checks):
    records = []
    for spec in checks:
        record = read_node(document, spec["path"])
        # bool must not accidentally compare equal to numeric 0/1.
        record["accepted"] = not record.get("error") and any(type(record["value"]) is type(value) and record["value"] == value or
            isinstance(record["value"], (int, float)) and not isinstance(record["value"], bool) and isinstance(value, (int, float)) and not isinstance(value, bool) and record["value"] == value
            for value in spec["accepted_values"])
        record["label"] = spec["label"]
        record["accepted_values"] = spec["accepted_values"]
        records.append(record)
    return bool(records) and all(record["accepted"] for record in records), records


def run_document(document, profile, point, poll_seconds=0.25):
    """Run one already-copied document; caller owns opening/closing and evidence."""
    result = {"control_succeeded": False, "solver_accepted": False, "readouts": {}, "input_readback": {}, "solver_checks": []}
    start = time.monotonic()
    try:
        document.Engine.Reinit()
        controls, requested = controls_for_point(profile, point["parameters"])
        result["input_readback"] = apply_whitelist(document, controls, requested)
        document.Engine.Run2(1)
        while document.Engine.IsRunning:
            if time.monotonic() - start > profile.get("limits", {}).get("timeout_seconds", 1200):
                result["timed_out"] = True
                document.Engine.Stop()
                raise TimeoutError("Aspen run exceeded the declared case timeout; stop requested")
            time.sleep(poll_seconds)
        result["input_readback_after_run"] = verify_inputs(document, controls, requested)
        result["control_succeeded"] = True
        result["solver_accepted"], result["solver_checks"] = check_solver(document, profile["solver_checks"])
        if not result["solver_accepted"]:
            result["error"] = "Native solver completion checks were not accepted"
    except Exception as error:
        result["error"] = f"{type(error).__name__}: {error}"
    finally:
        result["elapsed_seconds"] = time.monotonic() - start
        result["readouts"] = capture_readouts(document, profile["readouts"])
    return result
