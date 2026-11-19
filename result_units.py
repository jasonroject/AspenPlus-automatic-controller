"""Explicit conversions of Aspen node units into export units.

1 cal = 4.1868 J is Aspen Plus' own calorie (verified on the real heatrecovery model, 2026-11-19: the same
enthalpy flow read as -81613.3056 cal/sec under MET and -341698.588 W under SI, ratio 4.18680000).
It is NOT the thermochemical 4.184 and the MET heat-duty unit is cal/sec, not kW.
"""
import math

CALORIE_J = 4.1868
CALORIE_CHOICES = (4.184, 4.1868)   # only the Aspen value is used by default; 4.184 must be asked for explicitly
BTU_J = 1055.05585262

# Unit of every numeric key the exporters write. Keys are the dictionary names used in blocks/streams records.
BLOCK_UNITS = {"heat_kW": "kW", "power_kW": "kW"}
STREAM_UNITS = {"temperature_C": "C", "pressure_MPa": "MPa", "mass_flow_kg_h": "kg/h", "mole_flow_kmol_h": "kmol/h",
                "composition_kg_h": "kg/h", "composition_kmol_h": "kmol/h", "mass_fraction": "fraction",
                "mole_fraction": "fraction"}
RUN_UNITS = {"elapsed_time_seconds": "s"}


def convert_quantity(value, unit, target, calorie_J=CALORIE_J):
    if calorie_J not in CALORIE_CHOICES:
        raise ValueError(f"calorie_J must be one of {CALORIE_CHOICES}, got {calorie_J!r}")
    unit = str(unit).strip().lower().replace(" ", "")
    number = float(value)
    if target == "C":
        if unit in ("k", "kelvin"):
            return number - 273.15
        if unit in ("c", "degc", "°c"):
            return number
        if unit in ("f", "degf", "°f"):
            return (number - 32) * 5 / 9
    cal = calorie_J
    factors = {
        # kW per unit; cal-based units use the Aspen calorie, never an implicit kW/W assumption
        "kW": {"w": .001, "kw": 1, "mw": 1000, "cal/sec": cal / 1000,
               "cal/s": cal / 1000, "kcal/hr": cal / 3600, "kcal/sec": cal,
               "j/sec": .001, "kj/hr": 1 / 3600, "btu/hr": BTU_J / 3600000},
        "MPa": {"pa": 1e-6, "kpa": .001, "mpa": 1, "bar": .1,
                "atm": .101325, "psi": .006894757293168},
        "kg/h": {"kg/hr": 1, "kg/h": 1, "kg/sec": 3600, "kg/s": 3600,
                 "kg/min": 60, "gm/sec": 3.6, "g/s": 3.6, "gm/hr": .001,
                 "g/hr": .001, "lb/hr": .45359237, "lb/sec": 1632.932532},
        "kmol/h": {"kmol/hr": 1, "kmol/h": 1, "kmol/sec": 3600,
                   "kmol/s": 3600, "kmol/min": 60, "mol/hr": .001,
                   "mol/h": .001, "mol/sec": 3.6, "mol/s": 3.6,
                   "lbmol/hr": .45359237, "lbmol/h": .45359237},
        "fraction": {"": 1, "fraction": 1, "unitless": 1,
                     "dimensionless": 1, "%": .01, "percent": .01},
    }
    if unit in factors.get(target, {}):
        return number * factors[target][unit]
    raise ValueError(f"不能将单位 {unit!r} 转换为 {target}；请补充单位映射")


def format_quantity(value, unit, digits=2, missing="无"):
    """'4.19 kW'; None/non-finite -> `missing`. The unit is always printed with the number."""
    if value is None or isinstance(value, bool) or not math.isfinite(float(value)):
        return missing
    return f"{round(float(value), digits)} {unit}"


def missing_units(record, units, path="", exempt=()):
    """Paths of numeric leaves that carry no unit string.

    A leaf has a unit when its key is declared in `units` (a {key: unit} map, applied to whole sub-dicts such as
    per-component compositions), when it sits inside a {"value", "unit"} quantity with a non-empty unit, or when
    Booleans are not quantities; `exempt` names status codes (e.g. blkstat) that are not physical quantities.
    """
    problems = []
    if isinstance(record, dict):
        if "value" in record and "unit" in record and isinstance(record["value"], (int, float)):
            if not isinstance(record["value"], bool) and not str(record.get("unit") or "").strip():
                problems.append(f"{path}: unit is empty")
            return problems
        for key, item in record.items():
            if key in ("units", "source_quantities"):
                continue
            where = f"{path}.{key}" if path else str(key)
            if isinstance(item, (int, float)) and not isinstance(item, bool):
                if key not in units and key not in exempt:
                    problems.append(f"{where}: no unit declared")
            elif isinstance(item, dict) and key in units:
                for k, v in item.items():
                    if isinstance(v, (int, float)) and not isinstance(v, bool) and not units[key]:
                        problems.append(f"{where}.{k}: empty unit")
            elif isinstance(item, (dict, list)):
                problems += missing_units(item, units, where, exempt)
    elif isinstance(record, list):
        for index, item in enumerate(record):
            if isinstance(item, (dict, list)):
                problems += missing_units(item, units, f"{path}[{index}]", exempt)
    return problems
