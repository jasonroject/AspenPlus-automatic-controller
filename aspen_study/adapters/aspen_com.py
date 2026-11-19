"""Aspen Plus COM adapter — STUB, pending verification on a licensed Windows machine.

Nothing in this module has been executed against Aspen in this branch.
Paths are labelled:
  VERIFIED  = already used successfully elsewhere in this repository
              (process_pipeline/adapter.py, build_htl_profile.py, generated/*_control.py)
  INFERRED  = from common Aspen Plus automation practice; must be checked
              with a real document before relying on it (see TODO markers).
Opening follows aspen_connection.create_aspen_document(): a private document
on a copied archive, never the user's open Aspen session.
"""
from __future__ import annotations

from pathlib import Path
import shutil
import tempfile

from .base import Reading, RunStatus, SimulatorAdapter

# --- node recipes ---------------------------------------------------------
STATUS_BRANCH = r"\Data\Results Summary\Run-Status\Output"          # VERIFIED (adapter.py:72)
CVSTAT = STATUS_BRANCH + r"\CVSTAT"                                 # VERIFIED path; accepted codes UNKNOWN (TODO)
BLKSTAT = r"\Data\Blocks\{b}\Output\BLKSTAT"                        # VERIFIED (build_htl_profile.py:100, accepted [0, 2] there)
STREAM_TOTAL = {                                                    # VERIFIED (build_htl_profile.py:35-36, generated/*)
    "mass_flow": r"\Data\Streams\{s}\Output\MASSFLMX\MIXED",
    "h_mass": r"\Data\Streams\{s}\Output\HMX_MASS\MIXED",
    "T": r"\Data\Streams\{s}\Output\TEMP_OUT\MIXED",
    "P": r"\Data\Streams\{s}\Output\PRES_OUT\MIXED",
}
STREAM_COMPONENT_MASS = r"\Data\Streams\{s}\Output\MASSFLOW\MIXED\{c}"  # VERIFIED (build_htl_profile.py:45)
# TODO(INFERRED): substreams other than MIXED (CISOLID, NC) — branch names and enthalpy nodes per substream.
# TODO(INFERRED): vapor fraction node (e.g. Output\VFRAC\MIXED) for emission heuristics.

# Duty / power candidates per block model. First readable node wins; the
# native UnitString is always read, never assumed (generated/* assumed kW).
HEAT_CANDIDATES = {
    "default": ["QCALC", "DUTY", "UTIL_DUTY"],                      # VERIFIED (generated/heatrecovery_control.py:26-31)
    "radfrac": [("condenser", "COND_DUTY"), ("reboiler", "REB_DUTY")],  # INFERRED — TODO verify node names
    "heatx": ["HX_DUTY", "QCALC"],                                  # INFERRED — TODO verify
    "mheatx": ["QCALC"],                                            # INFERRED — TODO verify
}
WORK_CANDIDATES = ["WNET", "BRAKE_POWER", "ELEC_POWER", "ACT_POWER", "POWER", "IN_POWER", "FLUID_POWER"]  # VERIFIED list (generated/*:41-49)

# TODO(INFERRED): block model name — node attribute RecordType, e.g. node.AttributeValue(6).
# TODO(INFERRED): connectivity — \Data\Blocks\{b}\Connections\{s} (value = port) or \Data\Streams\{s}\Ports\SOURCE/DEST.
# TODO(INFERRED): stream class MATERIAL/HEAT/WORK — stream record type attribute.
# TODO(INFERRED): components — \Data\Components\Specifications\Input\TYPE\{c}, ANAME (alias); CAS via databank.
# TODO(INFERRED): utilities — \Data\Utilities\{u}\Input\UTIL_TYPE and block utility usage outputs.
# TODO(INFERRED): .apw support (InitFromFile2?) — keep requiring .bkp until verified.
# TODO: report parsing for errors/warnings — reuse process_pipeline.runner.report_messages (VERIFIED) after exporting .rep.


class AspenPlusCOMAdapter(SimulatorAdapter):
    name = "aspen-plus-com"

    def __init__(self):
        self._doc = None
        self._copy = None
        self._model = {}

    def open(self, path):
        path = Path(path)
        if path.suffix.lower() != ".bkp":
            raise ValueError("Only .bkp archives are supported until .apw opening is verified")
        import hashlib
        import pythoncom  # noqa: F401  (Windows only)
        from aspen_connection import create_aspen_document
        work = Path(tempfile.mkdtemp(prefix="aspen-discovery-"))
        self._copy = work / "input.bkp"
        shutil.copy2(path, self._copy)
        pythoncom.CoInitialize()
        self._doc = create_aspen_document()
        self._doc.SuppressDialogs = 1
        self._doc.InitFromArchive2(str(self._copy))                  # VERIFIED (runner.py:336+)
        self._doc.Visible = 0
        self._model = {"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                       "simulator": "aspen-plus", "adapter": self.name}

    def read(self, path):
        try:
            node = self._doc.Tree.FindNode(path)
            if node is None:
                return Reading(path, error="Node does not exist")
            return Reading(path, node.Value, str(node.UnitString or ""))
        except Exception as error:  # COM errors stay visible
            return Reading(path, error=str(error))

    def model_info(self):
        return dict(self._model)

    def status(self):
        raise NotImplementedError("TODO(verify on Aspen): CVSTAT accepted codes, BLKSTAT per block, .rep errors/warnings")

    def components(self):
        raise NotImplementedError("TODO(verify on Aspen): component list, aliases and CAS numbers")

    def blocks(self):
        raise NotImplementedError("TODO(verify on Aspen): block RecordType, ports, duty/power via HEAT/WORK_CANDIDATES")

    def streams(self):
        raise NotImplementedError("TODO(verify on Aspen): stream class, SOURCE/DEST ports, STREAM_TOTAL and component flows")

    def close(self):
        try:
            if self._doc is not None:
                self._doc.Close(False)
        finally:
            self._doc = None
            try:
                import pythoncom
                pythoncom.CoUninitialize()
            except ImportError:
                pass
