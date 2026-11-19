"""The Aspen result package: the one input format shared by the local and the online path.

    probe-summary.json   aspen-probe/1        run status, per-block messages and energy table (native unit + kW)
    graph.json           aspen-model-graph/1  flowsheet with native values and UnitStrings
    roles.json           aspen-roles/1        role draft for the graph (auto_draft until a person confirms it)

* Local mode (`serve_web.py --local`, or `python -m aspen_study probe` + this module) writes exactly these three
  files, optionally as one zip.
* The online static site accepts exactly these three files (loose, in a folder, or zipped) by upload.
Both paths go through `read_package` + `validate_package` here, so there is a single definition of "valid".

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

from .schema_check import validate

PACKAGE_FILES = ("probe-summary.json", "graph.json", "roles.json")
SCHEMA_OF = {"probe-summary.json": "probe", "graph.json": "graph", "roles.json": "roles"}
SCHEMA_ID = {"probe-summary.json": "aspen-probe/1", "graph.json": "aspen-model-graph/1", "roles.json": "aspen-roles/1"}
MAX_FILE_BYTES = 32 * 1024 * 1024        # per member; real packages are ~10-100 KB
MAX_PACKAGE_BYTES = 64 * 1024 * 1024
ZIP_DATE = (2026, 1, 1, 0, 0, 0)         # fixed, so the same package always zips to the same bytes


class PackageError(ValueError):
    """Unreadable or invalid package; `.problems` lists every reason (user-facing)."""

    def __init__(self, problems):
        self.problems = list(problems)
        super().__init__("; ".join(self.problems[:10]) + (" …" if len(self.problems) > 10 else ""))


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
def _legacy_totals_complete(summary):
    """Same rule as probe.build_summary; real summaries written before the field existed lack it."""
    return not summary.get("energy_gaps") and not (summary.get("discovery") or {}).get("unmatched_block_types")


def validate_package(parts):
    """Return {"errors": [...], "warnings": [...]}; never raises. Empty errors == the package is accepted.

    Checks: all three files present; each validates against its schema; the three describe the same model
    (sha256) and the same blocks/streams. A failed Aspen run (status.state == 'error') is a valid package with a
    warning: the result is shown, flagged untrustworthy.
    """
    errors, warnings = [], []
    for name in PACKAGE_FILES:
        if name not in parts:
            errors.append(f"missing {name}")
    for name, part in parts.items():
        if name not in SCHEMA_OF:
            continue
        probe = part
        if name == "probe-summary.json" and isinstance(part, dict) and "totals_complete" not in part:
            probe = dict(part, totals_complete=_legacy_totals_complete(part))   # summaries from before this field existed
            warnings.append("probe-summary.json has no totals_complete (older probe): derived from energy_gaps / unmatched_block_types")
        try:
            validate(probe, SCHEMA_OF[name])
        except ValueError as exc:
            errors.append(f"{name}: {str(exc).split(': ', 1)[-1]}")
    if errors:
        return {"errors": errors, "warnings": warnings}
    summary, graph, roles = (parts[n] for n in PACKAGE_FILES)
    shas = {"probe-summary.json": summary["model"].get("sha256"), "graph.json": graph["model"].get("sha256"),
            "roles.json": roles.get("model_sha256")}
    if len(set(shas.values())) != 1:
        errors.append("the three files are from different models (sha256 differs: "
                      + ", ".join(f"{k}={str(v)[:12]}" for k, v in shas.items()) + ")")
    graph_blocks = {b["id"] for b in graph["blocks"]}
    graph_streams = {s["id"] for s in graph["streams"]}
    if {b["id"] for b in summary["blocks"]} != graph_blocks:
        errors.append("probe-summary.json blocks differ from graph.json blocks")
    if set(roles["blocks"]) != graph_blocks:
        errors.append("roles.json blocks differ from graph.json blocks")
    if set(roles["streams"]) != graph_streams:
        errors.append("roles.json streams differ from graph.json streams")
    if summary["model"].get("source_unchanged") is False:
        errors.append("probe-summary.json: the source model file changed during the probe (source_unchanged=false)")
    state = summary["status"]["state"]
    if state == "error":
        warnings.append("Aspen reported errors for this run: " + "; ".join(summary["status"]["errors"][:3]))
    elif state == "warning":
        warnings.append("Aspen completed with warnings: " + "; ".join(summary["status"]["warnings"][:3]))
    if roles["review"]["state"] != "confirmed":
        warnings.append(f"roles are '{roles['review']['state']}': confirm product streams and the functional unit before any LCA conclusion")
    return {"errors": errors, "warnings": warnings}


# --------------------------------------------------------------------------------------------- building
def build_package(summary, graph, roles=None):
    """Assemble and validate a package from a probe summary + graph (roles are drafted from the graph if absent)."""
    if roles is None:
        from .classifier import classify
        roles = classify(graph)
    parts = {"probe-summary.json": summary, "graph.json": graph, "roles.json": roles}
    report = validate_package(parts)
    if report["errors"]:
        raise PackageError(report["errors"])
    return parts


def package_from_probe_dir(out_dir):
    """Read what `python -m aspen_study probe` wrote into out_dir (roles.json is drafted when the probe skipped it)."""
    out = Path(out_dir)
    problems = [f"probe wrote no {n}" for n in ("probe-summary.json", "graph.json") if not (out / n).is_file()]
    if problems:
        raise PackageError(problems)
    summary = _parse("probe-summary.json", (out / "probe-summary.json").read_bytes())
    graph = _parse("graph.json", (out / "graph.json").read_bytes())
    roles = _parse("roles.json", (out / "roles.json").read_bytes()) if (out / "roles.json").is_file() else None
    return build_package(summary, graph, roles)


def write_package(out_dir, parts):
    """Write the three files (UTF-8, indent=1, like the probe). Validates first; returns the paths."""
    report = validate_package(parts)
    if report["errors"]:
        raise PackageError(report["errors"])
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    paths = []
    for name in PACKAGE_FILES:
        path = out / name
        path.write_text(json.dumps(parts[name], ensure_ascii=False, indent=1), encoding="utf-8")
        paths.append(path)
    return paths


def zip_bytes(parts):
    """The package as one zip (three members at the root, fixed timestamps, deterministic)."""
    report = validate_package(parts)
    if report["errors"]:
        raise PackageError(report["errors"])
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in PACKAGE_FILES:
            info = zipfile.ZipInfo(name, ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, json.dumps(parts[name], ensure_ascii=False, indent=1).encode("utf-8"))
    return buffer.getvalue()


def describe(parts):
    """One short, UI-friendly summary of a package (what the site shows before analysis)."""
    summary = parts["probe-summary.json"]
    return {"model": summary["model"].get("file"), "sha256": summary["model"].get("sha256"),
            "state": summary["status"]["state"], "blocks": len(summary["blocks"]),
            "streams": len(parts["graph.json"]["streams"]), "totals_kW": copy.deepcopy(summary["totals_kW"])}


# ------------------------------------------------------------------------------------------------- CLI
def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check", help="validate a package folder / zip / one of its files")
    check.add_argument("path")
    pack = sub.add_parser("zip", help="validate a probe output folder and write package.zip")
    pack.add_argument("folder")
    pack.add_argument("-o", "--output", default=None)
    args = parser.parse_args(argv)
    try:
        if args.command == "check":
            parts = read_package(args.path)
            report = validate_package(parts)
        else:
            parts = package_from_probe_dir(args.folder)
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
