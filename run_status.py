"""Run/block status vocabulary shared by batch_runner, the web server and the desktop GUI (no Aspen needed).

status of one batch run:
  ok       Aspen finished, every block BLKSTAT=0, no error/warning messages; results exported
  warning  Aspen finished "with warnings" (BLKSTAT=2 and/or UOSSTAT2=10, e.g. heatrecovery COOLER/REACTOR/VALVE);
           results exported, `blocks[*].blkmsg` / `per_error` and `run_status.warnings` say what Aspen reported
  error    the run did not finish cleanly or Aspen reported errors / unknown status codes; or any failure before
           the run (open, parameter write, ...). `error` carries the reason
  timeout  Aspen exceeded the time limit (--timeout); the engine was stopped, no results
  stopped  the run was stopped on request while Aspen was calculating; no results
  skipped  the batch was stopped before this row started
Rules for BLKSTAT / UOSSTAT2 live in aspen_study.adapters.aspen_rules (verified on heatrecovery.bkp).
"""
STATUSES = ("ok", "warning", "error", "timeout", "stopped", "skipped")
EXPORTED = ("ok", "warning")
LEGACY = {"success": "ok", "failed": "error"}      # summaries written before 2026-11-19
LABELS = {"ok": "已导出", "warning": "已导出（有警告）", "error": "失败", "timeout": "超时", "stopped": "已停止", "skipped": "未执行"}


def normalize(status):
    return LEGACY.get(status, status)


def is_exported(status):
    """True when the run produced exported results (ok or warning)."""
    return normalize(status) in EXPORTED


def label(status):
    return LABELS.get(normalize(status), str(status))


def counts(results):
    """{status: n} plus the legacy success/failed totals (success = exported with or without warnings)."""
    out = {name: 0 for name in STATUSES}
    for result in results:
        status = normalize(result.get("status"))
        out[status] = out.get(status, 0) + 1
    out["success_count"] = out["ok"] + out["warning"]
    out["failed_count"] = len(results) - out["success_count"]
    return out


_MARKERS = ("*  WARNING", "*  ERROR")
PER_ERROR_CAP = 12


def block_fields(info):
    """Per-block status fields (the aspen-probe/1.1 block shape) from the adapter's run_report()['blocks'][id].

        status           ok / warning / error / unknown, derived from BLKSTAT (+ error text); BLKSTAT 2 = warning
        blkstat          the raw BLKSTAT code or None
        blkmsg           Aspen's one-line block message (BLKMSG) or None
        per_error        the block's PER_ERROR lines without the bare '*  WARNING' / '*  ERROR' markers, at most 12
        per_error_total  how many such lines there really were

    Identical to aspen_study.probe.energy_table, so a batch row and probe-summary.json describe a block the same way.
    """
    lines = [m for m in info.get("messages", []) if str(m).strip() and str(m).strip() not in _MARKERS]
    blkmsg = (info.get("blkmsg") or "").strip() or None
    fields = {"status": info.get("state") or "unknown", "blkstat": info.get("blkstat"), "blkmsg": blkmsg,
              "per_error": lines[:PER_ERROR_CAP], "per_error_total": len(lines)}
    if info.get("note"):
        fields["status_note"] = info["note"]
    return fields


def block_messages(block):
    """All of a block's Aspen messages as one list, for display/CSV: [blkmsg] + per_error.

    Read-compat for one version: batch results written before 2026-11-19 carry a flat `messages` list instead of
    `blkmsg` + `per_error`; it is returned as is when the new fields are absent. Writers no longer emit `messages`.
    """
    if "blkmsg" in block or "per_error" in block:
        return ([block["blkmsg"]] if block.get("blkmsg") else []) + list(block.get("per_error") or [])
    return [m for m in block.get("messages", []) if str(m).strip()]
