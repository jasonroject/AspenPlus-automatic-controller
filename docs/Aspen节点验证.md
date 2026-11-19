# Aspen 节点路径验证（需要真机 Aspen）

目的：`aspen_rules.RECIPES` 里下面这些块类型的结果节点仍是 `[推断]`，要在真机读一次，把证据存成夹具，之后由测试固定下来。

| 块类型 | RECIPES 当前读取（未验证） | 额外要看的 |
|---|---|---|
| Compr | 功：`ELEC_POWER` / `BRAKE_POWER` / `WNET` | **透平功的符号**：出口压力低于进口时功应为负 |
| MCompr | 功：`WNET` / `BRAKE_POWER` | 各级节点名（看 `output_children`） |
| RStoic / RYield / RGibbs / RCSTR | 热：`QCALC` / `QNET` | `B_TEMP` |
| Flash3 | 热：`QCALC` / `QNET` | `B_TEMP` |

脚本是只读的：每个模型先复制到临时目录，用与 `probe` 相同的适配器运行并读取，源文件哈希前后对比。Aspen 一次只开本次启动的实例，结束后自动清理。**脚本我们没有运行过**（盒子里没有 Aspen），只用假 COM 树测过；真机上若有报错，请把终端输出原样发回。

## 在 Roice 的电脑上（PowerShell，项目根目录）

```powershell
# 0. 取代码；需要 Python 3 + pywin32；关闭手动打开的 Aspen 窗口，避免和自动化实例混淆
git fetch origin
git checkout feat/aspen-adapter-integration
git pull --ff-only
python -m pip install pywin32

# 1. 找 Aspen 自带示例目录（版本号不同路径会不同）
$ex = Get-ChildItem "C:\Program Files\AspenTech" -Recurse -Directory -Filter Examples -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -like "*GUI*" } | Select-Object -First 1 -ExpandProperty FullName
$ex

# 2. 文本扫描：哪些示例含目标块类型（不启动 Aspen；.bkp 按文本扫描是 [推断]，没找到不等于不存在）
python -X utf8 -m aspen_study.verify_nodes find $ex

# 3. 先验证 HTL RYIELD.bkp（含 RYield），再逐个验证第 2 步列出的示例。把路径换成真实路径：
python -X utf8 -m aspen_study.verify_nodes verify "C:\path\to\HTL RYIELD.bkp"
python -X utf8 -m aspen_study.verify_nodes verify "$ex\<含 Compr 的示例>.bkp" "$ex\<含 MCompr 的示例>.bkp" "$ex\<含 RStoic/RGibbs/RCSTR/Flash3 的示例>.bkp" --timeout 1200

# 4. 离线检查已保存的夹具：列出问题和仍未覆盖的类型（退出码 1 = 有问题）
python -X utf8 -m aspen_study.verify_nodes check

# 5. 跑测试（夹具出现后，对应的测试不再跳过）
python -X utf8 -m unittest aspen_study.tests.test_live_node_fixtures -v
python -X utf8 -m unittest discover -s aspen_study/tests -t .

# 6. 提交夹具（只提交这个目录；不要提交 .bkp）
git add aspen_study/tests/fixtures/live/nodes
git commit -m "test(aspen_study): live node-path fixtures for <模型名>"
git push
```

### 要保存的输出与位置

`verify` 自动写入 `aspen_study/tests/fixtures/live/nodes/`，每个模型三个文件，**要一起提交**：

| 文件 | 内容 |
|---|---|
| `<模型名>.nodes.json` | `aspen-node-verification/1`：每个块的全部候选节点（是否存在、数值、UnitString、是否标量）、`...\Output` 下的全部子节点名、RECIPES 实际用到的节点、Compr/MCompr 的功符号检查、`coverage`（已覆盖/未覆盖的类型） |
| `<模型名>.probe-summary.json` | 同一次运行的 `aspen-probe/1.1` |
| `<模型名>.graph.json` | 同一次运行的 `aspen-model-graph/1`（三个文件也能直接组成结果包） |

文件名里的空格会变成下划线（`HTL RYIELD.bkp` → `HTL_RYIELD.*`）。

### 怎么看结果

- 终端对每个模型打印 `run=ok/warning/error`，对每个问题打印 `PROBLEM: ...`，最后打印 `coverage` 和 `NOT covered yet: ...`。
- `PROBLEM: <块> (<类型>): no energy node read by RECIPES; readable scalar nodes here: [...]; all Output children: [...]`：RECIPES 里的节点名在真机不存在。把列出的真实节点名发回，我们改 RECIPES（不要自己猜）。
- `work sign inverted`：透平/压缩机功的符号与压力变化相反，需要先确认是哪个节点、再决定是否在适配器里取反；不要直接改测试。
- `run itself failed`：模型本身报错，先在 Aspen 里修好；这类夹具不会被接受。
- 如果示例里没有出口压力低于进口的 Compr（`NOT covered yet: turbine`）：在 Aspen 里把一个含 Compr 的示例**另存为副本**（`Save As` 到临时目录，不要改原示例），把该 Compr 的类型改为 Isentropic Turbine（或把出口压力设得低于进口），运行一遍，再对这个副本执行第 3 步的 `verify`。副本不要提交。

### 测试（`aspen_study/tests/test_live_node_fixtures.py`，夹具出现前全部 skipped）

| 测试 | 检查 |
|---|---|
| `test_fixtures_are_well_formed_and_pass_the_checks` | 运行完成无错误、源文件未变、每个目标块读到了能量节点、单位可识别（`to_kW`）、节点名在 RECIPES 里 |
| `test_companion_probe_files_are_valid_and_same_model` | 同名 summary/graph 通过 schema，且与 nodes 的模型 sha256 一致 |
| `test_every_numeric_energy_reading_has_a_unit` | 每个数值都有单位字符串，且能换算 |
| `test_compr_/mcompr_/rstoic_/ryield_/rgibbs_/rcstr_/flash3_energy_node_path` | 该类型的每个块都读到能量节点，种类（heat/work）与 RECIPES 一致；没有这个类型的夹具时只跳过该条 |
| `test_compressor_work_is_positive` / `test_turbine_work_is_negative` | 压力升高的 Compr/MCompr 功 > 0；压力降低的 < 0 |

夹具通过后的下一步（我们来做）：把对应 RECIPES 条目的 `verified` 标志改为 `True`，并把不同于推断的节点名更新进去。
