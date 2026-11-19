"""Aspen Plus 节点规则：纯 Python，不依赖 COM，可在没有 Aspen 的机器上单元测试。

证据标注（2026-11-19，真机 Aspen Plus V15 / Apwn.Document.41.0，heatrecovery.bkp 与示例 mch.bkp）：
  [真机]  = 已在上述模型上读到并核对
  [推断]  = 来自 Aspen 自动化的常见写法，未在真机验证；结果写入 discovery.unverified_paths
"""
from __future__ import annotations

import re

# --------------------------------------------------------------------------- 单位
# 功率/热负荷 -> W。不含卡路里的单位可直接换算；含卡路里的单位必须由调用者声明 1 cal = 4.184 或 4.1868 J
# （与 analysis_web/universal-core.mjs 的规则一致，不替用户选择）。
_W = {"w": 1.0, "watt": 1.0, "kw": 1e3, "kwatt": 1e3, "mw": 1e6, "mwatt": 1e6, "gw": 1e9,
      "j/s": 1.0, "j/sec": 1.0, "kj/s": 1e3, "kj/sec": 1e3, "kj/h": 1e3 / 3600, "kj/hr": 1e3 / 3600,
      "mj/h": 1e6 / 3600, "mj/hr": 1e6 / 3600, "gj/h": 1e9 / 3600, "gj/hr": 1e9 / 3600,
      "btu/h": 1055.05585262 / 3600, "btu/hr": 1055.05585262 / 3600,
      "mmbtu/h": 1055.05585262e6 / 3600, "mmbtu/hr": 1055.05585262e6 / 3600,
      "hp": 745.69987158227, "horsepower": 745.69987158227}
# 单位 -> 每个 cal 的倍数（以 cal/s 为 1）
_CAL = {"cal/s": 1.0, "cal/sec": 1.0, "kcal/s": 1e3, "kcal/sec": 1e3, "kcal/h": 1e3 / 3600, "kcal/hr": 1e3 / 3600,
        "gcal/h": 1e9 / 3600, "gcal/hr": 1e9 / 3600, "mmkcal/h": 1e9 / 3600, "mmkcal/hr": 1e9 / 3600}
CALORIE_J_CHOICES = (4.184, 4.1868)


def _norm_unit(unit):
    return re.sub(r"\s+", "", str(unit or "")).lower()


def to_kW(value, unit, calorie_J=None):
    """返回 (kW 或 None, 说明)。未知单位、缺失值、缺少卡路里约定一律给 None，绝不猜。"""
    if value is None or isinstance(value, bool):
        return None, "无数值"
    u = _norm_unit(unit)
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None, f"数值不可转换：{value!r}"
    if u in _W:
        return number * _W[u] / 1000.0, ""
    if u in _CAL:
        if calorie_J not in CALORIE_J_CHOICES:
            return None, f"单位 {unit} 含卡路里，需用 --calorie-J 明确 4.184 或 4.1868"
        return number * _CAL[u] * calorie_J / 1000.0, f"按 1 cal = {calorie_J} J"
    return None, f"未知能量单位 {unit!r}，未换算（请补充单位映射）"


# --------------------------------------------------------------------------- 块节点配方
# kind: heat / work；role_hint 供 classifier 的 duty_utilities 使用。同一 recipe 内第一个"可读且为标量"的节点生效。
# verified=True 表示该块类型已在真机上读到该节点。
RECIPES = {
    "heater": {"energy": [("heat", None, ["QCALC", "QNET"], True)], "temp": ["B_TEMP"]},                    # [真机]
    "flash2": {"energy": [("heat", None, ["QCALC", "QNET"], True)], "temp": ["B_TEMP"]},                    # [真机]
    "flash3": {"energy": [("heat", None, ["QCALC", "QNET"], False)], "temp": ["B_TEMP"]},                   # [推断]
    "decanter": {"energy": [("heat", None, ["QCALC", "QNET"], False)], "temp": ["B_TEMP"]},                 # [推断]
    "heatx": {"energy": [("heat", "exchanged", ["HX_DUTY", "QCALC"], True)], "temp": []},                   # [真机] HX_DUTY
    "mheatx": {"energy": [("heat", "exchanged", ["QCALC", "HX_DUTY"], False)], "temp": []},                 # [推断]
    "pump": {"energy": [("work", None, ["ELEC_POWER", "BRAKE_POWER", "WNET"], True)], "temp": []},          # [真机] 三个节点均存在
    "compr": {"energy": [("work", None, ["ELEC_POWER", "BRAKE_POWER", "WNET"], False)], "temp": ["B_TEMP"]},   # [推断] 透平为负
    "mcompr": {"energy": [("work", None, ["WNET", "BRAKE_POWER"], False)], "temp": []},                      # [推断]
    "rstoic": {"energy": [("heat", None, ["QCALC", "QNET"], False)], "temp": ["B_TEMP"]},                   # [推断]
    "ryield": {"energy": [("heat", None, ["QCALC", "QNET"], False)], "temp": ["B_TEMP"]},                   # [推断]
    "requil": {"energy": [("heat", None, ["QCALC", "QNET"], False)], "temp": ["B_TEMP"]},                   # [推断]
    "rgibbs": {"energy": [("heat", None, ["QCALC", "QNET"], False)], "temp": ["B_TEMP"]},                   # [推断]
    "rcstr": {"energy": [("heat", None, ["QCALC", "QNET"], False)], "temp": ["B_TEMP"]},                    # [推断]
    "rbatch": {"energy": [("heat", None, ["QCALC", "QNET"], False)], "temp": []},                           # [推断]
    "rplug": {"energy": [("heat", None, ["QCALC", "QNET"], True)], "temp": ["B_TEMP"]},                     # [真机] QCALC；B_TEMP 是剖面，取最后一点
    "radfrac": {"energy": [("heat", "condenser", ["COND_DUTY"], True), ("heat", "reboiler", ["REB_DUTY"], True)],
                "temp": []},                                                                              # [真机] mch.bkp
    "mixer": {"energy": [], "temp": []}, "fsplit": {"energy": [], "temp": []}, "ssplit": {"energy": [], "temp": []},
    "valve": {"energy": [], "temp": []},                                                                    # 绝热，无负荷节点 [真机]
    "sep": {"energy": [("heat", None, ["QCALC", "QNET"], False)], "temp": []},                              # [推断]
    "sep2": {"energy": [("heat", None, ["QCALC", "QNET"], False)], "temp": []},                             # [推断]
}
# 未登记的块类型：只尝试这些通用节点，读不到就留空并记入 unmatched_block_types。
GENERIC_HEAT = ["QCALC", "QNET", "HX_DUTY", "DUTY"]
GENERIC_WORK = ["WNET", "BRAKE_POWER", "ELEC_POWER"]


def recipe_for(model_name):
    return RECIPES.get(str(model_name or "").strip().lower())


# --------------------------------------------------------------------------- 状态分类
# BLKSTAT：0 正常、2 警告  [真机] heatrecovery.bkp：COOLER/REACTOR/VALVE=2，与 .rep 的
# "completed with warnings: COOLER REACTOR VALVE" 完全一致；其余块=0。其他取值没有真机样本，按错误处理（保守）。
BLK_OK, BLK_WARN = (0,), (2,)
# Run-Status UOSSTAT2：8 = 正常（mch.bkp [真机]），10 = 有警告（heatrecovery.bkp [真机]）；9 = 有错误（第三方文档，未在真机见到）。
RUN_OK, RUN_WARN, RUN_ERR = 8, 10, 9

_ERR_LINE = re.compile(r"^\s*\*?\s*(SEVERE\s+)?ERROR\b", re.I)
_WARN_LINE = re.compile(r"^\s*\*\s+WARNING\b", re.I)
_RUN_BLOCK = re.compile(r"the following (unit operation|convergence) blocks were completed with (warnings|errors):\s*(.*?)"
                        r"(?=the following|\Z)", re.I | re.S)


def parse_run_status_lines(lines):
    """解析 Run-Status\\Output\\PER_ERROR 集合的文本行。[真机] 格式：
    'The following Unit Operation blocks were' / 'completed with warnings:' / ' COOLER  REACTOR  VALVE '"""
    text = " ".join(str(x).strip() for x in lines if x is not None)
    out = {"unit_warnings": [], "unit_errors": [], "conv_warnings": [], "conv_errors": [], "text": text}
    for kind, level, names in _RUN_BLOCK.findall(text):
        key = ("unit_" if kind.lower().startswith("unit") else "conv_") + ("warnings" if level.lower() == "warnings" else "errors")
        out[key] += names.split()
    return out


def message_severity(lines):
    """块 PER_ERROR 文本的严重程度：error / warning / None。只看以 '*  ERROR' / '*  WARNING' 起头的行。"""
    sev = None
    for ln in lines or []:
        if _ERR_LINE.match(str(ln)) and str(ln).lstrip().startswith("*"):
            return "error"
        if _WARN_LINE.match(str(ln)):
            sev = "warning"
    return sev


def classify_block(blkstat, messages=None):
    """返回 (state, 说明)；state ∈ ok / warning / error / unknown。"""
    sev = message_severity(messages)
    if blkstat is None:
        return ("error", "块消息含错误") if sev == "error" else ("unknown", "没有 BLKSTAT（块可能未计算）")
    if isinstance(blkstat, bool) or not isinstance(blkstat, (int, float)):
        return "error", f"BLKSTAT 非数值：{blkstat!r}"
    code = int(blkstat)
    if code in BLK_OK:
        return ("error", "BLKSTAT=0 但消息含错误") if sev == "error" else ("ok", "")
    if code in BLK_WARN:
        return ("error", "BLKSTAT=2 且消息含错误") if sev == "error" else ("warning", "")
    return "error", f"BLKSTAT={code}：没有真机样本，按错误处理"


def classify_run(finished, uosstat2, run_lines, blocks):
    """blocks: {id: {"state", "blkstat", "messages", "blkmsg"}}。返回
    {"state": ok|warning|error, "run_completed", "errors": [...], "warnings": [...], "notes": [...]}（中文）。"""
    errors, warnings, notes = [], [], []
    run = parse_run_status_lines(run_lines or [])
    if not finished:
        errors.append("引擎没有正常结束（超时、被停止或 COM 中断）")
    for b in run["unit_errors"]:
        errors.append(f"块 {b}：运行状态报告为 completed with errors")
    for b in run["conv_errors"]:
        errors.append(f"收敛块 {b}：completed with errors")
    for b in run["unit_warnings"]:
        warnings.append(f"块 {b}：completed with warnings")
    for b in run["conv_warnings"]:
        warnings.append(f"收敛块 {b}：completed with warnings")
    for bid, info in blocks.items():
        detail = _first_text(info)
        if info["state"] == "error":
            errors.append(f"块 {bid}：{detail or '错误'}")
        elif info["state"] == "warning":
            msg = f"块 {bid}：{detail}" if detail else f"块 {bid}：警告"
            if not any(w.startswith(f"块 {bid}：") for w in warnings):
                warnings.append(msg)
            else:
                warnings = [msg if w.startswith(f"块 {bid}：") else w for w in warnings]
    if uosstat2 is None:
        notes.append("没有读到 UOSSTAT2，状态仅由块状态与运行消息推断")
    elif uosstat2 == RUN_ERR:
        errors.append("UOSSTAT2=9：运行完成但有错误")
    elif uosstat2 == RUN_WARN:
        if not warnings:
            warnings.append("UOSSTAT2=10：运行完成但有警告（未读到具体块）")
    elif uosstat2 != RUN_OK:
        errors.append(f"UOSSTAT2={uosstat2}：没有真机样本，按错误处理")
    elif warnings or errors:
        notes.append("UOSSTAT2=8 但块级状态有异常，以块级为准")
    state = "error" if errors else ("warning" if warnings else "ok")
    return {"state": state, "run_completed": bool(finished) and state != "error",
            "errors": errors, "warnings": warnings, "notes": notes, "run_status": run}


def _first_text(info):
    if info.get("blkmsg"):
        return str(info["blkmsg"]).strip()
    for ln in info.get("messages") or []:
        s = str(ln).strip().lstrip("*").strip()
        if s and s.upper() not in ("WARNING", "ERROR", "SEVERE ERROR"):
            return s
    return ""
