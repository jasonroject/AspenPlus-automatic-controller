"""Explicit conversions of Aspen node units into export units."""
def convert_quantity(value, unit, target):
    unit = str(unit).strip().lower().replace(" ", "")
    number = float(value)
    if target == "C":
        if unit in ("k", "kelvin"):
            return number - 273.15
        if unit in ("c", "degc", "°c"):
            return number
        if unit in ("f", "degf", "°f"):
            return (number - 32) * 5 / 9
    factors = {
        "kW": {"w": .001, "kw": 1, "mw": 1000, "cal/sec": .004184,
               "cal/s": .004184, "kcal/hr": 4.184 / 3600, "kcal/sec": 4.184,
               "j/sec": .001, "kj/hr": 1 / 3600, "btu/hr": 1055.05585262 / 3600000},
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
