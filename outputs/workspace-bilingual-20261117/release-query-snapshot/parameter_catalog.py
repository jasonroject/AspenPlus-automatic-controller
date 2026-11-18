"""Discover model input leaves and build reproducible multi-parameter cases.

Values use the model's native node units. Discovery never writes to Aspen.
An input leaf is a candidate; writability is checked when applying a case.
"""
import itertools
import math


def discover_parameters(aspen):
    catalog = {}
    for section in ("Blocks", "Streams"):
        root = aspen.Tree.FindNode("\\Data\\" + section)
        if root is None:
            continue
        for i in range(root.Elements.Count):
            owner = root.Elements.Item(i).Name
            base = f"\\Data\\{section}\\{owner}\\Input"
            node = aspen.Tree.FindNode(base)
            if node is not None:
                _walk(node, base, [], section, owner, catalog)
    return catalog


def _walk(node, path, parts, section, owner, catalog):
    try:
        count = node.Elements.Count
    except Exception:
        count = 0
    if count:
        for i in range(count):
            child = node.Elements.Item(i)
            if child is None:
                continue
            name = str(child.Name)
            _walk(child, path + "\\" + name, parts + [name], section, owner, catalog)
        return
    try:
        value = node.Value
    except Exception:
        return
    if not parts or value is None or isinstance(value, bool):
        return
    if not isinstance(value, (int, float, str)):
        return
    if isinstance(value, (int, float)) and not math.isfinite(value):
        return
    try:
        unit = str(node.UnitString or "")
    except Exception:
        unit = ""
    key = f"{section}.{owner}." + "/".join(parts)
    catalog[key] = dict(path=path, value=value, unit=unit, section=section,
                        owner=owner, label="/".join(parts))


def legacy_catalog(blocks):
    result = {}
    for owner, block in blocks.items():
        for label, leaf in block.get("_nodes", {}).items():
            result[f"{owner}.{label}"] = dict(
                path=f"\\Data\\Blocks\\{owner}\\Input\\{leaf}",
                value=block.get("params", {}).get(label), unit="",
                section="Blocks", owner=owner, label=label)
    return result


def build_cases(rules, mode="linked", baseline=None, max_cases=10000):
    """Linked rules zip (singletons broadcast); factorial rules form a product."""
    if not rules or any(not values for values in rules.values()):
        raise ValueError("请选择参数并填写每个参数的取值")
    if mode not in ("linked", "factorial"):
        raise ValueError("未知扫描模式")
    lengths = [len(values) for values in rules.values()]
    count = max(lengths) if mode == "linked" else math.prod(lengths)
    if count > max_cases:
        raise ValueError(f"将生成 {count} 组，超过上限 {max_cases}；请缩小范围")
    if mode == "linked":
        if any(n not in (1, count) for n in lengths):
            raise ValueError("同步变化时，各参数取值个数须相同，或只有一个固定值")
        rows = zip(*(values * count if len(values) == 1 else values
                     for values in rules.values()))
    else:
        rows = itertools.product(*rules.values())
    return [dict(baseline or {}, **dict(zip(rules, row))) for row in rows]


def coerce_value(value, reference=None):
    if isinstance(reference, str):
        return str(value)
    try:
        number = float(value)
    except (TypeError, ValueError):
        if isinstance(reference, (int, float)):
            raise ValueError(f"需要数值，收到 {value!r}")
        return value
    if not math.isfinite(number):
        raise ValueError("参数不能是 NaN 或无穷大")
    return number


def apply_parameters(aspen, catalog, parameters):
    """Preflight all keys, then set and read back; never run a partial case."""
    pending = []
    paths = set()
    for key, raw in parameters.items():
        if key not in catalog:
            raise ValueError(f"未知参数：{key}；请重新扫描模型或检查表头")
        spec = catalog[key]
        path = spec["path"]
        if path in paths:
            raise ValueError(f"同一节点被重复指定：{key}")
        paths.add(path)
        node = aspen.Tree.FindNode(path)
        if node is None:
            raise ValueError(f"参数节点不存在：{key} ({path})")
        pending.append((key, node, coerce_value(raw, node.Value)))
    actual = {}
    for key, node, value in pending:
        try:
            node.Value = value
        except Exception as exc:
            raise ValueError(f"参数写入失败：{key}: {exc}") from exc
    # Read after all writes: one parameter can alter another parameter's state.
    for key, node, value in pending:
        readback = node.Value
        same = (math.isclose(float(readback), value, rel_tol=1e-7, abs_tol=1e-9)
                if isinstance(value, (int, float)) else str(readback) == str(value))
        if not same:
            raise ValueError(f"参数回读不一致：{key}，请求 {value}，实际 {readback}")
        actual[key] = readback
    return actual
