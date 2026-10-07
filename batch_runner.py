"""批处理运行模块：自动运行多组参数变量，收集并汇总数据。

使用方法：
    1. 生成批处理配置模板：
       py automatic/batch_runner.py generate-template generated/<模型名>_control.py

    2. 编辑生成的 *_batch_config.json，设置变量组合

    3. 运行批处理：
       py automatic/batch_runner.py run generated/<模型名>_batch_config.json

输出：
    - 每次运行的结果保存到 outputdata/<模型名>/<时间戳>/
    - 批处理汇总保存到 outputdata/<模型名>/batch_<批次时间戳>/
"""
import argparse
import csv
import json
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

try:
    import pythoncom
    import win32com.client as win32
except ImportError:
    print("缺少 pywin32，请先运行：py -3 -m pip install pywin32")
    sys.exit(1)

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_datacatch as datacatch
from parameter_catalog import legacy_catalog, apply_parameters
from aspen_connection import create_aspen_document

OUTPUT_ROOT = Path(__file__).resolve().parent / "outputdata"


class BatchRunner:
    """批处理运行器：管理多组参数的自动运行"""

    def __init__(self, model_path: Path, blocks_config: Dict, streams_config: List[str], parameter_catalog=None):
        self.model_path = Path(model_path)
        self.blocks_config = blocks_config
        self.streams_config = streams_config
        self.parameter_catalog = parameter_catalog or legacy_catalog(blocks_config)
        self.batch_results = []
        self.batch_id = datetime.now().strftime("%Y%m%d-%H%M%S")

    def set_parameters(self, aspen, param_set: Dict[str, Any]):
        actual = apply_parameters(aspen, self.parameter_catalog, param_set)
        for key, value in actual.items():
            print(f"    [已设置并回读] {key} = {value}")
        return actual

    def run_single(self, param_set: Dict[str, Any], run_index: int, run_name: Optional[str] = None) -> Dict:
        run_name = run_name or f"Run_{run_index}"
        print("\n" + "=" * 80)
        print(f"批处理进度：[{run_index}] {run_name}")
        print("=" * 80)

        pythoncom.CoInitialize()
        aspen = None
        result = {
            "run_index": run_index,
            "run_name": run_name,
            "parameters": param_set.copy(),
            "status": "failed",
            "error": None,
            "blocks": {},
            "streams": {},
            "timestamp": None,
        }

        try:
            aspen = create_aspen_document()
            aspen.InitFromArchive2(str(self.model_path))
            aspen.Visible = 0
            aspen.SuppressDialogs = 1

            print(">>> [1/5] 重置运行环境...")
            aspen.Engine.Reinit()

            print(">>> [2/5] 设置参数...")
            result["applied_parameters"] = self.set_parameters(aspen, param_set)

            print(">>> [3/5] 开始运行 Aspen 模拟计算...")
            start_time = time.time()
            aspen.Engine.Run()
            elapsed_time = time.time() - start_time
            print(f"    计算完成，用时 {elapsed_time:.1f} 秒")

            print(">>> [4/5] 抓取计算结果...")
            capture = datacatch.capture_all(aspen, self.model_path)

            print(">>> [5/5] 保存结果文件...")
            json_path, blocks_csv, streams_csv = datacatch.save_results(capture, self.model_path)
            print(f"    结果已保存：{json_path.parent}")

            result["status"] = "success"
            result["blocks"] = capture["blocks"]
            result["streams"] = capture["streams"]
            result["component_ids"] = capture.get("component_ids", [])
            result["component_export"] = capture.get("component_export")
            result["component_csv"] = str(json_path.parent / "stream_components.csv")
            result["aspen_run_status"] = capture.get("aspen_run_status", {})
            result["status_scope"] = "parameter-write-run-export; convergence not independently certified"
            result["timestamp"] = capture["captured_at"]
            result["elapsed_time_seconds"] = round(elapsed_time, 2)
            result["output_dir"] = str(json_path.parent)

            print(f"\n>>> 运行 [{run_name}] 完成")
            self._print_brief_summary(result)

        except Exception as error:
            result["status"] = "failed"
            result["error"] = str(error)
            result["traceback"] = traceback.format_exc()
            print(f"\n[错误] 运行 [{run_name}] 失败：{error}")

        finally:
            try:
                if aspen is not None:
                    try:
                        aspen.Close(False)
                    except Exception as close_error:
                        result["cleanup_warning"] = str(close_error)
            finally:
                pythoncom.CoUninitialize()

        return result

    def _print_brief_summary(self, result: Dict):
        print("    关键设备结果：")
        for bname, data in list(result["blocks"].items())[:5]:
            heat = data.get("heat_kW")
            power = data.get("power_kW")
            heat_str = f"{heat:.2f} kW" if heat is not None else "无"
            power_str = f"{power:.2f} kW" if power is not None else "无"
            print(f"      [{bname}] 热负荷={heat_str}, 电耗={power_str}")

        if len(result["blocks"]) > 5:
            print(f"      ... (共 {len(result['blocks'])} 个设备)")

    def run_batch(self, param_sets: List[Dict[str, Any]], run_names: Optional[Sequence[Optional[str]]] = None) -> List[Dict]:
        total = len(param_sets)
        print("\n" + "=" * 80)
        print(f"批处理任务：共 {total} 组参数")
        print(f"批次 ID：{self.batch_id}")
        print("=" * 80)

        resolved_run_names: Sequence[Optional[str]] = run_names if run_names is not None else [None] * total

        if len(resolved_run_names) != total:
            raise ValueError("工况名称数量与参数组数量不一致")
        self.batch_results = []
        success_count = 0
        failed_count = 0

        batch_start_time = time.time()

        for i, (param_set, run_name) in enumerate(zip(param_sets, resolved_run_names), start=1):
            result = self.run_single(param_set, i, run_name)
            self.batch_results.append(result)

            if result["status"] == "success":
                success_count += 1
            else:
                failed_count += 1

        batch_elapsed_time = time.time() - batch_start_time

        print("\n" + "=" * 80)
        print(f"批处理完成！总用时：{batch_elapsed_time/60:.1f} 分钟")
        print(f"成功：{success_count}/{total}，失败：{failed_count}/{total}")
        print("=" * 80)

        return self.batch_results

    def save_batch_summary(self) -> tuple:
        batch_dir = OUTPUT_ROOT / self.model_path.stem / f"batch_{self.batch_id}"
        batch_dir.mkdir(parents=True, exist_ok=True)

        summary_json = batch_dir / "batch_summary.json"
        summary_data = {
            "batch_id": self.batch_id,
            "model_path": str(self.model_path),
            "total_runs": len(self.batch_results),
            "success_count": sum(1 for r in self.batch_results if r["status"] == "success"),
            "failed_count": sum(1 for r in self.batch_results if r["status"] == "failed"),
            "results": self.batch_results,
        }
        summary_json.write_text(json.dumps(summary_data, ensure_ascii=False, indent=2), encoding="utf-8")

        (batch_dir / "batch_config.json").write_text(json.dumps({
            "model_path": str(self.model_path),
            "parameter_catalog": self.parameter_catalog,
            "parameter_sets": [{"_name": r["run_name"], "parameters": r["parameters"]}
                               for r in self.batch_results],
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        summary_csv = batch_dir / "batch_summary.csv"
        self._generate_summary_csv(summary_csv)
        self._generate_component_csv(batch_dir / "batch_stream_components.csv")

        print(f"\n>>> 批处理汇总已保存：")
        print(f"    JSON: {summary_json}")
        print(f"    CSV:  {summary_csv}")
        print(f"    目录: {batch_dir}")

        return summary_json, summary_csv, batch_dir

    def _generate_summary_csv(self, csv_path: Path):
        if not self.batch_results:
            return

        all_param_keys = set()
        all_block_names = set()
        all_stream_names = set()
        all_component_ids = set()

        for result in self.batch_results:
            all_param_keys.update(result["parameters"].keys())
            all_block_names.update(result["blocks"].keys())
            all_stream_names.update(result["streams"].keys())
            all_component_ids.update(datacatch.exported_component_ids(
                result["streams"], result.get("component_ids", [])))

        all_param_keys = sorted(all_param_keys)
        all_block_names = sorted(all_block_names)
        all_stream_names = sorted(all_stream_names)
        all_component_ids = sorted(all_component_ids)

        header = ["运行序号", "运行名称", "状态", "用时(秒)", "错误"]
        header.extend([f"参数.{k}" for k in all_param_keys])
        header.extend([f"设备.{b}.热负荷_kW" for b in all_block_names])
        header.extend([f"设备.{b}.电耗_kW" for b in all_block_names])
        header.extend([f"物流.{s}.温度_C" for s in all_stream_names])
        header.extend([f"物流.{s}.压力_MPa" for s in all_stream_names])
        header.extend([f"物流.{s}.流量_kg_h" for s in all_stream_names])
        header.extend([f"物流.{s}.组分.{comp}.质量流量_kg_h"
                       for s in all_stream_names for comp in all_component_ids])

        with csv_path.open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(header)

            for result in self.batch_results:
                row = [
                    result["run_index"],
                    result["run_name"],
                    result["status"],
                    result.get("elapsed_time_seconds", ""),
                    result.get("error") or "",
                ]

                for k in all_param_keys:
                    row.append(result["parameters"].get(k, ""))

                for b in all_block_names:
                    block_data = result["blocks"].get(b, {})
                    row.append(block_data.get("heat_kW", ""))

                for b in all_block_names:
                    block_data = result["blocks"].get(b, {})
                    row.append(block_data.get("power_kW", ""))

                for s in all_stream_names:
                    stream_data = result["streams"].get(s, {})
                    row.append(stream_data.get("temperature_C", ""))

                for s in all_stream_names:
                    stream_data = result["streams"].get(s, {})
                    row.append(stream_data.get("pressure_MPa", ""))

                for s in all_stream_names:
                    stream_data = result["streams"].get(s, {})
                    row.append(stream_data.get("mass_flow_kg_h", ""))

                for s in all_stream_names:
                    composition = result["streams"].get(s, {}).get("composition_kg_h", {})
                    row.extend(composition.get(comp) for comp in all_component_ids)

                writer.writerow(row)

    def _generate_component_csv(self, csv_path):
        components = sorted({comp for result in self.batch_results
            for comp in datacatch.exported_component_ids(result["streams"], result.get("component_ids", []))})
        with Path(csv_path).open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["运行序号", "运行名称", "运行状态"] + datacatch.COMPONENT_CSV_HEADER)
            for result in self.batch_results:
                prefix = [result["run_index"], result["run_name"], result["status"]]
                if not result["streams"]:
                    writer.writerow(prefix + ["", "", "", None, None, None, None, "无结果"])
                else:
                    for row in datacatch.component_rows(result["streams"], components):
                        writer.writerow(prefix + row)


def generate_batch_template(control_script_path: Path):
    import importlib.util
    spec = importlib.util.spec_from_file_location("control_module", control_script_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"无法加载控制脚本：{control_script_path}")
    control_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(control_module)

    blocks_config = control_module.BLOCKS_CONFIG
    model_path = control_module.MODEL_PATH

    available_params = []
    for block_name, block_data in blocks_config.items():
        param_nodes = block_data.get("_nodes", {})
        params = block_data.get("params", {})

        for param_name, param_value in params.items():
            if param_name in param_nodes:
                available_params.append({
                    "key": f"{block_name}.{param_name}",
                    "description": f"{block_name} 的 {param_name}",
                    "current_value": param_value,
                    "aspen_node": param_nodes[param_name],
                })

    template = {
        "_info": "批处理配置文件模板",
        "_usage": "修改 parameter_sets 中的参数值，每个字典代表一次运行",
        "model_path": str(model_path),
        "control_script": str(control_script_path),
        "available_parameters": available_params,
        "parameter_sets": [
            {
                "_name": "基准工况",
                "parameters": {p["key"]: p["current_value"] for p in available_params[:3] if p["current_value"] is not None}
            },
            {
                "_name": "变化工况1",
                "parameters": {p["key"]: p["current_value"] for p in available_params[:3] if p["current_value"] is not None}
            },
            {
                "_name": "变化工况2",
                "parameters": {p["key"]: p["current_value"] for p in available_params[:3] if p["current_value"] is not None}
            },
        ]
    }

    template_path = control_script_path.parent / f"{model_path.stem}_batch_config.json"
    template_path.write_text(json.dumps(template, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"✓ 批处理配置模板已生成：{template_path}")
    print(f"\n可用参数 ({len(available_params)} 个)：")
    for p in available_params[:10]:
        print(f"  - {p['key']}: {p['current_value']} ({p['description']})")
    if len(available_params) > 10:
        print(f"  ... (共 {len(available_params)} 个参数)")

    return template_path


def run_from_config(config_path: Path):
    config = json.loads(config_path.read_text(encoding="utf-8"))

    model_path = Path(config["model_path"])
    catalog = config.get("parameter_catalog")
    blocks_config, streams_config = {}, []
    if not catalog:
        import importlib.util
        control_script_path = Path(config["control_script"])
        if not control_script_path.is_absolute():
            control_script_path = config_path.parent / control_script_path
        spec = importlib.util.spec_from_file_location("control_module", control_script_path)
        if spec is None or spec.loader is None:
            raise ImportError(f"无法加载控制脚本：{control_script_path}")
        control_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(control_module)
        blocks_config = control_module.BLOCKS_CONFIG
        streams_config = control_module.STREAMS_CONFIG

    param_sets = []
    run_names = []
    for item in config["parameter_sets"]:
        param_sets.append(item["parameters"])
        run_names.append(item.get("_name", None))

    runner = BatchRunner(model_path, blocks_config, streams_config, catalog)
    runner.run_batch(param_sets, run_names)
    runner.save_batch_summary()


def main():
    parser = argparse.ArgumentParser(
        description="Aspen Plus 批处理运行工具：自动运行多组参数变量"
    )

    subparsers = parser.add_subparsers(dest="command", help="子命令")

    gen_parser = subparsers.add_parser("generate-template", help="生成批处理配置模板")
    gen_parser.add_argument("control_script", type=Path, help="控制脚本路径 (generated/*_control.py)")

    run_parser = subparsers.add_parser("run", help="运行批处理")
    run_parser.add_argument("config", type=Path, help="批处理配置文件路径 (.json)")

    args = parser.parse_args()

    if args.command == "generate-template":
        if not args.control_script.exists():
            print(f"错误：找不到控制脚本 {args.control_script}")
            sys.exit(1)
        generate_batch_template(args.control_script)

    elif args.command == "run":
        if not args.config.exists():
            print(f"错误：找不到配置文件 {args.config}")
            sys.exit(1)
        run_from_config(args.config)

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
