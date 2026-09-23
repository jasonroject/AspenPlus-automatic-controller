# AspenPlus-automatic-controller

通过 [pywin32](https://pypi.org/project/pywin32/) 的 COM 接口自动控制 Aspen Plus，实现「模型扫描 → 生成专用控制脚本 → 写入运行参数 → 触发计算 → 抓取并导出结果」的全流程自动化，替代人工在 Aspen 图形界面里逐个点开设备核对工况的重复劳动。

## 功能概览

- **模型扫描 (`test_aspen_control.py`)**：打开指定的 Aspen `.bkp` 模型，遍历 `\Data\Blocks` 与 `\Data\Streams` 节点，自动识别每个设备类型（反应器 / 换热器 / 泵与压缩机 / 阀门 / 加热冷却器等）及其关键输入参数，输出：
  - `generated/<模型名>_scan.json`：结构化扫描结果；
  - `generated/<模型名>_control.py`：**该模型专用**的控制脚本（自动生成，含可直接修改的设备参数表）。
- **专用控制脚本 (`generated/*_control.py`)**：由扫描步骤自动生成，内含 `BLOCKS_CONFIG`（设备运行参数，可手工编辑数值后重新写入 Aspen 并计算）与 `STREAMS_CONFIG`（关注的物流列表）。运行后会：
  1. 重置模型（`Engine.Reinit()`）；
  2. 把 `BLOCKS_CONFIG` 中设置的参数写回 Aspen 对应节点；
  3. 触发计算（`Engine.Run()`）并在控制台实时打印进度；
  4. 打印各设备热负荷/电耗与各物流温度、压力、流量、组分分布；
  5. 调用数据抓取模块，将结果落盘。
- **数据抓取模块 (`test_datacatch.py`)**：把一次 Aspen 运行的结果（设备热负荷/电耗、物流温度/压力/流量/组分）落盘为：
  - `outputdata/<模型名>/<时间戳>/results.json`
  - `outputdata/<模型名>/<时间戳>/blocks.csv`
  - `outputdata/<模型名>/<时间戳>/streams.csv`

  既可独立运行（自行打开 Aspen、计算、导出），也可被专用控制脚本作为模块直接调用。

## 目录结构

```
automatic/
├── test_aspen_control.py      # 模型扫描 + 专用控制脚本生成器
├── test_datacatch.py          # 结果抓取/导出模块（JSON + CSV）
├── generated/                 # 扫描结果 + 各模型专用控制脚本（自动生成）
│   ├── <模型名>_scan.json
│   └── <模型名>_control.py
└── outputdata/                # 每次运行导出的结果，按 模型名/时间戳 归档
    └── <模型名>/<时间戳>/
        ├── results.json
        ├── blocks.csv
        └── streams.csv
```

## 环境依赖

- Windows + 已安装 Aspen Plus（需要注册 `Apwn.Document` COM 组件）
- Python 3.x
- [pywin32](https://pypi.org/project/pywin32/)：

  ```bash
  py -3 -m pip install pywin32
  ```

## 使用方法

1. **扫描模型，生成专用控制脚本**

   ```bash
   py test_aspen_control.py "C:\path\to\your_model.bkp"
   ```

   不传参数时，默认扫描仓库内置的示例模型路径（需按实际环境修改脚本中的 `DEFAULT_MODEL_PATH`）。

2. **编辑生成的专用脚本**

   打开 `generated/<模型名>_control.py`，在 `BLOCKS_CONFIG` 中按需修改设备运行参数（如反应温度、压力、热负荷等），也可手工填写 `power_override_kW` 以在 Aspen 未直接输出功耗节点时补充数值。

3. **运行专用脚本，写入参数并计算**

   ```bash
   py generated\<模型名>_control.py
   ```

   运行完成后会在控制台打印设备/物流计算摘要，并自动导出结果到 `outputdata/`。

4. **单独抓取已运行模型的结果（可选）**

   ```bash
   py test_datacatch.py "C:\path\to\your_model.bkp"
   ```

## 注意事项

- 脚本中的模型路径为本机路径示例，请根据自己的环境替换。
- Aspen 的功耗节点单位为 kW，脚本已按此假设处理，请勿再除以 1000。
- `outputdata/` 中的结果按「模型名/时间戳」自动归档，便于追溯历史运行记录。
