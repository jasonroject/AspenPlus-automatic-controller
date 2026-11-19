"""aspen-probe/1.0 -> 1.1 的离线升级（读旧文件用；新体检直接输出 1.1）。

1.1 相对 1.0 的变化（向后兼容地读取 1.0）：
  - 每块 messages[] 拆成 blkmsg（字符串|null）和 per_error[]（字符串数组），另有 per_error_total（真实行数）
  - energy_gaps / unverified_paths 由字符串数组变成 [{block, path, reason}]；unverified_paths 从 discovery 里搬到顶层
  - 每个能量项带 verified: true|false（该节点是否已在真机验证）
  - 新增 group_totals：heating / cooling / shaft_work / internal_exchange / overall，每项 {kW, complete}；overall 不含内部换热
  - totals_complete 必有（1.0 的早期文件缺失时按 energy_gaps / unmatched_block_types 推出）
升级是纯函数：不改输入；来自 1.0 的文件会带 migrated_from，且 blkmsg 的拆分是推断（首行不缩进视为 BLKMSG）。
"""
from __future__ import annotations

import copy

from .adapters import aspen_rules as R

SCHEMA = "aspen-probe/1.1"
LEGACY = "aspen-probe/1"
SKIP_LINES = ("*  WARNING", "*  ERROR")
PER_ERROR_CAP = 12


def group_totals(rows, totals_complete=True):
    """逐块能量行 -> 四类合计，每类 {kW, complete}（kW）。任一成员 kW 为 null 则该类 kW 为 null、complete=false；
    overall = 外部加热 + 外部冷却（负值）+ 轴功的带符号净值，不含 internal_exchange（换热器内部换热，不计入外购）。
    overall 是净值，不是“总能耗”：要比较能耗请用 heating / cooling / shaft_work 分别看。
    totals_complete=false（有读取缺口或未登记块类型）时所有 complete 都为 false。"""
    t = {"heating": 0.0, "cooling": 0.0, "shaft_work": 0.0, "internal_exchange": 0.0}
    broken = set()
    for r in rows:
        for e in r["energy"]:
            if e.get("role_hint") == "exchanged":
                key = "internal_exchange"
            elif e["kind"] == "work":
                key = "shaft_work"
            else:
                key = "heating" if e["value"] >= 0 else "cooling"
            if e["kW"] is None:
                broken.add(key)
            else:
                t[key] += e["kW"]
    out = {k: {"kW": (None if k in broken else round(v, 6)), "complete": bool(totals_complete) and k not in broken} for k, v in t.items()}
    ext = ("heating", "cooling", "shaft_work")
    bad = any(k in broken for k in ext)
    out["overall"] = {"kW": None if bad else round(sum(t[k] for k in ext), 6), "complete": bool(totals_complete) and not bad}
    return out


def _verified_by_recipe(block_type, path):
    recipe = R.recipe_for(block_type)
    if recipe is None:
        return False
    node = str(path).rsplit("\\", 1)[-1]
    for _kind, _hint, nodes, verified in recipe["energy"]:
        if node in nodes:
            return bool(verified)
    return False


def _split_messages(messages):
    lines = [m for m in (messages or []) if str(m).strip() and str(m).strip() not in SKIP_LINES]
    if lines and not lines[0][:1].isspace():
        return lines[0], lines[1:]
    return None, lines


def upgrade_summary(summary):
    """返回 aspen-probe/1.1 结构；已经是 1.1 则原样深拷贝。"""
    s = copy.deepcopy(summary)
    if s.get("schema") == SCHEMA:
        return s
    if s.get("schema") != LEGACY:
        raise ValueError(f"不认识的 probe 版本：{s.get('schema')!r}")
    s["schema"] = SCHEMA
    s["migrated_from"] = LEGACY
    for b in s.get("blocks", []):
        if "messages" in b:
            blkmsg, per_error = _split_messages(b.pop("messages"))
            b["blkmsg"] = blkmsg
            b["per_error"] = per_error
            b["per_error_total"] = None  # 1.0 已按 12 行截断，真实行数未知
        for e in b.get("energy", []):
            if "verified" not in e:
                e["verified"] = _verified_by_recipe(b["type"], e.get("path", ""))
    disc = s.setdefault("discovery", {})
    gaps = [g if isinstance(g, dict) else {"block": None, "path": str(g), "reason": "迁移自 aspen-probe/1（原为字符串）：" + str(g)}
            for g in s.get("energy_gaps", [])]
    s["energy_gaps"] = gaps
    s["unverified_paths"] = [u if isinstance(u, dict) else {"block": None, "path": str(u), "reason": "迁移自 aspen-probe/1（原为字符串）"}
                             for u in disc.pop("unverified_paths", [])]
    if "totals_complete" not in s:
        s["totals_complete"] = not gaps and not disc.get("unmatched_block_types")
    s["group_totals"] = group_totals(s.get("blocks", []), s["totals_complete"])
    return s
