"""Map explicitly captured nodes into the existing browser five-table contract."""
from __future__ import annotations

from copy import deepcopy

from .profile import canonical_hash, finite, validate_profile


def quantity(spec, readouts):
    """Return (numeric value, unchanged native unit, provenance).

    Deliberately no eval, inferred zero, implicit utility efficiency or unit
    relabelling. Unit conversion remains in the shared browser/Node core.
    """
    if "readout" in spec:
        ident = spec["readout"]
        raw = readouts.get(ident)
        if not raw or raw.get("error"):
            raise ValueError(f"Readout unavailable: {ident}")
        return finite(raw.get("value"), ident), raw["unit"], raw.get("path", ident)
    if "constant" in spec:
        return finite(spec["constant"], "constant"), spec["unit"], spec["source"]
    if "sum" in spec:
        parts = [quantity(term, readouts) for term in spec["sum"]]
        if len({part[1] for part in parts}) != 1:
            raise ValueError("Sum terms must have identical declared native units; export a common unit first")
        return finite(sum(part[0] for part in parts), "sum"), parts[0][1], spec["source"] + "; " + "; ".join(part[2] for part in parts)
    if "positive" in spec:
        value, unit, source = quantity(spec["positive"], readouts)
        return max(0, value), unit, spec["source"] + "; " + source
    value, unit, source = quantity(spec["quantity"], readouts)
    return finite(value * spec["scale"], "scaled quantity"), unit, spec["source"] + "; " + source


def normalize_capture(profile, raw):
    validate_profile(profile)
    if raw.get("profile_id") != profile["id"] or raw.get("model_sha256") != profile["model"]["sha256"]:
        raise ValueError("Captured data does not match the profile/model identity")
    if "profile_sha256" in raw and raw["profile_sha256"] != canonical_hash(profile):
        raise ValueError("Captured profile hash does not match the reviewed mapping identity")
    if raw.get("control_succeeded") is not True or raw.get("solver_accepted") is not True:
        raise ValueError("Solver completion was not accepted; raw evidence is retained but no usable project is emitted")
    readouts = raw.get("readouts", {})
    for spec in profile["readouts"]:
        captured = readouts.get(spec["id"], {})
        if captured.get("path") != spec["path"] or captured.get("unit") != spec["native_unit"]:
            raise ValueError(f"Readout path/unit mismatch: {spec['id']}; no unit was guessed")
        if captured.get("error"):
            raise ValueError(f"Required readout unavailable: {spec['id']}: {captured['error']}")
        finite(captured.get("value"), "readout " + spec["id"])
    mapping, case = profile["mapping"], raw["case_id"]
    provenance = f"{raw.get('evidence_type', 'unverified_capture')}; model SHA-256 {raw['model_sha256']}; case {case}; raw evidence runs/{case}/raw.json"
    project = {"schema_version": 1, "meta": deepcopy(mapping["meta"]), "cases": [], "streams": [], "blocks": [], "inventory": [], "factors": deepcopy(mapping["factors"])}
    project["meta"].update({"model_profile_id": profile["id"], "source_sha256": raw["model_sha256"],
                           "evidence_type": raw.get("evidence_type", "unverified_capture"), "physical_validation": False,
                           "native_warnings": raw.get("warnings", [])})
    value, unit, source = quantity(mapping["product"]["quantity"], readouts)
    feed, feed_unit, feed_source = quantity(mapping["product"]["feed"], readouts)
    if unit != feed_unit:
        raise ValueError("Product and feed mappings must share an exact native mass-rate unit")
    project["cases"].append({"id": case, "product_rate": value, "feed_rate": feed, "mass_unit": unit,
                             "allocation": mapping["product"]["allocation"],
                             "source": provenance + "; " + mapping["product"]["source"] + "; " + source + "; " + feed_source})
    for row in mapping["streams"]:
        mass, mass_unit, source = quantity(row["mass"], readouts)
        result = {"case_id": case, "id": row["id"], "from": row["from"], "to": row["to"], "mass_flow": mass, "mass_unit": mass_unit}
        if "enthalpy" in row:
            result["enthalpy_flow"], result["energy_unit"], enthalpy_source = quantity(row["enthalpy"], readouts)
        else:
            result["specific_enthalpy"], result["enthalpy_unit"], enthalpy_source = quantity(row["specific_enthalpy"], readouts)
        result["source"] = provenance + "; " + source + "; " + enthalpy_source
        project["streams"].append(result)
    for row in mapping["blocks"]:
        heat, heat_unit, source = quantity(row["heat"], readouts)
        power, power_unit, power_source = quantity(row["power"], readouts)
        project["blocks"].append({"case_id": case, "id": row["id"], "heat": heat, "power": power,
                                   "energy_unit": heat_unit, "heat_unit": heat_unit, "power_unit": power_unit,
                                   "source": provenance + "; " + row["source"] + "; " + source + "; " + power_source})
    for row in mapping["inventory"]:
        amount, unit, source = quantity(row["quantity"], readouts)
        project["inventory"].append({"case_id": case, "id": row["id"], "name": row.get("name", row["id"]),
                                     "kind": row["kind"], "amount": amount, "unit": unit, "factor_id": row["factor_id"],
                                     "source": provenance + "; " + row["source"] + "; " + source})
    return project


def combine_projects(profile, projects, omitted_cases=()):
    combined = {"schema_version": 1, "meta": deepcopy(profile["mapping"]["meta"]), "factors": deepcopy(profile["mapping"]["factors"])}
    for table in ("cases", "streams", "blocks", "inventory"):
        combined[table] = [row for project in projects for row in project[table]]
    evidence = {project["meta"].get("evidence_type", "unverified_capture") for project in projects}
    combined["meta"].update({"model_profile_id": profile["id"], "source_sha256": profile["model"]["sha256"],
                             "omitted_failed_case_ids": list(omitted_cases), "physical_validation": False,
                             "evidence_type": "offline_fixture" if "offline_fixture" in evidence else "native_simulation" if evidence == {"native_simulation"} else "mixed_or_unverified"})
    return combined
