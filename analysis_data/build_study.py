"""Build the analysis UI dataset from the manuscript's reconciled exports."""
from __future__ import annotations

import csv
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "source"
TARGET = ROOT.parent / "analysis_web" / "data" / "study.json"
FILES = {
    "process": "all_20_cases.csv",
    "energy": "energy-and-heat-recovery-v2.csv",
    "inventory": "paired-inventory-accounting-v2.csv",
    "monte_carlo": "lca-monte-carlo-gwp-summary-v2.csv",
}


def number(row, key):
    value = float(row[key])
    if not math.isfinite(value):
        raise ValueError(f"Non-finite {key}")
    return value


def read_table(source_id, scenario=False, temperature_key="temperature_C"):
    indexed = {}
    with (SOURCE / FILES[source_id]).open(encoding="utf-8-sig", newline="") as handle:
        for line, row in enumerate(csv.DictReader(handle), 2):
            key = (number(row, temperature_key), number(row, "length_m"))
            if scenario:
                key += (row["scenario"],)
            if key in indexed:
                raise ValueError(f"Duplicate key in {source_id}: {key}")
            indexed[key] = (row, line)
    return indexed


def build():
    process = read_table("process")
    energy = read_table("energy", scenario=True)
    inventory = read_table("inventory")
    monte_carlo = read_table("monte_carlo", True, "nominal_temperature_C")
    if len(process) != 20 or set(process) != set(inventory):
        raise ValueError("Expected 20 matching process/inventory conditions")
    expected = {key + (scenario,) for key in process for scenario in ("STD", "HR")}
    if set(energy) != expected or set(monte_carlo) != expected:
        raise ValueError("Energy and Monte Carlo tables must contain all 40 paired cases")
    cases = []
    for key in sorted(process):
        p, process_line = process[key]
        inv, inventory_line = inventory[key]
        condition_id = f"T{key[0]:g}-L{key[1]:g}"
        for scenario in ("STD", "HR"):
            e, energy_line = energy[key + (scenario,)]
            mc, mc_line = monte_carlo[key + (scenario,)]
            target = number(p, "target_yield_kg_per_100kg")
            reference_mass = number(inv, f"{scenario}_foreground_reference_kg")
            gwp = number(inv, f"{scenario}_GWP_per_100kg_foreground")
            if reference_mass <= 0 or not math.isclose(target, reference_mass, abs_tol=1e-6):
                raise ValueError(f"Product reference mismatch: {condition_id} {scenario}")
            if not math.isclose(number(mc, "temperature_K"), number(p, "temperature_K")):
                raise ValueError("Temperature mismatch")
            heater = number(e, "heater_kW") * 1000
            reactor = number(e, "reactor_kW") * 1000
            pump_inventory = number(e, "pump_inventory_kWh_per_100kg") * 3_600_000
            electricity = (heater + reactor) * 3600 + pump_inventory
            expected_electricity = (number(e, "two_module_kWh_per_100kg") + number(e, "pump_inventory_kWh_per_100kg")) * 3_600_000
            if not math.isclose(electricity, expected_electricity, rel_tol=1e-9):
                raise ValueError("Energy accounting mismatch")
            if mc["exported_summary_reconciled"].lower() != "true":
                raise ValueError("Unreconciled Monte Carlo summary")
            ci = [number(mc, "p025_per_kg_product"), number(mc, "p975_per_kg_product")]
            mean = number(mc, "mean_per_kg_product")
            if not ci[0] <= mean <= ci[1]:
                raise ValueError("Invalid Monte Carlo interval")
            cases.append({
                "id": f"{condition_id}-{scenario}", "condition_id": condition_id,
                "scenario": scenario,
                "inputs": {"temperature_k": number(p, "temperature_K"),
                           "nominal_temperature_c": key[0], "pressure_pa": 25_000_000,
                           "length_m": key[1], "feed_kg_s": number(p, "feed_kg_h") / 3600},
                "outputs": {"target_monomer_kg": target,
                            "target_yield_fraction": target / 100,
                            "char_proxy_kg": number(p, "char_proxy_kg_per_100kg"),
                            "residence_time_s": number(p, "residence_time_h") * 3600,
                            "heater_w": heater, "reactor_w": reactor,
                            "pump_w": number(p, "pump_kW") * 1000,
                            "pump_inventory_j": pump_inventory, "electricity_j": electricity,
                            "cooler_w": number(e, "cooler_duty_kW") * 1000,
                            "separator_w": number(e, "B6_duty_kW") * 1000,
                            "components_kg_s": {"CAT": number(p, "CAT_kg_h") / 3600,
                                                "O_CRESOL": number(p, "O_CRESOL_kg_h") / 3600}},
                "lca": {"gwp_kg_co2e": gwp, "cf_kg_co2e_per_kg_target": gwp / reference_mass,
                        "reference_target_kg": reference_mass,
                        "ci95_kg_co2e_per_kg_target": ci, "mc_mean_cf": mean,
                        "iterations": int(number(mc, "valid_iterations")),
                        "method": "ReCiPe 2016 v1.03 midpoint (H)",
                        "time_horizon_years": 100,
                        "interval_type": "Monte Carlo 2.5th–97.5th percentiles",
                        "boundary": "cradle-to-gate",
                        "export_target_scale": number(inv, f"{scenario}_export_target_scale")},
                "quality": {"status": "imported", "note": "论文归档计算结果；HR 产物数据沿用配对 STD 反应出口。",
                            "component_scope": "target_monomers_only",
                            "mass_balance_error_fraction": number(p, "mass_balance_error_pct") / 100},
                "provenance": {"source_id": "inventory", "source_row": inventory_line,
                               "rows": {"process": process_line, "energy": energy_line,
                                        "inventory": inventory_line, "monte_carlo": mc_line},
                               "pressure_source": "修订稿 2.1 节共同设定 25 MPa"},
            })
    return {
        "schema_version": "1.0",
        "study": {"id": "htl-model-compounds-manuscript-20261116",
                  "title": "木质素水热液化 · 全流程分析", "description": "20 个工况 · STD / HR 配对分析",
                  "basis": {"duration_s": 3600, "wet_feed_kg": 100},
                  "source_note": "导入修订论文归档结果；采用经功能单位校正的 LCA 清单。",
                  "screening": {"scenario": "STD", "normalization": "all_20_conditions",
                                "presets": {"yield": [0.6, 0.2, 0.2], "char": [0.2, 0.6, 0.2], "cf": [0.2, 0.2, 0.6]}}},
        "sources": [{"id": key, "label": value, "file": f"source/{value}",
                     "sha256": hashlib.sha256((SOURCE / value).read_bytes()).hexdigest()} for key, value in FILES.items()],
        "units": {"inputs.temperature_k": "K", "inputs.nominal_temperature_c": "degC (nominal)",
                  "inputs.pressure_pa": "Pa", "inputs.length_m": "m", "inputs.feed_kg_s": "kg/s",
                  "outputs.target_monomer_kg": "kg", "outputs.char_proxy_kg": "kg",
                  "outputs.target_yield_fraction": "1", "outputs.residence_time_s": "s",
                  "outputs.heater_w": "W", "outputs.reactor_w": "W", "outputs.pump_w": "W",
                  "outputs.cooler_w": "W", "outputs.separator_w": "W", "outputs.electricity_j": "J",
                  "outputs.pump_inventory_j": "J", "outputs.components_kg_s": "kg/s",
                  "lca.gwp_kg_co2e": "kg CO2-eq", "lca.reference_target_kg": "kg",
                  "lca.cf_kg_co2e_per_kg_target": "kg CO2-eq/kg contained target monomer",
                  "lca.ci95_kg_co2e_per_kg_target": "kg CO2-eq/kg contained target monomer",
                  "lca.mc_mean_cf": "kg CO2-eq/kg contained target monomer"},
        "cases": cases,
    }


if __name__ == "__main__":
    data = build()
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    print(f"Validated and exported {len(data['cases'])} cases to {TARGET}")
