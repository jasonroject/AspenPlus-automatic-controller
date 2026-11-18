"""Read existing Aspen exports and normalize known export units to SI.

This module does not import Aspen COM. Export totals and substreams remain
separate, and historical exports without both format markers remain unverified.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from result_units import convert_quantity


FIELDS = {
    "temperature_C": ("temperature_k", "C", 1, 273.15, ("TEMP_OUT",)),
    "pressure_MPa": ("pressure_pa", "MPa", 1e6, 0, ("PRES_OUT",)),
    "mass_flow_kg_h": ("mass_flow_kg_s", "kg/h", 1 / 3600, 0, ("MASSFLMX",)),
    "mole_flow_kmol_h": ("molar_flow_mol_s", "kmol/h", 1000 / 3600, 0, ("MOLEFLMX",)),
    "composition_kg_h": ("component_mass_flow_kg_s", "kg/h", 1 / 3600, 0, ("MASSFLOW",)),
    "composition_kmol_h": ("component_molar_flow_mol_s", "kmol/h", 1000 / 3600, 0, ("MOLEFLOW",)),
    "mass_fraction": ("mass_fraction", "fraction", 1, 0, ("MASSFRAC",)),
    "mole_fraction": ("mole_fraction", "fraction", 1, 0, ("MOLEFRAC",)),
    "heat_kW": ("heat_duty_w", "kW", 1000, 0, ("QCALC", "DUTY", "UTIL_DUTY")),
    "power_kW": ("power_w", "kW", 1000, 0,
                 ("ACT_POWER", "BRAKE_POWER", "POWER", "ELEC_POWER", "IN_POWER", "WNET", "FLUID_POWER")),
}
COMPONENT_FIELDS = ("composition_kg_h", "composition_kmol_h", "mass_fraction", "mole_fraction")
STREAM_FIELDS = ("temperature_C", "pressure_MPa", "mass_flow_kg_h", "mole_flow_kmol_h",
                 *COMPONENT_FIELDS)
SUBSTREAM_FIELDS = ("mass_flow_kg_h", "mole_flow_kmol_h", *COMPONENT_FIELDS)


def clean_json(value):
    """Keep raw provenance JSON-compatible, including legacy nonfinite values."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: clean_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [clean_json(item) for item in value]
    return value


def adapt_export(data, source_name="memory", source_sha256=None):
    diagnostics = []
    trusted_format = (data.get("unit_conversion") == "node-unit-aware-v1"
                      and data.get("component_export") == "all-stream-components-v1")
    if not trusted_format:
        diagnostics.append({"code": "unverified_export_format", "path": source_name,
                            "message": "SI values are null until historical units and component coverage are verified."})

    def convert(value, unit, target, factor, offset, location):
        if value is None or not trusted_format:
            return None
        try:
            if isinstance(value, bool) or not math.isfinite(float(value)):
                raise ValueError("nonfinite or boolean quantity")
            number = convert_quantity(value, unit, target) * factor + offset
            if not math.isfinite(number):
                raise ValueError("nonfinite converted quantity")
            return number
        except (ValueError, TypeError, OverflowError) as exc:
            diagnostics.append({"code": "invalid_quantity", "path": location, "message": str(exc)})
            return None

    def record(raw, fields, location, source_quantities, substream=None):
        result = {}
        for field in fields:
            destination, unit, factor, offset, tokens = FIELDS[field]
            invalid_components = set()
            invalid_scalar = False
            for path, quantity in source_quantities.items():
                parts = path.split("\\")
                matching = next((token for token in tokens if token in parts), None)
                if matching is None:
                    continue
                tail = parts[parts.index(matching) + 1:]
                if substream is not None and (not tail or tail[0] != substream):
                    continue
                if quantity.get("value") is None:
                    continue
                checked = convert(quantity.get("value"), quantity.get("unit"), unit, factor, offset, path)
                if checked is None:
                    if field in COMPONENT_FIELDS and len(tail) >= 2:
                        invalid_components.add(tail[-1])
                    else:
                        invalid_scalar = True
            if field in COMPONENT_FIELDS:
                values = raw.get(field, {})
                ids = list(dict.fromkeys(raw.get("component_ids", []) + list(values)))
                result[destination] = {
                    component: None if component in invalid_components else
                    convert(values.get(component), unit, unit, factor, offset, f"{location}/{field}/{component}")
                    for component in ids
                }
            else:
                result[destination] = None if invalid_scalar else convert(
                    raw.get(field), unit, unit, factor, offset, f"{location}/{field}")
        return result

    streams = {}
    for name, raw in data.get("streams", {}).items():
        source_quantities = raw.get("source_quantities", {})
        total = record(raw, STREAM_FIELDS, f"streams/{name}/total", source_quantities)
        substreams = {
            key: {**record(sub, SUBSTREAM_FIELDS, f"streams/{name}/substreams/{key}", source_quantities, key),
                  "component_ids": sub.get("component_ids", [])}
            for key, sub in raw.get("substreams", {}).items()
        }
        streams[name] = {
            "total": total, "substreams": substreams,
            "component_ids": list(dict.fromkeys(raw.get("component_ids", []) + [
                component for field in COMPONENT_FIELDS for component in raw.get(field, {})])),
            "component_data_status": raw.get("component_data_status", "unverified"),
            "missing_mass_components": raw.get("missing_mass_components", []),
            "extraction_warnings": raw.get("extraction_warnings", []),
            "source_quantities": clean_json(source_quantities),
        }

    blocks = {
        name: {**record(raw, ("heat_kW", "power_kW"), f"blocks/{name}", raw.get("source_quantities", {})),
               "source_quantities": clean_json(raw.get("source_quantities", {}))}
        for name, raw in data.get("blocks", {}).items()
    }
    result = {
        "schema_version": "1.0", "kind": "aspen_export_si",
        "units": {"temperature_k": "K", "pressure_pa": "Pa", "mass_flow_kg_s": "kg/s",
                  "molar_flow_mol_s": "mol/s", "heat_duty_w": "W", "power_w": "W",
                  "component_mass_flow_kg_s": "kg/s", "component_molar_flow_mol_s": "mol/s",
                  "mass_fraction": "1", "mole_fraction": "1"},
        "aggregation": "Each stream total is already aggregated. Never add total to substreams.",
        "quality": {"status": "known_export_format" if trusted_format else "unverified",
                    "convergence": "not_assessed"},
        "provenance": {"source": source_name, "sha256": source_sha256,
                       "model_path": data.get("model_path"), "captured_at": data.get("captured_at"),
                       "unit_conversion": data.get("unit_conversion"),
                       "component_export": data.get("component_export")},
        "component_ids": list(dict.fromkeys(data.get("component_ids", []) + [
            component for stream in streams.values() for component in stream["component_ids"]])),
        "aspen_run_status": clean_json(data.get("aspen_run_status", {})),
        "streams": streams, "blocks": blocks, "diagnostics": diagnostics,
    }
    if diagnostics and trusted_format:
        result["quality"]["status"] = "partial"
    if not trusted_format:
        result["unverified_source_data"] = clean_json(data)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.output and args.source.resolve() == args.output.resolve():
        parser.error("Output must differ from the source export.")
    payload = args.source.read_bytes()
    result = adapt_export(json.loads(payload.decode("utf-8-sig")), str(args.source.resolve()),
                          hashlib.sha256(payload).hexdigest())
    text = json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    else:
        sys.stdout.reconfigure(encoding="utf-8")
        print(text)


if __name__ == "__main__":
    main()
