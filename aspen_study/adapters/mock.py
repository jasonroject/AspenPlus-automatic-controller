"""Mock adapter: serves a recorded/hand-written graph.json fixture.

Used for tests and for replaying a real discovery on machines without Aspen
(Linux CI, this repository's box). Optional `nodes` maps Aspen node paths to
{"value", "unit"} so path-level reads can be tested too.
"""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

from .base import Reading, RunStatus, SimulatorAdapter


class MockAdapter(SimulatorAdapter):
    name = "mock-graph-fixture"

    def __init__(self, fixture=None, nodes=None):
        self._graph = None
        self._nodes = nodes or {}
        if fixture is not None:
            self.open(fixture)

    def open(self, path):
        if isinstance(path, dict):
            data = deepcopy(path)
        else:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        self._nodes = {**data.pop("_nodes", {}), **self._nodes}
        self._graph = data

    def _g(self):
        if self._graph is None:
            raise RuntimeError("MockAdapter: no fixture opened")
        return self._graph

    def status(self):
        s = self._g()["status"]
        return RunStatus(run_completed=s["run_completed"], errors=s.get("errors", []), warnings=s.get("warnings", []),
                         cvstat=s.get("cvstat"), cvstat_accepted=s.get("cvstat_accepted"),
                         block_status=s.get("block_status", {}), block_status_accepted=s.get("block_status_accepted"))

    def model_info(self):
        return deepcopy(self._g()["model"])

    def components(self):
        return deepcopy(self._g()["components"])

    def blocks(self):
        return deepcopy(self._g()["blocks"])

    def streams(self):
        return deepcopy(self._g()["streams"])

    def read(self, path):
        node = self._nodes.get(path)
        if node is None:
            return Reading(path, error="Node does not exist in fixture")
        return Reading(path, node.get("value"), node.get("unit"))

    def discovery_info(self):
        info = deepcopy(self._g().get("discovery") or {})
        info.setdefault("mode", "fixture")
        return info
