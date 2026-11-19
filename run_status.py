"""Run/block status vocabulary shared by batch_runner, the web server and the desktop GUI (no Aspen needed).

status of one batch run:
  ok       Aspen finished, every block BLKSTAT=0, no error/warning messages; results exported
  warning  Aspen finished "with warnings" (BLKSTAT=2 and/or UOSSTAT2=10, e.g. heatrecovery COOLER/REACTOR/VALVE);
           results exported, `blocks[*].messages` and `run_status.warnings` say what Aspen reported
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


def block_fields(info):
    """Per-block status fields from the adapter's run_report()['blocks'][id].

    Same message rule as the probe summary (aspen_study.probe.energy_table): BLKMSG first, then the block's
    PER_ERROR lines without the bare '*  WARNING' / '*  ERROR' severity markers, at most 12.
    """
    messages = ([info["blkmsg"]] if info.get("blkmsg") else []) + [
        m for m in info.get("messages", []) if str(m).strip() and str(m).strip() not in _MARKERS]
    fields = {"status": info.get("state") or "unknown", "blkstat": info.get("blkstat"), "messages": messages[:12]}
    if info.get("note"):
        fields["status_note"] = info["note"]
    return fields
