"""数据抓取/导出模块：把 Aspen 计算结果落盘为 JSON + CSV。

两种用法：
1. 独立运行（自己开 Aspen、跑完再抓取）：
       py automatic/test_datacatch.py [模型.bkp路径]
2. 被子脚本作为模块调用（子脚本已经跑完 Engine.Run()，直接传入 aspen 对象）：
       import test_datacatch as datacatch
       results = datacatch.capture_all(aspen, MODEL_PATH)
       datacatch.save_results(results, MODEL_PATH)

输出文件写入：
    automatic/outputdata/<模型名>/<时间戳>/
        results.json   —— 完整结构化数据（设备 + 物流 + 组分）
        blocks.csv     —— 设备热负荷/电耗一览
        streams.csv    —— 物流温度/压力/总流量及全部组分质量流量
        stream_components.csv —— 各物流、子物流的全部组分流量与分率
"""
import argparse
import csv
import json
import math
import sys
from datetime import datetime
from pathlib import Path
from result_units import convert_quantity
from aspen_connection import create_aspen_document

try:
    import pythoncom
    import win32com.client as win32
except ImportError:
    print("缺少 pywin32，请先运行：py -3 -m pip install pywin32")
    sys.exit(1)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_PATH = Path(r"C:\Users\Administrator\Documents\Codex\2026-09-16\project1jason\aspenmodel\heatrecovery.bkp")
OUTPUT_ROOT = Path(__file__).resolve().parent / "outputdata"


def _safe_float(value):
    try:
        if value is None:
            return None
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def resolve_block_heat(aspen, bname):
    candidates = [
        rf"\Data\Blocks\{bname}\Output\QCALC",
        rf"\Data\Blocks\{bname}\Output\DUTY",
        rf"\Data\Blocks\{bname}\Output\UTIL_DUTY",
    ]
    for path in candidates:
        node = aspen.Tree.FindNode(path)
        value = _safe_float(getattr(node, "Value", None))
        if value is not None:
            return value
    return None


def resolve_block_power(aspen, bname):
    # Aspen 该字段单位即为 kW（非瓦特），不要再除以 1000
    candidates = [
        rf"\Data\Blocks\{bname}\Output\ACT_POWER",
        rf"\Data\Blocks\{bname}\Output\BRAKE_POWER",
        rf"\Data\Blocks\{bname}\Output\POWER",
        rf"\Data\Blocks\{bname}\Output\ELEC_POWER",
        rf"\Data\Blocks\{bname}\Output\IN_POWER",
        rf"\Data\Blocks\{bname}\Output\WNET",
        rf"\Data\Blocks\{bname}\Output\FLUID_POWER",
    ]
    for path in candidates:
        node = aspen.Tree.FindNode(path)
        value = _safe_float(getattr(node, "Value", None))
        if value is not None:
            return value
    return None


def discover_names(aspen, base_path):
    node = aspen.Tree.FindNode(base_path)
    names = []
    if node is not None:
        for i in range(node.Elements.Count):
            try:
                names.append(node.Elements.Item(i).Name)
            except Exception as exc:
                raise RuntimeError(f"无法完整枚举 {base_path}，第 {i + 1} 个节点读取失败") from exc
    return names


def _read_quantity(node, path, target, source):
    try:
        value = _safe_float(node.Value)
    except Exception:
        return None
    if value is None:
        return None
    try:
        unit = node.UnitString
    except Exception:
        unit = ""
    source[path] = {"value": value, "unit": unit}
    # Keep trace components: rounding to six decimals can turn a real flow into 0.
    return convert_quantity(value, unit, target)


def _capture_quantity(aspen, paths, target, source):
    for path in paths:
        node = aspen.Tree.FindNode(path)
        if node is None:
            continue
        value = _read_quantity(node, path, target, source)
        if value is not None:
            return value
    return None


def capture_block(aspen, bname):
    source = {}
    base = rf"\Data\Blocks\{bname}\Output"
    heat = _capture_quantity(aspen, [base + "\\" + key for key in
        ("QCALC", "DUTY", "UTIL_DUTY")], "kW", source)
    power = _capture_quantity(aspen, [base + "\\" + key for key in
        ("ACT_POWER", "BRAKE_POWER", "POWER", "ELEC_POWER", "IN_POWER", "WNET", "FLUID_POWER")], "kW", source)
    return {"heat_kW": heat, "power_kW": power, "source_quantities": source}


def _children(node):
    if node is None:
        return []
    children = []
    for i in range(node.Elements.Count):
        child = node.Elements.Item(i)
        if child is not None:
            children.append(child)
    return children


COMPONENT_FIELDS = {
    "composition_kg_h": ("MASSFLOW", "kg/h"),
    "composition_kmol_h": ("MOLEFLOW", "kmol/h"),
    "mass_fraction": ("MASSFRAC", "fraction"),
    "mole_fraction": ("MOLEFRAC", "fraction"),
}


def _complete_sum(values):
    return (math.fsum(values) if values and all(v is not None for v in values)
            else None)


def capture_stream(aspen, sname, component_ids=None):
    source = {}
    warnings = []
    base = rf"\Data\Streams\{sname}\Output"
    temperature = _capture_quantity(aspen, [base + r"\TEMP_OUT\MIXED"], "C", source)
    pressure = _capture_quantity(aspen, [base + r"\PRES_OUT\MIXED"], "MPa", source)
    # MIXED is a material substream, not a synonym for all material in a stream.
    # Discover actual substreams (including solids) instead of assuming MIXED.
    fields = dict(COMPONENT_FIELDS)
    fields.update(mass_flow_kg_h=("MASSFLMX", "kg/h"),
                  mole_flow_kmol_h=("MOLEFLMX", "kmol/h"))
    substreams = {}
    for field, (token, unit) in fields.items():
        for sub in _children(aspen.Tree.FindNode(base + "\\" + token)):
            subname = str(sub.Name)
            record = substreams.setdefault(subname, {"component_ids": []})
            path = base + "\\" + token + "\\" + subname
            if field in COMPONENT_FIELDS:
                values = record.setdefault(field, {})
                for child in _children(sub):
                    comp = str(child.Name)
                    if comp not in record["component_ids"]:
                        record["component_ids"].append(comp)
                    try:
                        values[comp] = _read_quantity(child, path + "\\" + comp, unit, source)
                    except ValueError as exc:
                        values[comp] = None
                        warnings.append(str(exc) + "：" + path + "\\" + comp)
            else:
                try:
                    record[field] = _read_quantity(sub, path, unit, source)
                except ValueError as exc:
                    record[field] = None
                    warnings.append(str(exc) + "：" + path)

    ids = list(dict.fromkeys(list(component_ids or []) + [comp
        for sub in substreams.values() for comp in sub["component_ids"]]))
    for sub in substreams.values():
        for field in COMPONENT_FIELDS:
            values = sub.setdefault(field, {})
            for comp in sub["component_ids"]:
                values.setdefault(comp, None)

    totals = {}
    for field in ("composition_kg_h", "composition_kmol_h"):
        totals[field] = {comp: _complete_sum([sub[field].get(comp)
            for sub in substreams.values() if comp in sub["component_ids"]]) for comp in ids}
    flow = _complete_sum([sub.get("mass_flow_kg_h") for sub in substreams.values()])
    mole_flow = _complete_sum([sub.get("mole_flow_kmol_h") for sub in substreams.values()])
    for field, total_field, total_flow in (
            ("mass_fraction", "composition_kg_h", flow),
            ("mole_fraction", "composition_kmol_h", mole_flow)):
        if len(substreams) == 1:
            reported = next(iter(substreams.values()))[field]
            totals[field] = {comp: reported.get(comp) for comp in ids}
        else:
            totals[field] = {comp: value / total_flow
                if value is not None and total_flow is not None and total_flow > 0 else None
                for comp, value in totals[total_field].items()}
    missing = [comp for comp in ids if totals["composition_kg_h"][comp] is None]
    status = "complete" if ids and not missing else "partial" if substreams else "no_component_output"
    # Heat/work streams remain in the export, without invented zero compositions.
    if not substreams:
        totals = {field: {} for field in COMPONENT_FIELDS}
    return {"temperature_C": temperature, "pressure_MPa": pressure,
            "mass_flow_kg_h": flow, "mole_flow_kmol_h": mole_flow, **totals,
            "component_ids": ids if substreams else [], "substreams": substreams,
            "component_data_status": status, "missing_mass_components": missing if substreams else [],
            "extraction_warnings": warnings, "source_quantities": source}


def capture_all(aspen, model_path):
    """对一个已经运行完成的 aspen COM 对象抓取全部设备/物流数据。不负责打开/关闭 Aspen。"""
    block_names = discover_names(aspen, r"\Data\Blocks")
    stream_names = discover_names(aspen, r"\Data\Streams")
    component_ids = discover_names(aspen, r"\Data\Components\Specifications\Input\TYPE")

    print(f">>> 正在抓取 {len(block_names)} 个设备、{len(stream_names)} 条物流的数据...", flush=True)
    blocks = {bname: capture_block(aspen, bname) for bname in block_names}
    streams = {sname: capture_stream(aspen, sname, component_ids) for sname in stream_names}
    component_ids = list(dict.fromkeys(component_ids + [comp
        for stream in streams.values() for comp in stream["component_ids"]]))
    run_status = {}
    for key in ("RSTAT", "UOSSTAT", "UOSSTAT2", "PER_ERROR", "CVSTAT", "ITSTAT"):
        try:
            node = aspen.Tree.FindNode(r"\Data\Results Summary\Run-Status\Output" + "\\" + key)
            if node is not None:
                run_status[key] = node.Value
        except Exception:
            pass

    return {
        "model_path": str(model_path),
        "captured_at": datetime.now().isoformat(timespec="seconds"),
        "unit_conversion": "node-unit-aware-v1",
        "component_export": "all-stream-components-v1",
        "component_ids": component_ids,
        "aspen_run_status": run_status,
        "blocks": blocks,
        "streams": streams,
    }


def run_and_capture(model_path):
    """独立运行：自己打开 Aspen、Reinit+Run、抓取数据、关闭 Aspen。用于本模块单独调试。"""
    pythoncom.CoInitialize()
    aspen = None
    try:
        aspen = create_aspen_document()
        aspen.InitFromArchive2(str(model_path))
        aspen.Visible = 0
        aspen.SuppressDialogs = 1

        print(">>> 重置运行环境...", flush=True)
        aspen.Engine.Reinit()

        print(">>> 开始运行 Aspen 模拟计算...", flush=True)
        aspen.Engine.Run()

        return capture_all(aspen, model_path)
    finally:
        if aspen is not None:
            aspen.Close(False)
        pythoncom.CoUninitialize()


COMPONENT_CSV_HEADER = ["物流", "子物流", "组分", "质量流量_kg_h", "摩尔流量_kmol_h",
                        "质量分率", "摩尔分率", "质量流量读取状态"]


def exported_component_ids(streams, component_ids=()):
    return list(dict.fromkeys(list(component_ids) + [comp
        for stream in streams.values() for field in COMPONENT_FIELDS
        for comp in stream.get(field, {})]))


def component_rows(streams, component_ids=()):
    """Long-form TOTAL and per-substream records; absent data stays blank.

    TOTAL already sums the material substreams. It must not be added to its
    own substream rows when processing this CSV.
    """
    ids = exported_component_ids(streams, component_ids)
    for sname, stream in streams.items():
        if not any(stream.get(field) for field in COMPONENT_FIELDS) and not stream.get("substreams"):
            yield [sname, "", "", None, None, None, None, "无组分输出"]
            continue
        groups = [("TOTAL", stream, ids)] + [(name, sub, sub.get("component_ids", []))
            for name, sub in stream.get("substreams", {}).items()]
        for subname, data, components in groups:
            for comp in components:
                values = [data.get(field, {}).get(comp) for field in COMPONENT_FIELDS]
                yield [sname, subname, comp, *values,
                       "已读取" if values[0] is not None else "未返回"]


def write_component_csv(path, streams, component_ids=()):
    with Path(path).open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(COMPONENT_CSV_HEADER)
        writer.writerows(component_rows(streams, component_ids))


def save_results(results, model_path):
    model_path = Path(model_path)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    out_dir = OUTPUT_ROOT / model_path.stem / timestamp
    out_dir.mkdir(parents=True, exist_ok=True)

    json_path = out_dir / "results.json"
    json_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    blocks_csv = out_dir / "blocks.csv"
    with blocks_csv.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["设备", "热负荷_kW", "电耗_kW"])
        for bname, data in results["blocks"].items():
            writer.writerow([bname, data["heat_kW"], data["power_kW"]])

    streams_csv = out_dir / "streams.csv"
    components = exported_component_ids(results["streams"], results.get("component_ids", []))
    with streams_csv.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["物流", "温度_C", "压力_MPa", "质量流量_kg_h", "摩尔流量_kmol_h",
                         "组分提取状态"] + [f"组分.{comp}.质量流量_kg_h" for comp in components])
        for sname, data in results["streams"].items():
            writer.writerow([sname, data["temperature_C"], data["pressure_MPa"], data["mass_flow_kg_h"],
                             data.get("mole_flow_kmol_h"), data.get("component_data_status", "")]
                            + [data.get("composition_kg_h", {}).get(comp) for comp in components])

    write_component_csv(out_dir / "stream_components.csv", results["streams"], components)

    return json_path, blocks_csv, streams_csv


def main():
    parser = argparse.ArgumentParser(description="运行 Aspen 模型并抓取/导出计算结果数据")
    parser.add_argument(
        "model_path",
        nargs="?",
        type=Path,
        default=DEFAULT_MODEL_PATH,
        help="Aspen .bkp 文件路径；不填写时使用项目中的标准模型",
    )
    args = parser.parse_args()
    model_path = args.model_path.expanduser().resolve()

    if not model_path.exists():
        raise FileNotFoundError(f"找不到 Aspen 模型：{model_path}")

    results = run_and_capture(model_path)
    json_path, blocks_csv, streams_csv = save_results(results, model_path)

    print("\n" + "=" * 25 + " 数据抓取完成 " + "=" * 25)
    print(f"结构化数据（JSON）：{json_path}")
    print(f"设备数据（CSV）：{blocks_csv}")
    print(f"物流数据（CSV）：{streams_csv}")
    print(f"全部组分（CSV）：{streams_csv.parent / 'stream_components.csv'}")


if __name__ == "__main__":
    main()
