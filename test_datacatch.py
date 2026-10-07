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
        streams.csv    —— 物流温度/压力/流量一览
"""
import argparse
import csv
import json
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
        return float(value)
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
    if node:
        for i in range(node.Elements.Count):
            try:
                names.append(node.Elements.Item(i).Name)
            except Exception:
                pass
    return names


def _capture_quantity(aspen, paths, target, source):
    for path in paths:
        node = aspen.Tree.FindNode(path)
        if node is None:
            continue
        try:
            value = _safe_float(node.Value)
        except Exception:
            continue
        if value is None:
            continue
        try:
            unit = node.UnitString
        except Exception:
            unit = ""
        source[path] = {"value": value, "unit": unit}
        return round(convert_quantity(value, unit, target), 6)
    return None


def capture_block(aspen, bname):
    source = {}
    base = rf"\Data\Blocks\{bname}\Output"
    heat = _capture_quantity(aspen, [base + "\\" + key for key in
        ("QCALC", "DUTY", "UTIL_DUTY")], "kW", source)
    power = _capture_quantity(aspen, [base + "\\" + key for key in
        ("ACT_POWER", "BRAKE_POWER", "POWER", "ELEC_POWER", "IN_POWER", "WNET", "FLUID_POWER")], "kW", source)
    return {"heat_kW": heat, "power_kW": power, "source_quantities": source}


def capture_stream(aspen, sname):
    source = {}
    base = rf"\Data\Streams\{sname}\Output"
    temperature = _capture_quantity(aspen, [base + r"\TEMP_OUT\MIXED"], "C", source)
    pressure = _capture_quantity(aspen, [base + r"\PRES_OUT\MIXED"], "MPa", source)
    flow = _capture_quantity(aspen, [base + r"\MASSFLMX\MIXED"], "kg/h", source)
    composition = {}
    comps_path = base + r"\MASSFLOW\MIXED"
    comps = aspen.Tree.FindNode(comps_path)
    if comps is not None:
        for i in range(comps.Elements.Count):
            child = comps.Elements.Item(i)
            if child is None:
                continue
            value = _capture_quantity(aspen, [comps_path + "\\" + child.Name], "kg/h", source)
            if value is not None:
                composition[child.Name] = value
    return {"temperature_C": temperature, "pressure_MPa": pressure,
            "mass_flow_kg_h": flow, "composition_kg_h": composition,
            "source_quantities": source}


def capture_all(aspen, model_path):
    """对一个已经运行完成的 aspen COM 对象抓取全部设备/物流数据。不负责打开/关闭 Aspen。"""
    block_names = discover_names(aspen, r"\Data\Blocks")
    stream_names = discover_names(aspen, r"\Data\Streams")

    print(f">>> 正在抓取 {len(block_names)} 个设备、{len(stream_names)} 条物流的数据...", flush=True)
    blocks = {bname: capture_block(aspen, bname) for bname in block_names}
    streams = {sname: capture_stream(aspen, sname) for sname in stream_names}
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


def save_results(results, model_path):
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
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
    with streams_csv.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["物流", "温度_C", "压力_MPa", "质量流量_kg_h"])
        for sname, data in results["streams"].items():
            writer.writerow([sname, data["temperature_C"], data["pressure_MPa"], data["mass_flow_kg_h"]])

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


if __name__ == "__main__":
    main()
