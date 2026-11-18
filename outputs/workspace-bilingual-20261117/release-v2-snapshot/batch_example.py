"""批处理运行示例：演示如何在代码中直接定义和运行批处理任务

这个示例展示两种批处理方式：
1. 单变量扫描：改变一个参数，其他参数保持不变
2. 多变量组合：同时改变多个参数

根据你的实际需求修改参数名称和数值范围。
"""
import importlib.util
import sys
from pathlib import Path

# 确保可以导入批处理模块
sys.path.insert(0, str(Path(__file__).resolve().parent))

from batch_runner import BatchRunner

# 文件名含连字符，无法作为包直接 import，改用动态加载
CONTROL_SCRIPT_PATH = Path(__file__).resolve().parent / "generated" / "standard-pwerlaw_control.py"


def _load_control_module():
    spec = importlib.util.spec_from_file_location("standard_pwerlaw_control", CONTROL_SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(f"无法加载控制脚本：{CONTROL_SCRIPT_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def example_single_variable_scan():
    """示例 1：单变量扫描（温度扫描）"""
    print("\n" + "=" * 80)
    print("示例 1：单变量扫描 - 反应温度从 300K 到 400K")
    print("=" * 80)

    # 需要先运行 test_aspen_control.py 生成控制脚本，然后从中导入配置
    # 这里使用示例路径，请根据实际情况修改
    control_module = _load_control_module()
    MODEL_PATH, BLOCKS_CONFIG, STREAMS_CONFIG = (
        control_module.MODEL_PATH, control_module.BLOCKS_CONFIG, control_module.STREAMS_CONFIG
    )

    # 创建批处理运行器
    runner = BatchRunner(MODEL_PATH, BLOCKS_CONFIG, STREAMS_CONFIG)

    # 定义温度扫描参数（假设有一个名为 REACTOR 的反应器，参数名为"反应温度"）
    # 请根据你的实际模型修改设备名和参数名
    temperatures = [300, 320, 340, 360, 380, 400]

    param_sets = []
    run_names = []

    for temp in temperatures:
        param_sets.append({
            "REACTOR.反应温度": temp,  # 格式：设备名.参数名
        })
        run_names.append(f"温度_{temp}K")

    # 运行批处理
    results = runner.run_batch(param_sets, run_names)

    # 保存汇总
    runner.save_batch_summary()

    return results


def example_multi_variable_combination():
    """示例 2：多变量组合扫描"""
    print("\n" + "=" * 80)
    print("示例 2：多变量组合 - 温度和压力组合")
    print("=" * 80)

    control_module = _load_control_module()
    MODEL_PATH, BLOCKS_CONFIG, STREAMS_CONFIG = (
        control_module.MODEL_PATH, control_module.BLOCKS_CONFIG, control_module.STREAMS_CONFIG
    )

    runner = BatchRunner(MODEL_PATH, BLOCKS_CONFIG, STREAMS_CONFIG)

    # 定义多个参数的组合
    # 这是一个全因子实验设计的例子
    temperatures = [320, 360, 400]
    pressures = [1.0, 1.5, 2.0]  # 假设单位为 bar 或其他

    param_sets = []
    run_names = []

    for temp in temperatures:
        for pres in pressures:
            param_sets.append({
                "REACTOR.反应温度": temp,
                "REACTOR.操作压力": pres,
            })
            run_names.append(f"T{temp}K_P{pres}bar")

    # 运行批处理（共 3×3=9 组）
    results = runner.run_batch(param_sets, run_names)

    # 保存汇总
    runner.save_batch_summary()

    return results


def example_custom_parameter_sets():
    """示例 3：自定义参数组合列表"""
    print("\n" + "=" * 80)
    print("示例 3：自定义参数组合")
    print("=" * 80)

    control_module = _load_control_module()
    MODEL_PATH, BLOCKS_CONFIG, STREAMS_CONFIG = (
        control_module.MODEL_PATH, control_module.BLOCKS_CONFIG, control_module.STREAMS_CONFIG
    )

    runner = BatchRunner(MODEL_PATH, BLOCKS_CONFIG, STREAMS_CONFIG)

    # 完全自定义的参数组合（可以同时改变多个设备的多个参数）
    param_sets = [
        {
      # 基准工况
            "REACTOR.反应温度": 350,
            "REACTOR.操作压力": 1.5,
            "HEATER.热负荷 Duty": 5000,
        },
        {
            # 高温高压工况
            "REACTOR.反应温度": 400,
            "REACTOR.操作压力": 2.0,
            "HEATER.热负荷 Duty": 6000,
        },
        {
            # 低温低压工况
    "REACTOR.反应温度": 300,
            "REACTOR.操作压力": 1.0,
        "HEATER.热负荷 Duty": 4000,
        },
        {
            # 优化工况
            "REACTOR.反应温度": 370,
            "REACTOR.操作压力": 1.8,
            "HEATER.热负荷 Duty": 5500,
        },
    ]

    run_names = ["基准", "高温高压", "低温低压", "优化工况"]

    # 运行批处理
    results = runner.run_batch(param_sets, run_names)

    # 保存汇总
    runner.save_batch_summary()

    return results


def example_parametric_study():
    """示例 4：参数化研究 - 使用 numpy 生成连续范围"""
    print("\n" + "=" * 80)
    print("示例 4：参数化研究 - 连续温度范围")
    print("=" * 80)

    try:
        import numpy as np
    except ImportError:
        print("此示例需要 numpy，请运行：pip install numpy")
        return None

    control_module = _load_control_module()
    MODEL_PATH, BLOCKS_CONFIG, STREAMS_CONFIG = (
        control_module.MODEL_PATH, control_module.BLOCKS_CONFIG, control_module.STREAMS_CONFIG
    )

    runner = BatchRunner(MODEL_PATH, BLOCKS_CONFIG, STREAMS_CONFIG)

    # 使用 numpy 生成均匀分布的温度点
    temperatures = np.linspace(300, 400, 11)  # 从 300 到 400，共 11 个点

    param_sets = []
    run_names = []

    for i, temp in enumerate(temperatures, start=1):
        param_sets.append({
            "REACTOR.反应温度": round(float(temp), 2),
        })
        run_names.append(f"扫描_{i:02d}_T{temp:.1f}K")

    # 运行批处理
    results = runner.run_batch(param_sets, run_names)

    # 保存汇总
    runner.save_batch_summary()

    return results


if __name__ == "__main__":
    print("""
╔══════════════════════════════════════════════════════════════════════╗
║                    Aspen Plus 批处理运行示例                                ║
╚═════════════════════════════════════════════════════════════════════╝

使用说明：
1. 确保已运行 test_aspen_control.py 生成了控制脚本
2. 修改本文件中的设备名和参数名，匹配你的实际模型
3. 选择一个示例运行，或创建自己的批处理逻辑

可用示例：
  - example_single_variable_scan()      单变量扫描
  - example_multi_variable_combination() 多变量组合
  - example_custom_parameter_sets()      自定义参数组
  - example_parametric_study()           参数化研究（需要 numpy）

""")

    # 取消下面某一行的注释来运行相应的示例
    # 注意：运行前请确保修改了正确的设备名和参数名！

    # results = example_single_variable_scan()
    # results = example_multi_variable_combination()
    # results = example_custom_parameter_sets()
    # results = example_parametric_study()

    print("\n提示：请取消注释上面的某一行来运行示例")
    print("或者使用命令行工具：")
    print("  1. 生成配置模板：py automatic/batch_runner.py generate-template generated/your_model_control.py")
    print("  2. 编辑配置文件：修改生成的 *_batch_config.json")
    print("  3. 运行批处理：  py automatic/batch_runner.py run path/to/batch_config.json")
