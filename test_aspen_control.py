import argparse
import hashlib
import json
from pathlib import Path
import sys
import threading
import time
from aspen_connection import create_aspen_document

try:
    import pythoncom
    import win32com.client as win32
except ImportError:
    print("缺少 pywin32，请先运行：py -3 -m pip install pywin32")
    sys.exit(1)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
# 可直接改成其他 Aspen .bkp 文件路径，也可以运行时传入路径参数。
DEFAULT_MODEL_PATH = Path(r"C:\Users\Administrator\Documents\Codex\2026-09-16\project1jason\aspenmodel\standard-pwerlaw.bkp")
SCAN_OUTPUT_DIR = Path(__file__).resolve().parent / "generated"


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


def resolve_block_power(aspen, bname, power_override_kW=None):
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
    if power_override_kW is not None:
        return float(power_override_kW)
    return None


def scan_model(model_path):
    print(f"正在安全扫描 Aspen 模型：{model_path}")
    aspen = create_aspen_document()
    blocks_data = []
    streams_data = []

    try:
        aspen.InitFromArchive2(str(model_path))
        aspen.Visible = 0
        aspen.SuppressDialogs = 1

        blocks_node = aspen.Tree.FindNode(r"\Data\Blocks")
        if blocks_node:
            for i in range(blocks_node.Elements.Count):
                blk = blocks_node.Elements.Item(i)
                bname = blk.Name
                inp = aspen.Tree.FindNode(rf"\Data\Blocks\{bname}\Input")
                
                input_keys = set()
                if inp:
                    for k in range(inp.Elements.Count):
                        try:
                            input_keys.add(inp.Elements.Item(k).Name)
                        except Exception:
                            pass

                def get_input_val(key):
                    if inp and key in input_keys:
                        try:
                            return inp.Elements.Item(key).Value
                        except Exception:
                            return None
                    return None

                reac_temp = get_input_val("REAC_TEMP")
                length = get_input_val("LENGTH")
                diam = get_input_val("DIAM")
                pres = get_input_val("PRES")
                duty = get_input_val("DUTY")
                temp = get_input_val("TEMP")
                delp = get_input_val("DELP")

                btype = "常规设备 (Block)"
                conditions = {}
                param_nodes = {}

                # 反应器特征 (RPlug / CSTR / RBatch)
                if reac_temp is not None or length is not None:
                    btype = "反应器 (Reactor / RPlug)"
                    conditions = {
                        "反应温度": reac_temp,
                        "操作压力": pres,
                        "反应器长度": length,
                        "反应器管径": diam,
                    }
                    if reac_temp is not None: param_nodes["反应温度"] = "REAC_TEMP"
                    if pres is not None: param_nodes["操作压力"] = "PRES"
                    if length is not None: param_nodes["反应器长度"] = "LENGTH"
                    if diam is not None: param_nodes["反应器管径"] = "DIAM"

                # 双股换热器特征 (HeatX)
                elif "1PHASE" in input_keys or "HOT_OUT_T" in input_keys or "1NPHASE" in input_keys or "BAFFLE_CUT" in input_keys:
                    btype = "换热器 (Heat Exchanger / HeatX)"
                    conditions = {
                        "操作压力": pres,
                        "压降 DELP": delp,
                    }
                    if pres is not None: param_nodes["操作压力"] = "PRES"
                    if delp is not None: param_nodes["压降 DELP"] = "DELP"

                # 泵 / 压缩机特征 (Pump / Compr)
                elif "P_SPEC" in input_keys or "HEAD" in input_keys or "DISCHARGE_P" in input_keys or "ACT_SH_SPEED" in input_keys:
                    btype = "泵/压缩机 (Pump / Compressor)"
                    conditions = {
                        "出口压力": pres,
                        "压差 DELP": delp,
                    }
                    if pres is not None: param_nodes["出口压力"] = "PRES"
                    if delp is not None: param_nodes["压差 DELP"] = "DELP"

                # 减压阀 / 控制阀特征 (Valve)
                elif "PBASIS" in input_keys or "P_DROP" in input_keys or "VALVE_TYPE" in input_keys or "FLOW_COEF" in input_keys:
                    btype = "阀门 (Valve)"
                    conditions = {
                        "出口压力": pres,
                        "阀门压降": delp,
                    }
                    if pres is not None: param_nodes["出口压力"] = "PRES"
                    if delp is not None: param_nodes["阀门压降"] = "DELP"

                # 加热器 / 冷却器特征 (Heater / Cooler)
                elif duty is not None or temp is not None:
                    # 通过温度或名称辅助区分为加热器或冷却器
                    if "COOL" in bname.upper():
                        btype = "冷却器 (Cooler / Heater)"
                    else:
                        btype = "加热器 (Heater)"
                    conditions = {
                        "目标温度": temp,
                        "热负荷 Duty": duty,
                        "操作压力": pres,
                    }
                    if temp is not None: param_nodes["目标温度"] = "TEMP"
                    if duty is not None: param_nodes["热负荷 Duty"] = "DUTY"
                    if pres is not None: param_nodes["操作压力"] = "PRES"
                else:
                    conditions = {
                        "操作压力": pres,
                        "操作温度": temp,
                    }
                    if pres is not None: param_nodes["操作压力"] = "PRES"
                    if temp is not None: param_nodes["操作温度"] = "TEMP"

                blocks_data.append({
                    "name": bname,
                    "type": btype,
                    "conditions": conditions,
                    "param_nodes": param_nodes,
                    "path": rf"\Data\Blocks\{bname}"
                })

        streams_node = aspen.Tree.FindNode(r"\Data\Streams")
        if streams_node:
            for i in range(streams_node.Elements.Count):
                s = streams_node.Elements.Item(i)
                streams_data.append({
                    "name": s.Name,
                    "path": rf"\Data\Streams\{s.Name}"
                })

    finally:
        aspen.Close(False)

    scan_output = SCAN_OUTPUT_DIR / f"{model_path.stem}_scan.json"
    scan_output.parent.mkdir(parents=True, exist_ok=True)
    scan_data = {
        "model_path": str(model_path),
        "blocks": blocks_data,
        "streams": streams_data,
    }
    scan_output.write_text(json.dumps(scan_data, ensure_ascii=False, indent=2), encoding="utf-8")
    generated_path = generate_model_script(model_path, blocks_data, streams_data)
    print(f"扫描完成：识别到 {len(blocks_data)} 个设备模块，{len(streams_data)} 个物流")
    for b in blocks_data:
        print(f"  - [{b['name']}] 类型: {b['type']}，工况: {b['conditions']}")
    print(f"扫描结果：{scan_output}")
    print(f"专用程序：{generated_path}")


def generate_model_script(model_path, blocks_data, streams_data):
    generated_path = SCAN_OUTPUT_DIR / f"{model_path.stem}_control.py"
    scan_path = SCAN_OUTPUT_DIR / f"{model_path.stem}_scan.json"

    # 生成排版极其清爽的 BLOCKS_CONFIG 代码块
    blocks_lines = ["BLOCKS_CONFIG = {"]
    for b in blocks_data:
        bname = b["name"]
        btype = b["type"]
        conds = b.get("conditions", {})
        pnodes = b.get("param_nodes", {})
        valid_conds = {k: v for k, v in conds.items() if v is not None}
        
        blocks_lines.append(f"    # --------------------------------------------------------------------------")
        blocks_lines.append(f"    # 设备 [{bname}]：{btype}")
        blocks_lines.append(f"    # --------------------------------------------------------------------------")
        blocks_lines.append(f"    {bname!r}: {{")
        blocks_lines.append(f"        'type': {btype!r},")
        blocks_lines.append(f"        'params': {{")
        if valid_conds:
            for k, v in valid_conds.items():
                leaf = pnodes.get(k, "")
                blocks_lines.append(f"            {k!r}: {v!r},  # 对应 Aspen 输入节点: {leaf}")
        else:
            blocks_lines.append("            # (此模块在当前模型中未设置固定标量参数)")
        blocks_lines.append("        },")
        blocks_lines.append("        'power_override_kW': None,  # 如 Aspen 节点为空，可手工指定该设备电耗（kW），例如泵: 2.17")
        blocks_lines.append(f"        '_nodes': {pnodes!r},")
        blocks_lines.append("    },")
        blocks_lines.append("")
    blocks_lines.append("}")
    pretty_blocks_code = "\n".join(blocks_lines)

    stream_names = [s["name"] for s in streams_data]

    script = rf'''from pathlib import Path
import json
import sys
import threading
import time
import pythoncom
import win32com.client as win32

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import test_datacatch as datacatch
from aspen_connection import create_aspen_document


MODEL_PATH = Path(r"{model_path}")
SCAN_PATH = Path(r"{scan_path}")


def _safe_float(value):
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def resolve_block_heat(aspen, bname):
    candidates = [
        rf"\Data\Blocks\{{bname}}\Output\QCALC",
        rf"\Data\Blocks\{{bname}}\Output\DUTY",
        rf"\Data\Blocks\{{bname}}\Output\UTIL_DUTY",
    ]
    for path in candidates:
        node = aspen.Tree.FindNode(path)
        value = _safe_float(getattr(node, "Value", None))
        if value is not None:
            return value
    return None


def resolve_block_power(aspen, bname, power_override_kW=None):
    # Aspen 该字段单位即为 kW（非瓦特），不要再除以 1000
    candidates = [
        rf"\Data\Blocks\{{bname}}\Output\ACT_POWER",
        rf"\Data\Blocks\{{bname}}\Output\BRAKE_POWER",
        rf"\Data\Blocks\{{bname}}\Output\POWER",
        rf"\Data\Blocks\{{bname}}\Output\ELEC_POWER",
        rf"\Data\Blocks\{{bname}}\Output\IN_POWER",
        rf"\Data\Blocks\{{bname}}\Output\WNET",
        rf"\Data\Blocks\{{bname}}\Output\FLUID_POWER",
    ]
    for path in candidates:
        node = aspen.Tree.FindNode(path)
        value = _safe_float(getattr(node, "Value", None))
        if value is not None:
            return value
    if power_override_kW is not None:
        return float(power_override_kW)
    return None


# ==============================================================================
# 设备运行参数配置（可直接在此修改数值，运行程序时自动写入 Aspen 并重新计算）
# ==============================================================================
{pretty_blocks_code}

# ==============================================================================
# 关键物流清单（运行完成后自动读取温度、压力、流量及组分分布）
# ==============================================================================
STREAMS_CONFIG = {stream_names!r}


def run_with_monitor(model_path, timeout_seconds=3600, visible=True):
    result_holder: list[object] = []
    error_holder: list[Exception] = []
    is_calculating = [False]

    def run_engine():
        pythoncom.CoInitialize()
        aspen = None
        try:
            aspen = create_aspen_document()
            aspen.InitFromArchive2(str(model_path))
            aspen.Visible = int(visible)
            aspen.SuppressDialogs = 1
            
            # 步骤 1：重置运行，清空之前的运行数据
            print("\n>>> [步骤 1/4] 重置运行环境，清空历史数据与初始猜测...", flush=True)
            aspen.Engine.Reinit()
            print("    重置完成，旧计算结果已清空。", flush=True)

            # 步骤 1.5：将 BLOCKS_CONFIG 中用户自定义的条件同步写入 Aspen 模型
            print("\n>>> 同步设备运行条件到 Aspen 树节点...")
            for bname, blk in BLOCKS_CONFIG.items():
                params = blk.get("params", {{}})
                pnodes = blk.get("_nodes", {{}})
                for cname, cval in params.items():
                    if cval is not None and cname in pnodes:
                        leaf_name = pnodes[cname]
                        target_node = aspen.Tree.FindNode(rf"\Data\Blocks\{{bname}}\Input\{{leaf_name}}")
                        if target_node:
                            try:
                                target_node.Value = cval
                                print(f"    [已同步] {{bname}} -> {{cname}} ({{leaf_name}}) = {{cval}}")
                            except Exception as ex:
                                print(f"    [同步异常] {{bname}} -> {{cname}}: {{ex}}")
            print("    设备参数同步完成。\n", flush=True)

            # 步骤 2：开始运行
            print(">>> [步骤 2/4] 开始运行 Aspen 模拟计算...", flush=True)
            is_calculating[0] = True
            result_holder.append(aspen.Engine.Run())
            is_calculating[0] = False
            
            # 步骤 3：运行完成，输出数据
            print("\n>>> [步骤 3/4] 模拟计算完成，正在读取并输出详细工况数据：", flush=True)
            
            # 3.1 打印各单元操作/设备实际计算指标
            print("\n" + "=" * 25 + " 设备运行与计算结果 (Blocks) " + "=" * 25)
            for bname, blk in BLOCKS_CONFIG.items():
                btype = blk.get("type", "设备")
                print(f"\n● 设备 [{{bname}}] ({{btype}}):")
                print("  [输入设计设定值]:")
                params = blk.get("params", {{}})
                if params:
                    for cname, cval in params.items():
                        print(f"    - {{cname}}: {{cval}}")
                else:
                    print("    - 无预设输入参数")
                
                # 读取计算出的热负荷与电耗/功耗；若 Aspen 节点值为空，则允许手工补充同名覆盖值
                q_val = resolve_block_heat(aspen, bname)
                power_override_kW = blk.get("power_override_kW")
                w_val = resolve_block_power(aspen, bname, power_override_kW=power_override_kW)
                q_text = f"{{round(q_val / 1000, 2)}} kW" if q_val is not None else "无"
                w_text = f"{{round(w_val, 2)}} kW" if w_val is not None else "无"
                if power_override_kW is not None and w_val is not None and abs(w_val - float(power_override_kW)) < 1e-6:
                    w_text = f"{{round(w_val, 2)}} kW (手工修正)"
                print(f"  [实际计算结果]: 计算热负荷: {{q_text}}, 电耗/功耗: {{w_text}}")
            
            # 2. 打印物流热力学与流量计算结果
            print("\n" + "=" * 25 + " 物流状态计算结果 (Streams) " + "=" * 26)
            for sname in STREAMS_CONFIG:
                t_node = aspen.Tree.FindNode(rf"\Data\Streams\{{sname}}\Output\TEMP_OUT\MIXED")
                p_node = aspen.Tree.FindNode(rf"\Data\Streams\{{sname}}\Output\PRES_OUT\MIXED")
                f_node = aspen.Tree.FindNode(rf"\Data\Streams\{{sname}}\Output\MASSFLMX\MIXED")
                
                # 换算单位（开氏度 -> 摄氏度，bar -> MPa，kg/s -> kg/h）
                if t_node and t_node.Value is not None:
                    t_str = f"{{round(t_node.Value - 273.15, 2)}} °C"
                else:
                    t_str = "未计算/无"
                    
                if p_node and p_node.Value is not None:
                    p_str = f"{{round(p_node.Value * 0.101325, 2)}} MPa ({{round(p_node.Value, 2)}} bar/atm)"
                else:
                    p_str = "未计算/无"
                    
                if f_node and f_node.Value is not None:
                    f_str = f"{{round(f_node.Value * 3600, 2)}} kg/h"
                else:
                    f_str = "未计算/无"
                    
                print(f"  物流 [{{sname:<6}}] | 温度: {{t_str:<12}} | 压力: {{p_str:<26}} | 总质量流量: {{f_str}}")

            # 3. 打印关键出口物流的物料组分分布（若存在反应产物）
            print("\n" + "=" * 25 + " 关键组分质量流量 (> 0.1 kg/h) " + "=" * 23)
            printed_comps = False
            for sname in STREAMS_CONFIG:
                comps_node = aspen.Tree.FindNode(rf"\Data\Streams\{{sname}}\Output\MASSFLOW\MIXED")
                if comps_node:
                    comp_list = []
                    for k in range(comps_node.Elements.Count):
                        c = comps_node.Elements.Item(k)
                        if c.Value and (c.Value * 3600) >= 0.1:
                            comp_list.append(f"{{c.Name}}: {{round(c.Value * 3600, 2)}} kg/h")
                    if comp_list:
                        printed_comps = True
                        print(f"  物流 [{{sname}}]: " + ", ".join(comp_list))
            if not printed_comps:
                print("  未检测到组分分解数据。")
            print("=" * 77 + "\n")

            # 步骤 4：摘取结果摘要
            print(">>> [步骤 4/5] 摘取模型设备计算摘要...", flush=True)
            summary_lines = []
            summary_lines.append("\n" + "=" * 18 + " 模型设备计算摘要（设备优先） " + "=" * 18)

            for bname, blk in BLOCKS_CONFIG.items():
                qv = resolve_block_heat(aspen, bname)
                power_override_kW = blk.get("power_override_kW")
                wv = resolve_block_power(aspen, bname, power_override_kW=power_override_kW)

                settings = []
                for cname, cval in blk.get("params", {{}}).items():
                    if cval is not None:
                        settings.append(f"{{cname}}={{cval}}")
                settings_text = "; ".join(settings) if settings else "无固定输入设定"

                q_text = f"{{round(qv / 1000, 2)}} kW" if qv is not None else "无"
                w_text = f"{{round(wv, 2)}} kW" if wv is not None else "无"
                if power_override_kW is not None and wv is not None:
                    w_text = f"{{round(wv, 2)}} kW (手工修正)"
                summary_lines.append(f"- [{{bname}}] {{blk.get('type', '设备')}}")
                summary_lines.append(f"  设定: {{settings_text}}")
                summary_lines.append(f"  计算结果: 热负荷={{q_text}}; 电耗/功耗={{w_text}}")

            summary_lines.append("")
            summary_lines.append("  物流状态摘要:")
            for sname in STREAMS_CONFIG:
                tnode = aspen.Tree.FindNode(rf"\Data\Streams\{{sname}}\Output\TEMP_OUT\MIXED")
                pnode = aspen.Tree.FindNode(rf"\Data\Streams\{{sname}}\Output\PRES_OUT\MIXED")
                fnode = aspen.Tree.FindNode(rf"\Data\Streams\{{sname}}\Output\MASSFLMX\MIXED")
                tval = round(tnode.Value - 273.15, 2) if tnode and tnode.Value is not None else None
                pval = round(pnode.Value * 0.101325, 2) if pnode and pnode.Value is not None else None
                fval = round(fnode.Value * 3600, 2) if fnode and fnode.Value is not None else None

                t_text = f"{{tval}} °C" if tval is not None else "无"
                p_text = f"{{pval}} MPa" if pval is not None else "无"
                m_text = f"{{fval}} kg/h" if fval is not None else "无"
                summary_lines.append(f"  - {{sname}}: T={{t_text}}; P={{p_text}}; m={{m_text}}")

            for line in summary_lines:
                print(line)
            print("=" * 80)

            # 步骤 4.5：调用数据抓取模块，将结果落盘为 JSON + CSV
            print("\n>>> 正在调用 test_datacatch 模块导出数据...", flush=True)
            try:
                capture = datacatch.capture_all(aspen, MODEL_PATH)
                json_path, blocks_csv, streams_csv = datacatch.save_results(capture, MODEL_PATH)
                print(f"    数据已导出：{{json_path}}")
                print(f"    设备汇总：{{blocks_csv}}")
                print(f"    物流汇总：{{streams_csv}}")
            except Exception as ex:
                print(f"    [数据导出异常] {{ex}}")

            # 步骤 5：按下 enter 退出
            print(">>> [步骤 5/5] 流程已全部就绪。")
            input("按 [Enter] 键关闭 Aspen 退出程序 (在按回车前，Aspen 窗口保持可见以供查阅)...")

        except Exception as error:
            error_holder.append(error)
        finally:
            if aspen is not None:
                aspen.Close(False)
            pythoncom.CoUninitialize()

    print("计算开始……", flush=True)
    worker = threading.Thread(target=run_engine, daemon=True)
    worker.start()
    started_at = time.monotonic()
    last_status = 0.0

    while worker.is_alive():
        elapsed = time.monotonic() - started_at
        if is_calculating[0] and (elapsed - last_status >= 1):
            print(f"计算中…… 已运行 {{int(elapsed)}} 秒", flush=True)
            last_status = elapsed
        if elapsed >= timeout_seconds:
            raise TimeoutError(f"Aspen 计算超过 {{timeout_seconds}} 秒，已停止等待")
        time.sleep(0.2)

    if error_holder:
        raise error_holder[0]
    return result_holder[0] if result_holder else None


def verify_model():
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"找不到专用模型：{{MODEL_PATH}}")


def print_modules():
    print(f"本专用程序对应模型：{{MODEL_PATH}}")
    block_summary = [f"{{bname}}({{blk.get('type', '')}})" for bname, blk in BLOCKS_CONFIG.items()]
    print("识别设备：", ", ".join(block_summary) or "无")
    print("识别物流：", ", ".join(STREAMS_CONFIG) or "无")


def main():
    verify_model()
    print_modules()
    pythoncom.CoInitialize()
    try:
        run_with_monitor(MODEL_PATH, visible=True)
        print("Aspen 运行与数据读取完成。")
    finally:
        pythoncom.CoUninitialize()

if __name__ == "__main__":
    main()
'''
    generated_path.write_text(script, encoding="utf-8")
    return generated_path


def main():
    parser = argparse.ArgumentParser(
        description="扫描 Aspen 模型并生成该模型专用的子脚本（本程序不直接运行计算）"
    )
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

    scan_model(model_path)


if __name__ == "__main__":
    main()
