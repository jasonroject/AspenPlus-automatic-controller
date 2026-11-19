"""Small, explicit unit helpers used only for classification heuristics.

Accounting conversions stay in analysis_web/universal-core.mjs; these helpers
only rank candidates (temperatures, mass fractions), so an unknown unit
returns None instead of a guess.
"""
from __future__ import annotations


def temperature_C(value, unit):
    if value is None or unit is None:
        return None
    u = str(unit).strip().upper().replace("°", "").replace("DEG", "")
    if u in ("C", "CELSIUS"):
        return float(value)
    if u in ("K", "KELVIN"):
        return float(value) - 273.15
    if u in ("F", "FAHRENHEIT"):
        return (float(value) - 32) * 5 / 9
    if u in ("R", "RANKINE"):
        return (float(value) - 491.67) * 5 / 9
    return None
