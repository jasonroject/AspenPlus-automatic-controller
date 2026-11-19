"""Simulator-neutral adapter interface.

An adapter opens a private copy of a model, reports run status and the
flowsheet structure, and reads scalar nodes with their native unit strings.
`discover()` assembles an aspen-model-graph/1 document from those primitives,
so every simulator (Aspen Plus COM, replayed captures, later HYSYS/DWSIM)
feeds the same classifier, validation and universal-core pipeline.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path

from ..schema_check import validate


@dataclass
class Reading:
    path: str
    value: object = None
    unit: str | None = None
    error: str | None = None


@dataclass
class RunStatus:
    run_completed: bool
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    cvstat: object = None
    cvstat_accepted: list | None = None
    block_status: dict = field(default_factory=dict)
    block_status_accepted: list | None = None


class SimulatorAdapter(ABC):
    name = "abstract"

    @abstractmethod
    def open(self, path: Path) -> None: ...

    @abstractmethod
    def status(self) -> RunStatus: ...

    @abstractmethod
    def model_info(self) -> dict: ...

    @abstractmethod
    def components(self) -> list: ...

    @abstractmethod
    def blocks(self) -> list:
        """[{id, type, ports:{in,out}, energy:[...], ...}] with native units."""

    @abstractmethod
    def streams(self) -> list:
        """[{id, class, from, to, total:{...}, substreams:{...}}] with native units."""

    @abstractmethod
    def read(self, path: str) -> Reading: ...

    def run(self, timeout_s: int = 1200) -> None:
        raise NotImplementedError(f"{self.name} cannot run simulations")

    def close(self) -> None:
        pass

    def discovery_info(self) -> dict:
        return {}

    def discover(self) -> dict:
        st = self.status()
        status = {"run_completed": st.run_completed, "errors": list(st.errors), "warnings": list(st.warnings)}
        if st.cvstat is not None:
            status["cvstat"] = st.cvstat
        if st.cvstat_accepted is not None:
            status["cvstat_accepted"] = st.cvstat_accepted
        if st.block_status:
            status["block_status"] = st.block_status
        if st.block_status_accepted is not None:
            status["block_status_accepted"] = st.block_status_accepted
        graph = {"schema": "aspen-model-graph/1", "model": self.model_info(), "status": status,
                 "components": self.components(), "blocks": self.blocks(), "streams": self.streams()}
        info = self.discovery_info()
        if info:
            graph["discovery"] = info
        validate(graph, "graph")
        return graph
