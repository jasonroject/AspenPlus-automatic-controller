"""The Aspen result package: the one input format shared by the local and the online path.

    probe-summary.json   aspen-probe/1.1  run status, per-block blkmsg/per_error, energy table (native unit + kW), group_totals
                         (an aspen-probe/1 file is accepted too: it is read through probe_compat.upgrade_summary)
    graph.json           aspen-model-graph/1  flowsheet with native values and UnitStrings          (optional)
    roles.json           aspen-roles/1        role draft for the graph; review.state auto_draft | partially_reviewed | reviewed (optional)
    advice.json          aspen-advice/1       rule-based model advice from advice.advise()           (optional)

Only probe-summary.json is required; checks that need a missing file are skipped (and a warning says so).
* Local mode (`serve_web.py --local`) writes all four files, optionally as one zip.
* The online static site accepts the same files (loose, in a folder, or zipped) by upload.
Both go through `read_package` + `validate_package` here, so there is a single definition of "valid"; cross-file
consistency is advice.package_problems, so upload, CLI and local mode refuse the same inputs.

    python -m aspen_study.result_package check <dir | package.zip | probe-summary.json>   # validate
    python -m aspen_study.result_package zip   <dir> [-o package.zip]                      # validate + zip

No Aspen is needed; a package is plain JSON. The .bkp model itself is never part of a package.
"""
from __future__ import annotations

import argparse
import copy
import io
import json
import sys
import zipfile
from pathlib import Path

from .advice import advise, package_problems
from .classifier import classify
from .probe_compat import group_totals, upgrade_summary
from .schema_check import validate

PACKAGE_FILES = ("probe-summary.json", "graph.json", "roles.json", "advice.json")
REQUIRED = ("probe-summary.json",)       # graph / roles / advice are optional: checks that need them are skipped
SCHEMA_OF = {"probe-summary.json": "probe", "graph.json": "graph", "roles.json": "roles", "advice.json": "advice"}
MAX_FILE_BYTES = 32 * 1024 * 1024        # per member; real packages are ~10-100 KB
MAX_PACKAGE_BYTES = 64 * 1024 * 1024
ZIP_DATE = (2026, 1, 1, 0, 0, 0)         # fixed, so the same package always zips to the same bytes
TOTAL_TOLERANCE_KW = 1e-4                # group_totals are rounded to 6 decimals; allow for summation order


class PackageError(ValueError):
    """Unreadable or invalid package; `.problems` lists every reason (user-facing)."""

    def __init__(self, problems):
        self.problems = list(problems)
        super().__init__("; ".join(self.problems[:10]) + (" …" if len(self.problems) > 10 else ""))


class ProbeOutputMissing(PackageError):
    """The probe did not write probe-summary.json / graph.json at all (as opposed to writing inconsistent files)."""


# ----------------------------------------------------------------------------------------------- reading
def _parse(name, raw):
    if len(raw) > MAX_FILE_BYTES:
        raise PackageError([f"{name}: larger than {MAX_FILE_BYTES // 1024 // 1024} MB"])
    try:
        return json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PackageError([f"{name}: not valid UTF-8 JSON ({exc})"]) from exc


def _safe_member(name):
    parts = name.replace("\\", "/").split("/")
    return not (name.startswith(("/", "\\")) or ":" in parts[0] or ".." in parts)


def read_zip(data):
    """{name: JSON} from zip bytes. Members may sit at the root or under one folder; others are ignored."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise PackageError(["not a zip file"]) from exc
    infos = [i for i in archive.infolist() if not i.is_dir()]
    if sum(i.file_size for i in infos) > MAX_PACKAGE_BYTES:
        raise PackageError(["zip expands to more than %d MB" % (MAX_PACKAGE_BYTES // 1024 // 1024)])
    found, problems = {}, []
    for info in infos:
        if not _safe_member(info.filename):
            problems.append(f"unsafe path in zip: {info.filename!r}")
            continue
        base = info.filename.replace("\\", "/").rsplit("/", 1)[-1]
        if base in PACKAGE_FILES:
            if base in found:
                problems.append(f"{base} appears more than once in the zip")
                continue
            if info.file_size > MAX_FILE_BYTES:
                problems.append(f"{base}: larger than {MAX_FILE_BYTES // 1024 // 1024} MB")
                continue
            found[base] = _parse(base, archive.read(info))
    if problems:
        raise PackageError(problems)
    return found


def read_package(source):
    """Parts from a folder, a .zip, zip bytes, one JSON file (its siblings are picked up), or a {name: JSON} mapping.

    Returns {name: parsed JSON} for whichever of PACKAGE_FILES exist; `validate_package` reports what is missing.
    """
    if isinstance(source, dict):
        return {k: v for k, v in source.items() if k in PACKAGE_FILES}
    if isinstance(source, (bytes, bytearray)):
        return read_zip(bytes(source))
    path = Path(source)
    if path.is_dir():
        folder = path
    elif path.suffix.lower() == ".zip":
        return read_zip(path.read_bytes())
    elif path.is_file() and path.name in PACKAGE_FILES:
        folder = path.parent
    else:
        raise PackageError([f"{path}: not a package folder, zip or one of {', '.join(PACKAGE_FILES)}"])
    return {name: _parse(name, (folder / name).read_bytes()) for name in PACKAGE_FILES if (folder / name).is_file()}


# -------------------------------------------------------------------------------------------- validating
def normalize_summary(summary):
    """The summary as aspen-probe/1.1 (1.0 goes through probe_compat.upgrade_summary; 1.1 is copied unchanged)."""
    try:
        return upgrade_summary(summary)
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        raise PackageError([f"probe-summary.json: cannot be read as aspen-probe/1 or 1.1 ({exc})"]) from exc


def normalize_package(parts):
    """Copy of `parts` whose probe summary is 1.1. Everything else is untouched."""
    out = dict(parts)
    if "probe-summary.json" in out:
        out["probe-summary.json"] = normalize_summary(out["probe-summary.json"])
    return out


def _group_total_problems(summary):
    """group_totals must be what the block rows imply: heating / cooling / shaft_work / internal_exchange, and
    overall = heating + cooling + shaft_work (signed, internal exchange excluded); `complete` false when a member is null."""
    problems = []
    stated = summary["group_totals"]
    expected = group_totals(summary["blocks"], summary["totals_complete"])
    for key, want in expected.items():
        got = stated.get(key)
        if got is None:
            problems.append(f"group_totals.{key} missing")
            continue
        if (got["kW"] is None) != (want["kW"] is None) or (got["kW"] is not None and abs(got["kW"] - want["kW"]) > TOTAL_TOLERANCE_KW):
            problems.append(f"group_totals.{key}.kW is {got['kW']} but the block rows give {want['kW']}")
        if got["complete"] != want["complete"]:
            problems.append(f"group_totals.{key}.complete is {got['complete']} but should be {want['complete']}")
    ext = [stated[k]["kW"] for k in ("heating", "cooling", "shaft_work")]
    if None not in ext and stated["overall"]["kW"] is not None and abs(stated["overall"]["kW"] - sum(ext)) > TOTAL_TOLERANCE_KW:
        problems.append("group_totals.overall is not heating + cooling + shaft_work (internal exchange is excluded)")
    work = summary["totals_kW"].get("work")
    shaft = stated["shaft_work"]["kW"]
    if (work is None) != (shaft is None) or (work is not None and abs(work - shaft) > TOTAL_TOLERANCE_KW):
        problems.append("totals_kW.work differs from group_totals.shaft_work.kW")
    return problems


def validate_package(parts):
    """Return {"errors": [...], "warnings": [...]}; never raises. Empty errors == the package is accepted.

    Required: probe-summary.json. Optional: graph.json, roles.json, advice.json (checks needing a missing file are
    skipped and said so). Checks: each file against its schema (an aspen-probe/1 summary is upgraded to 1.1 first);
    consistency of the files (advice.package_problems: same model sha256, same blocks/streams, source unchanged);
    group_totals agree with the block rows; energy_gaps / unverified_paths name existing blocks; advice belongs to
    this model. A failed Aspen run, unreviewed roles, incomplete totals or unverified node reads are warnings.
    """
    errors, warnings = [], []
    for name in REQUIRED:
        if name not in parts:
            errors.append(f"missing {name}")
    checked = {}
    for name in PACKAGE_FILES:
        if name not in parts:
            continue
        part = parts[name]
        try:
            if name == "probe-summary.json":
                part = normalize_summary(part)
                if part.get("migrated_from"):
                    warnings.append(f"probe-summary.json is {part['migrated_from']} (older probe), upgraded to aspen-probe/1.1: "
                                    "blkmsg split is inferred, per_error_total unknown, verified flags derived from RECIPES")
            validate(part, SCHEMA_OF[name])
            checked[name] = part
        except (ValueError, KeyError, TypeError) as exc:
            errors.append(exc.problems[0] if isinstance(exc, PackageError) else f"{name}: {str(exc).split(': ', 1)[-1]}")
    if errors:
        return {"errors": errors, "warnings": warnings}
    summary, graph, roles, advice = (checked.get(n) for n in PACKAGE_FILES)
    errors += package_problems(summary, graph, roles)
    errors += [f"probe-summary.json: {p}" for p in _group_total_problems(summary)]
    ids = {b["id"] for b in summary["blocks"]}
    for field in ("energy_gaps", "unverified_paths"):
        for item in summary[field]:
            if item["block"] is not None and item["block"] not in ids:
                errors.append(f"probe-summary.json: {field} names unknown block {item['block']!r}")
    if advice is not None and advice["model"]["sha256"] != summary["model"]["sha256"]:
        errors.append("advice.json is for a different model (sha256 differs from probe-summary.json)")
    if graph is None:
        warnings.append("no graph.json: heat-integration, mass-balance and LCA-readiness checks are skipped")
    if roles is None:
        warnings.append("no roles.json: product / functional-unit checks are skipped")
    state = summary["status"]["state"]
    if state == "error":
        warnings.append("Aspen reported errors for this run: " + "; ".join(summary["status"]["errors"][:3]))
    elif state == "warning":
        warnings.append("Aspen completed with warnings: " + "; ".join(summary["status"]["warnings"][:3]))
    if not summary["totals_complete"]:
        warnings.append("energy totals are incomplete (read gaps or unregistered block types): group_totals marked complete=false")
    if summary["unverified_paths"]:
        warnings.append(f"{len(summary['unverified_paths'])} node read(s) are not yet verified on a real Aspen")
    if roles is not None:
        review = roles["review"]
        if review["state"] == "partially_reviewed":
            warnings.append(f"roles are partially reviewed ({len(review.get('pending', []))} item(s) pending): finish the review before any LCA conclusion")
        elif review["state"] != "reviewed":
            warnings.append(f"roles are '{review['state']}': review product streams and the functional unit before any LCA conclusion")
    return {"errors": errors, "warnings": warnings}


# --------------------------------------------------------------------------------------------- building
def build_package(summary, graph=None, roles=None, advice=None, with_advice=False):
    """Assemble and validate a package. The summary is stored as 1.1; roles are drafted from the graph if absent.

    with_advice=True computes advice.json with advice.advise(summary, graph, roles) (after the consistency checks,
    so inconsistent inputs are never advised on) and validates it against the advice schema.
    Raises PackageError with every problem if anything is invalid.
    """
    summary = normalize_summary(summary)
    if roles is None and graph is not None:
        roles = classify(graph)
    parts = {"probe-summary.json": summary}
    for name, value in (("graph.json", graph), ("roles.json", roles), ("advice.json", advice)):
        if value is not None:
            parts[name] = value
    report = validate_package(parts)
    if report["errors"]:
        raise PackageError(report["errors"])
    if with_advice and advice is None:
        result = advise(summary, graph, roles)
        try:
            validate(result, "advice")
        except ValueError as exc:
            raise PackageError([f"advice.json: {exc}"]) from exc
        parts["advice.json"] = result
        report = validate_package(parts)
        if report["errors"]:
            raise PackageError(report["errors"])
    return {name: parts[name] for name in PACKAGE_FILES if name in parts}


def package_from_probe_dir(out_dir, with_advice=False):
    """Read what `python -m aspen_study probe` wrote into out_dir (roles.json is drafted when the probe skipped it)."""
    out = Path(out_dir)
    problems = [f"probe wrote no {n}" for n in ("probe-summary.json", "graph.json") if not (out / n).is_file()]
    if problems:
        raise ProbeOutputMissing(problems)
    summary = _parse("probe-summary.json", (out / "probe-summary.json").read_bytes())
    graph = _parse("graph.json", (out / "graph.json").read_bytes())
    roles = _parse("roles.json", (out / "roles.json").read_bytes()) if (out / "roles.json").is_file() else None
    return build_package(summary, graph, roles, with_advice=with_advice)


def _checked(parts):
    parts = normalize_package(parts)
    report = validate_package(parts)
    if report["errors"]:
        raise PackageError(report["errors"])
    return parts


def write_package(out_dir, parts):
    """Write the files present (UTF-8, indent=1, like the probe); the summary is written as 1.1. Validates first; returns the paths."""
    parts = _checked(parts)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    paths = []
    for name in PACKAGE_FILES:
        if name in parts:
            path = out / name
            path.write_text(json.dumps(parts[name], ensure_ascii=False, indent=1), encoding="utf-8")
            paths.append(path)
    return paths


def zip_bytes(parts):
    """The package as one zip (members at the root, fixed timestamps, deterministic; the summary as 1.1)."""
    parts = _checked(parts)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in PACKAGE_FILES:
            if name in parts:
                info = zipfile.ZipInfo(name, ZIP_DATE)
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, json.dumps(parts[name], ensure_ascii=False, indent=1).encode("utf-8"))
    return buffer.getvalue()


def describe(parts):
    """One short, UI-friendly summary of a package (what the site shows before analysis)."""
    summary = normalize_summary(parts["probe-summary.json"])
    graph, advice = parts.get("graph.json"), parts.get("advice.json")
    return {"model": summary["model"].get("file"), "sha256": summary["model"].get("sha256"),
            "state": summary["status"]["state"], "files": [n for n in PACKAGE_FILES if n in parts],
            "blocks": len(summary["blocks"]), "streams": None if graph is None else len(graph["streams"]),
            "totals_complete": summary["totals_complete"],
            "group_totals": copy.deepcopy(summary["group_totals"]),
            "unverified_paths": len(summary["unverified_paths"]), "energy_gaps": len(summary["energy_gaps"]),
            "advice": None if advice is None else dict(advice["counts"]),
            "migrated_from": summary.get("migrated_from")}


# ------------------------------------------------------------------------------------------------- CLI
def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check", help="validate a package folder / zip / one of its files")
    check.add_argument("path")
    pack = sub.add_parser("zip", help="validate a probe output folder and write package.zip")
    pack.add_argument("folder")
    pack.add_argument("-o", "--output", default=None)
    pack.add_argument("--no-advice", action="store_true", help="do not add advice.json")
    args = parser.parse_args(argv)
    try:
        if args.command == "check":
            parts = read_package(args.path)
            report = validate_package(parts)
        else:
            parts = package_from_probe_dir(args.folder, with_advice=not args.no_advice)
            report = validate_package(parts)
            target = Path(args.output or Path(args.folder) / "package.zip")
            target.write_bytes(zip_bytes(parts))
            print(f"wrote {target}")
    except PackageError as exc:
        print("invalid package: " + "; ".join(exc.problems), file=sys.stderr)
        return 2
    for text in report["warnings"]:
        print("warning:", text)
    for text in report["errors"]:
        print("error:", text, file=sys.stderr)
    if not report["errors"]:
        print("package ok:", json.dumps(describe(parts), ensure_ascii=False))
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
