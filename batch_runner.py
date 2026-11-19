"""批处理运行模块：自动运行多组参数变量，收集并汇总数据。

使用方法：
    1. 生成批处理配置模板：
       py automatic/batch_runner.py generate-template generated/<模型名>_control.py

    2. 编辑生成的 *_batch_config.json，设置变量组合

    3. 运行批处理（--timeout 为每组参数的 Aspen 运行上限，单位秒，默认 1200）：
       py automatic/batch_runner.py run generated/<模型名>_batch_config.json --timeout 1800

输出：
    - 每次运行的结果保存到 outputdata/<模型名>/<时间戳>/
    - 批处理汇总保存到 outputdata/<模型名>/batch_<批次时间戳>/

运行方式：通过 aspen_study 的 Aspen COM 适配器（私有文档、模型副本、Reinit + Run2 轮询、超时先 Stop 再只结束本次
启动的 Aspen 进程、退出前清理），不再使用会无限阻塞的 Run 调用。每组结果的 status 取值见 run_status.py：
ok / warning（BLKSTAT=2，如 heatrecovery 的 COOLER/REACTOR/VALVE）/ error / timeout / stopped / skipped。
热负荷单位随节点（MET 下是 cal/sec，1 cal = 4.1868 J），不假设 kW。
"""
import argparse
import csv
import json
import sys
import threading
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_status
import test_datacatch as datacatch
from parameter_catalog import legacy_catalog, apply_parameters
from result_units import BLOCK_UNITS, CALORIE_J, RUN_UNITS, STREAM_UNITS, format_quantity

OUTPUT_ROOT = Path(__file__).resolve().parent / "outputdata"
DEFAULT_TIMEOUT_S = 1200


def _adapter_errors():
    from aspen_study.adapters.errors import AspenStopped, AspenTimeout
    return AspenTimeout, AspenStopped


class BatchRunner:
    """批处理运行器：管理多组参数的自动运行"""

    def __init__(self, model_path: Path, blocks_config: Dict, streams_config: List[str], parameter_catalog=None,
                 timeout_s: float = DEFAULT_TIMEOUT_S, adapter_factory=None):
        self.model_path = Path(model_path)
        self.blocks_config = blocks_config
        self.streams_config = streams_config
        self.parameter_catalog = parameter_catalog or legacy_catalog(blocks_config)
        self.timeout_s = timeout_s
        self.adapter_factory = adapter_factory  # 测试/其他模拟器可注入；默认真实 Aspen COM 适配器
        self.batch_results = []
        self.batch_id = datetime.now().strftime("%Y%m%d-%H%M%S")
        self._stop = threading.Event()

    # ------------------------------------------------------------------ 停止
    def request_stop(self):
        """请求停止：正在计算的这一组会在下一次轮询时停止 Aspen（status=stopped），后面的行不再开始（skipped）。"""
        self._stop.set()

    @property
    def stop_requested(self):
        return self._stop.is_set()

    def _make_adapter(self):
        if self.adapter_factory is not None:
            return self.adapter_factory(timeout_s=self.timeout_s)
        from aspen_study.adapters.aspen_com import AspenPlusCOMAdapter
        return AspenPlusCOMAdapter(timeout_s=self.timeout_s)

    def set_parameters(self, aspen, param_set: Dict[str, Any]):
        actual = apply_parameters(aspen, self.parameter_catalog, param_set)
        for key, value in actual.items():
            print(f"    [已设置并回读] {key} = {value}")
        return actual

    def _new_result(self, param_set, run_index, run_name):
        return {
            "run_index": run_index,
            "run_name": run_name,
            "parameters": param_set.copy(),
            "status": "error",
            "error": None,
            "blocks": {},
            "streams": {},
            "timestamp": None,
            "timeout_s": self.timeout_s,
            "units": dict(RUN_UNITS, timeout_s="s"),
        }

    def run_single(self, param_set: Dict[str, Any], run_index: int, run_name: Optional[str] = None) -> Dict:
        run_name = run_name or f"Run_{run_index}"
        print("\n" + "=" * 80)
        print(f"批处理进度：[{run_index}] {run_name}")
        print("=" * 80)
        result = self._new_result(param_set, run_index, run_name)
        AspenTimeout, AspenStopped = _adapter_errors()
        adapter = None
        elapsed_time = None
        try:
            adapter = self._make_adapter()
            print(">>> [1/5] 打开模型副本（私有 Aspen 文档，源文件不改）...")
            adapter.open(self.model_path)
            aspen = adapter.document

            print(">>> [2/5] 设置参数...")
            result["applied_parameters"] = self.set_parameters(aspen, param_set)

            print(f">>> [3/5] 重置并运行 Aspen（轮询，最长 {self.timeout_s} 秒）...")
            start_time = time.time()
            try:
                adapter.run(self.timeout_s, should_stop=self._stop.is_set)
            except AspenTimeout as exc:
                result.update(status="timeout", error=str(exc))
            except AspenStopped as exc:
                result.update(status="stopped", error=str(exc))
            elapsed_time = time.time() - start_time
            result["elapsed_time_seconds"] = round(elapsed_time, 2)

            if result["status"] in ("timeout", "stopped"):
                print(f"    [{run_status.label(result['status'])}] {result['error']}")
                result["run_status"] = {"state": result["status"], "run_completed": False,
                                        "errors": [result["error"]], "warnings": [], "notes": []}
            else:
                print(f"    计算完成，用时 {elapsed_time:.1f} 秒")
                print(">>> [4/5] 读取运行状态并抓取计算结果...")
                self._collect(adapter, aspen, result)
                print(">>> [5/5] 保存结果文件...")
                json_path = self._save(result)
                print(f"    结果已保存：{json_path.parent}")
                print(f"\n>>> 运行 [{run_name}] 完成：{run_status.label(result['status'])}")
                self._print_brief_summary(result)

        except Exception as error:
            result.pop("_capture", None)
            result["status"] = "error"
            result["error"] = str(error)
            result["traceback"] = traceback.format_exc()
            print(f"\n[错误] 运行 [{run_name}] 失败：{error}")

        finally:
            if adapter is not None:
                try:
                    adapter.close()
                    result["cleanup"] = {"killed_pids": list(adapter.cleaned_pids()),
                                         "source_unchanged": adapter.source_unchanged}
                except Exception as close_error:
                    result["cleanup_warning"] = str(close_error)

        return result

    def _collect(self, adapter, aspen, result):
        """运行状态 + 数据抓取；status 与逐块 messages 来自 Aspen 自己的 BLKSTAT / UOSSTAT2 / PER_ERROR。"""
        report = adapter.run_report()
        capture = datacatch.capture_all(aspen, self.model_path)
        rows = {}
        try:  # same per-block table as `python -m aspen_study probe` (native value + unit + kW, status, messages)
            from aspen_study.probe import energy_table
            rows = {row["id"]: row for row in energy_table({"blocks": adapter.blocks()}, report, CALORIE_J)}
        except Exception as exc:
            result.setdefault("warnings", []).append(f"逐块能量表读取失败：{exc}")
        for name, block in capture["blocks"].items():
            row = rows.get(name)
            if row is None:
                block.update(run_status.block_fields((report.get("blocks") or {}).get(name, {"state": "unknown"})))
                continue
            block.update(status=row["status"], blkstat=row["blkstat"], energy=row["energy"],
                         messages=row["messages"] + block.get("messages", []))
            if "outlet_temperature" in row:
                block["outlet_temperature"] = row["outlet_temperature"]
            block["block_type"] = row["type"]
        result["status"] = report["state"]
        if report["state"] == "error":
            result["error"] = "; ".join(report["errors"]) or "Aspen 报告运行有错误"
        result["run_status"] = {key: report[key] for key in ("state", "run_completed", "errors", "warnings", "notes",
                                                             "run_status_lines", "raw_status", "run_seconds")}
        result["blocks"] = capture["blocks"]
        result["streams"] = capture["streams"]
        result["component_ids"] = capture.get("component_ids", [])
        result["component_export"] = capture.get("component_export")
        result["aspen_run_status"] = capture.get("aspen_run_status", {})
        result["unit_conversion"] = capture.get("unit_conversion")
        result["calorie_J"] = capture.get("calorie_J", CALORIE_J)
        result["status_scope"] = ("status = Aspen's own run status (UOSSTAT2, BLKSTAT, PER_ERROR); "
                                  "convergence-block residuals are not independently checked")
        result["timestamp"] = capture["captured_at"]
        result["_capture"] = capture

    def _save(self, result):
        capture = result.pop("_capture")
        json_path, blocks_csv, streams_csv = datacatch.save_results(capture, self.model_path)
        result["component_csv"] = str(json_path.parent / "stream_components.csv")
        result["output_dir"] = str(json_path.parent)
        return json_path

    def _print_brief_summary(self, result: Dict):
        print("    关键设备结果：")
        for bname, data in list(result["blocks"].items())[:5]:
            heat = format_quantity(data.get("heat_kW"), "kW")
            power = format_quantity(data.get("power_kW"), "kW")
            flag = "" if data.get("status") in (None, "ok") else f" [{data['status']}]"
            print(f"      [{bname}] 热负荷={heat}, 电耗={power}{flag}")

        if len(result["blocks"]) > 5:
            print(f"      ... (共 {len(result['blocks'])} 个设备)")

    def run_batch(self, param_sets: List[Dict[str, Any]], run_names: Optional[Sequence[Optional[str]]] = None) -> List[Dict]:
        total = len(param_sets)
        print("\n" + "=" * 80)
        print(f"批处理任务：共 {total} 组参数，每组最长 {self.timeout_s} 秒")
        print(f"批次 ID：{self.batch_id}")
        print("=" * 80)

        resolved_run_names: Sequence[Optional[str]] = run_names if run_names is not None else [None] * total

        if len(resolved_run_names) != total:
            raise ValueError("工况名称数量与参数组数量不一致")
        self.batch_results = []
        batch_start_time = time.time()

        for i, (param_set, run_name) in enumerate(zip(param_sets, resolved_run_names), start=1):
            if self._stop.is_set():
                skipped = self._new_result(param_set, i, run_name or f"Run_{i}")
                skipped.update(status="skipped", error="已请求停止，这一行没有开始")
                self.batch_results.append(skipped)
                continue
            self.batch_results.append(self.run_single(param_set, i, run_name))

        batch_elapsed_time = time.time() - batch_start_time
        counts = run_status.counts(self.batch_results)

        print("\n" + "=" * 80)
        print(f"批处理完成！总用时：{batch_elapsed_time/60:.1f} 分钟")
        print("，".join(f"{run_status.label(name)}：{counts[name]}" for name in run_status.STATUSES if counts[name])
              + f"（共 {total}）")
        print("=" * 80)

        return self.batch_results

    def save_batch_summary(self) -> tuple:
        batch_dir = OUTPUT_ROOT / self.model_path.stem / f"batch_{self.batch_id}"
        batch_dir.mkdir(parents=True, exist_ok=True)

        summary_json = batch_dir / "batch_summary.json"
        counts = run_status.counts(self.batch_results)
        summary_data = {
            "batch_id": self.batch_id,
            "model_path": str(self.model_path),
            "summary_version": 2,
            "total_runs": len(self.batch_results),
            "status_counts": {k: v for k, v in counts.items() if k in run_status.STATUSES},
            # legacy totals: success = exported (ok or warning)
            "success_count": counts["success_count"],
            "failed_count": counts["failed_count"],
            "timeout_s": self.timeout_s,
            "stop_requested": self.stop_requested,
            "calorie_J": CALORIE_J,
            "units": {"timeout_s": "s"},
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
        header.extend([f"设备.{b}.状态" for b in all_block_names])
        header.extend([f"设备.{b}.消息" for b in all_block_names])
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

                for b in all_block_names:
                    row.append(result["blocks"].get(b, {}).get("status", ""))

                for b in all_block_names:
                    row.append(" | ".join(str(m).strip() for m in result["blocks"].get(b, {}).get("messages", []) if str(m).strip()))

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


def run_from_config(config_path: Path, timeout_s: Optional[float] = None, adapter_factory=None):
    """timeout_s：命令行 --timeout 优先，其次配置文件的 "timeout_s"，默认 1200 秒。"""
    config = json.loads(config_path.read_text(encoding="utf-8"))
    if timeout_s is None:
        timeout_s = config.get("timeout_s", DEFAULT_TIMEOUT_S)

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

    runner = BatchRunner(model_path, blocks_config, streams_config, catalog, timeout_s=timeout_s,
                         adapter_factory=adapter_factory)
    runner.run_batch(param_sets, run_names)
    runner.save_batch_summary()
    return runner


def positive_seconds(text):
    try:
        value = float(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"不是数字：{text!r}")
    if not value > 0 or value == float("inf"):
        raise argparse.ArgumentTypeError("--timeout 必须是大于 0 的有限秒数")
    return value


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Aspen Plus 批处理运行工具：自动运行多组参数变量"
    )

    subparsers = parser.add_subparsers(dest="command", help="子命令")

    gen_parser = subparsers.add_parser("generate-template", help="生成批处理配置模板")
    gen_parser.add_argument("control_script", type=Path, help="控制脚本路径 (generated/*_control.py)")

    run_parser = subparsers.add_parser("run", help="运行批处理")
    run_parser.add_argument("config", type=Path, help="批处理配置文件路径 (.json)")
    run_parser.add_argument("--timeout", type=positive_seconds, default=None, metavar="SECONDS",
                            help=f"每组参数的 Aspen 运行上限（秒，默认 {DEFAULT_TIMEOUT_S}，也可写在配置文件的 timeout_s）；"
                                 "超时先 Stop，再只结束本次启动的 Aspen 进程，该行记为 timeout")

    args = parser.parse_args(argv)

    if args.command == "generate-template":
        if not args.control_script.exists():
            print(f"错误：找不到控制脚本 {args.control_script}")
            sys.exit(1)
        generate_batch_template(args.control_script)

    elif args.command == "run":
        if not args.config.exists():
            print(f"错误：找不到配置文件 {args.config}")
            sys.exit(1)
        run_from_config(args.config, timeout_s=args.timeout)

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
