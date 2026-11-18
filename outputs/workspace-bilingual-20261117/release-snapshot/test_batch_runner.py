"""批处理模块测试脚本 - 验证代码语法和基本功能"""
import sys
from pathlib import Path

print("=" * 80)
print("批处理模块测试")
print("=" * 80)

# 测试 1: 导入模块
print("\n[测试 1/4] 导入批处理模块...")
try:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from batch_runner import BatchRunner, generate_batch_template, run_from_config
    print("✓ 模块导入成功")
except Exception as e:
    print(f"✗ 模块导入失败: {e}")
    sys.exit(1)

# 测试 2: 检查类定义
print("\n[测试 2/4] 检查 BatchRunner 类...")
try:
    assert hasattr(BatchRunner, '__init__')
    assert hasattr(BatchRunner, 'set_parameters')
    assert hasattr(BatchRunner, 'run_single')
    assert hasattr(BatchRunner, 'run_batch')
    assert hasattr(BatchRunner, 'save_batch_summary')
    assert hasattr(BatchRunner, '_print_brief_summary')
    assert hasattr(BatchRunner, '_generate_summary_csv')
    print("✓ BatchRunner 类结构完整")
except AssertionError:
    print("✗ BatchRunner 类缺少必要的方法")
    sys.exit(1)

# 测试 3: 检查函数定义
print("\n[测试 3/4] 检查辅助函数...")
try:
    assert callable(generate_batch_template)
    assert callable(run_from_config)
    print("✓ 辅助函数定义正确")
except AssertionError:
    print("✗ 辅助函数定义有问题")
    sys.exit(1)

# 测试 4: 创建 BatchRunner 实例（模拟数据）
print("\n[测试 4/4] 创建 BatchRunner 实例...")
try:
    mock_model_path = Path("test_model.bkp")
    mock_blocks_config = {
        "REACTOR": {
            "type": "反应器",
            "params": {"反应温度": 350},
            "_nodes": {"反应温度": "REAC_TEMP"}
        }
    }
    mock_streams_config = ["INLET", "OUTLET"]

    runner = BatchRunner(mock_model_path, mock_blocks_config, mock_streams_config)

    assert runner.model_path == mock_model_path
    assert runner.blocks_config == mock_blocks_config
    assert runner.streams_config == mock_streams_config
    assert runner.batch_results == []
    assert len(runner.batch_id) == 15  # 格式: YYYYMMDD-HHMMSS

    print("✓ BatchRunner 实例创建成功")
    print(f"  - 模型路径: {runner.model_path}")
    print(f"  - 批次 ID: {runner.batch_id}")
    print(f"  - 设备数量: {len(runner.blocks_config)}")
    print(f"  - 物流数量: {len(runner.streams_config)}")
except Exception as e:
    print(f"✗ BatchRunner 实例创建失败: {e}")
    sys.exit(1)

print("\n" + "=" * 80)
print("所有测试通过！批处理模块工作正常。")
print("=" * 80)
print("\n提示：")
print("  1. 先运行 test_aspen_control.py 扫描你的 Aspen 模型")
print("  2. 使用 batch_runner.py generate-template 生成配置模板")
print("  3. 编辑配置文件，设置参数组合")
print("  4. 使用 batch_runner.py run 运行批处理")
print("\n详细使用说明请查看：docs/使用指南.md")
