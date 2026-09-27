"""User-facing names; stable Aspen keys remain the configuration identifiers."""
NAMES = {
    "REAC_TEMP": "反应温度", "TEMP": "温度设定", "PRES": "压力设定",
    "DELP": "压差设定", "DUTY": "热负荷设定", "LENGTH": "长度",
    "DIAM": "直径", "TOTFLOW": "总流量", "MASSFLOW": "质量流量",
    "MOLEFLOW": "摩尔流量", "VFRAC": "汽相分率", "VALUE": "规格值",
    "AREA": "换热面积", "U": "总传热系数", "EFF": "效率",
    "EFFICIENCY": "效率", "P_SPEC": "压力规格方式", "SPEC": "规格方式",
    "FLOWBASE": "流量输入基准", "BASIS": "输入基准",
}


def parameter_name(spec):
    label = spec.get("label", "")
    parts = label.split("/")
    token = parts[0]
    if token == "FLOW":
        # Aspen FLOW can contain a normalized composition, not an absolute flow.
        return "组分输入值" + (" · " + parts[-1] if len(parts) > 1 else "")
    title = NAMES.get(token, token)
    if token == "TEMP" and spec.get("section") == "Streams":
        title = "物流温度"
    if len(parts) > 1:
        title += " · " + "/".join(parts[1:])
    return title


def parameter_title(key, catalog):
    spec = catalog.get(key)
    if not spec:
        return key
    return f"{spec['owner']} · {parameter_name(spec)}"


def column_title(key, catalog):
    spec = catalog.get(key, {})
    unit = spec.get("unit") or "单位待核对"
    return f"{parameter_title(key, catalog)}\n[{unit}]"


def is_common(spec):
    label = spec.get("label", "").split("/")[0]
    return label in NAMES or label == "FLOW" or any('\u4e00' <= ch <= '\u9fff' for ch in label)


def parameter_detail(key, catalog):
    spec = catalog[key]
    notes = ""
    if spec.get("label", "").startswith("FLOW/"):
        notes = "\n组分输入可能采用比例或流量，取决于模型的输入基准。"
    if spec.get("label") == "VALUE":
        notes = "\n规格值的含义取决于该设备当前的规格方式，请在 Aspen 中核对。"
    return (f"{parameter_title(key, catalog)}  |  模型原值：{spec.get('value')}  |  "
            f"单位：{spec.get('unit') or '模型未提供，请核对'}\n"
            f"参数标识：{key}\nAspen 路径：{spec.get('path', '')}{notes}")
