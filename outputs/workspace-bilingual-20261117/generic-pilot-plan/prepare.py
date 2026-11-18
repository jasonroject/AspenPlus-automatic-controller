"""Prepare the preregistered 17-case pilot. No Aspen/COM calls or model fitting."""
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from process_pipeline.profile import canonical_hash, digest, read_json, validate_plan
from process_pipeline.runner import build_dataset
from process_pipeline.surrogate import _criteria


def write(name, value):
    path = Path(__file__).parent / name
    if path.exists():
        raise ValueError(f"Frozen artifact already exists: {path}")
    path.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n", encoding="utf-8")


def main():
    output = Path(__file__).parent
    if any((output / name).exists() for name in ("profile.json", "plan.json", "criteria.json", "queries.json", "manifest.json", "PREREGISTRATION.md")):
        raise ValueError("This pilot is already frozen; verify it instead of regenerating or overwriting")
    profile_source = ROOT / "process_pipeline/examples/htl-model-profile.json"
    shutil.copy2(profile_source, output / "profile.json")
    profile = read_json(output / "profile.json")
    script = r'''
import {readFileSync} from 'node:fs';
import {buildPlan} from './analysis_web/model-plan.mjs';
const profile = JSON.parse(readFileSync(process.argv[1], 'utf8'));
const plan = buildPlan(profile, {
  reactor_temperature_K: {min: 310 + 273.15, max: 350 + 273.15, count: 5},
  tube_length_m: {min: 5, max: 20, count: 3}
}, 'frozen');
process.stdout.write(JSON.stringify(plan));
'''
    generated = subprocess.run(["node", "--input-type=module", "-e", script, str(output / "profile.json")],
                               cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8")
    plan = json.loads(generated.stdout)
    frozen_grid = deepcopy(plan["points"])
    plan["profile_sha256"] = canonical_hash(profile)
    plan["split_design"]["verification_count"] = 2
    plan["split_design"]["verification_addition"] = "Two prospectively assigned off-grid verification cases; no grid split reassignment"
    plan["points"] += [
        {"id": "verify-T335-L8p5", "parameters": {"reactor_temperature_K": 335 + 273.15, "tube_length_m": 8.5}, "split": "verification"},
        {"id": "verify-T345-L17p5", "parameters": {"reactor_temperature_K": 345 + 273.15, "tube_length_m": 17.5}, "split": "verification"}]
    validate_plan(plan, profile)
    criteria = {"criteria": {
        "purchased_energy_kWh_kg": {"unit": "kWh/kg", "max_relative_error": .05, "relative_floor": .01},
        "yield_fraction": {"unit": "1", "max_relative_error": .05, "relative_floor": .001},
        "impact:Climate change": {"unit": "kg CO2-eq/kg", "max_relative_error": .05, "relative_floor": .01}}}
    responses = build_dataset(profile, {"cases": []})["responses"]
    _criteria(criteria, responses)
    assert set(criteria["criteria"]) == {response["id"] for response in responses}
    queries = {"units": {"reactor_temperature_K": "K", "tube_length_m": "meter"}, "points": [
        {"reactor_temperature_K": 325 + 273.15, "tube_length_m": 10},
        {"reactor_temperature_K": 335 + 273.15, "tube_length_m": 8.5},
        {"reactor_temperature_K": 345 + 273.15, "tube_length_m": 17.5}]}
    coordinate = lambda point: tuple(point["parameters"][key] for key in ("reactor_temperature_K", "tube_length_m"))
    coordinates = [coordinate(point) for point in plan["points"]]
    assert len(coordinates) == len(set(coordinates)) == 17
    assert len({point["id"] for point in plan["points"]}) == 17
    assert plan["points"][:15] == frozen_grid
    counts = dict(Counter(point["split"] for point in plan["points"]))
    assert counts == {"training": 12, "holdout": 3, "verification": 2}
    corners = {(temperature + 273.15, length) for temperature in (310, 350) for length in (5, 20)}
    training = {coordinate(point) for point in plan["points"] if point["split"] == "training"}
    assert corners <= training
    for point in plan["points"]:
        temperature, length = coordinate(point)
        assert 583.15 <= temperature <= 623.15 and 5 <= length <= 20
    for query in queries["points"]:
        assert 583.15 <= query["reactor_temperature_K"] <= 623.15 and 5 <= query["tube_length_m"] <= 20
    write("plan.json", plan)
    write("criteria.json", criteria)
    write("queries.json", queries)
    manifest = {"preregistration_version": 1, "created_at": datetime.now(timezone.utc).isoformat(),
                "native_execution_performed": False, "model_fit_performed": False,
                "profile_id": profile["id"], "profile_sha256": canonical_hash(profile),
                "native_model_sha256": profile["model"]["sha256"],
                "canonical_sha256": {"plan.json": canonical_hash(plan), "criteria.json": canonical_hash(criteria), "queries.json": canonical_hash(queries)},
                "file_sha256": {name: digest(output / name) for name in ("profile.json", "plan.json", "criteria.json", "queries.json")},
                "source_sha256": {str(path.relative_to(ROOT)).replace("\\", "/"): digest(path) for path in
                                  (profile_source, ROOT / "analysis_web/model-plan.mjs", ROOT / "process_pipeline/surrogate.py")},
                "preflight": {"schema_accepted": True, "counts": counts, "unique_ids_and_coordinates": True,
                              "grid_splits_equal_current_web_builder": True, "all_four_corners_training": True,
                              "planned_training_hull_equals_declared_rectangle": True,
                              "responses_and_criteria_units_match_runner_contract": True,
                              "supported_domain_if_training_failures": "Recomputed from accepted training rows; no extrapolation or silent replacement"},
                "responses": responses}
    write("manifest.json", manifest)
    rows = "\n".join(f"| {p['id']} | {p['parameters']['reactor_temperature_K'] - 273.15:.0f} | {p['parameters']['reactor_temperature_K']:.2f} | {p['parameters']['tube_length_m']:g} | {p['split']} |" for p in plan["points"])
    note = f'''# 通用适配器 HTL 小型真实扫描：预注册

冻结时间（UTC）：{manifest['created_at']}。本目录只准备计划、误差检验标准和查询，不运行 Aspen、不拟合模型，也不包含新的模拟结果。

## 冻结对象与研究边界

- `profile.json` 原样复制当前已审阅配置，canonical SHA-256：`{manifest['profile_sha256']}`。
- 原生 `.bkp` SHA-256：`{manifest['native_model_sha256']}`。执行时必须使用匹配的原文件；每点另建副本，原文件不保存、不修改。
- 当前 profile 的 review 文字保留当时状态，不为本次计划修改其哈希。既有单点验证证据在相邻 `native-pilot-01`，它不加入本次训练集。
- 本次仅 HR、原有 HTL 反应/物性模型与压力约束；只扫描反应器温度和管长。加热器温度等于反应器温度；固定积分控制保留 profile 声明和逐点回读。
- 产率为目标组分出口质量/原料质量，并非分离回收率。能耗按该 profile 的受限购能清单、每 kg 目标组分计；气候影响继承既定前景清单与因子，不扩称完整全厂 LCA 或物理验证。

## 在看到本次结果之前冻结的设计

15 点为 T=310/320/330/340/350 ℃ × L=5/12.5/20 m。原生温度精确按摄氏温度+273.15表示为 K，长度保持原生 `meter`。直接调用当前 `analysis_web/model-plan.mjs` 的 `buildPlan(...,'frozen')`，不手工重分组：12 training、3 holdout，四个角点均为训练点。追加两点 verification，不进入拟合。

| ID | ℃ | K | m | 冻结 split |
| --- | ---: | ---: | ---: | --- |
{rows}

独立维度为2，训练点为12，满足现有工程准备检查最少6点；四角完整且无共线，计划训练凸包覆盖声明矩形。17个ID/坐标均唯一，3个holdout和2个verification不与训练重复。只有3个留出点和2个验证点，不能据此宣称全域准确。若训练角点失败，实际可预测域会收缩，由接受的训练坐标重新计算。

## 预注册预测误差检验

所有响应、每个声明的验证 split 均要求最大相对误差不超过0.05：

`max_i(abs(predicted_i - native_i) / max(abs(native_i), relative_floor)) <= 0.05`

| 响应 | 单位 | relative_floor | 最大相对误差 |
| --- | --- | ---: | ---: |
| purchased_energy_kWh_kg | kWh/kg | 0.01 | 0.05 |
| yield_fraction | 1 | 0.001 | 0.05 |
| impact:Climate change | kg CO2-eq/kg | 0.01 | 0.05 |

这些是预测对原生模拟输出的误差检验，不是工况达标门槛；floor 与响应同单位，只处理接近零的分母，不是排除低响应点的筛选线。MAE、RMSE仍报告。每个失败的holdout/verification保留并使该验证组不完整，不能仅用幸存点通过检验。

拟合只使用合格 training 行。固定 Matérn 5/2 核族，固定归一化白噪声方差1e-8、alpha=1e-10、random_state=20261117、优化器重启0次；超参数只由训练数据的边际似然优化。响应普通中心化/缩放，不对holdout/verification拟合，不借用旧HTL模型或既有单点数值。配置未通过不得据结果改核、调门槛、重分组或把失败点悄悄换成新点；若要新一轮，须另立计划。

## 失败、预测与执行规则

每点运行副本，保留原始readout、输入前后回读、报告、警告及五个独立gate。普通求解不通过且明确关闭的案例留为失败，可继续安全点；soft/hard timeout、Stop失败、清理未知或源身份变化停止剩余原生批次，剩余计划保留为not attempted。

预测仅在声明范围与实际接受训练凸包内。若任何预注册响应/验证组不通过，默认不开放普通预测；可明确 `--allow-exploratory` 输出标记探索性的均值，仍禁止外推，不生成概率置信带。所有失败保留，无工况达标门槛，无物理可靠性结论。

`queries.json` 预先包含325℃/10m以及两条verification坐标；前者为后续演示查询，后两者便于与原生验证值对照。查询不增加原生执行点，不参与拟合，不代替全部holdout/verification检验。

从仓库根目录运行：

```powershell
python -m process_pipeline.cli validate-profile --profile "{output / 'profile.json'}" --plan "{output / 'plan.json'}"
python -m process_pipeline.cli scan --profile "{output / 'profile.json'}" --plan "{output / 'plan.json'}" --model "<匹配上述SHA-256的原生bkp绝对路径>" --output "<新的运行目录绝对路径>"
python -m process_pipeline.surrogate fit "<运行目录>/dataset.json" --config "{output / 'criteria.json'}" --output "<运行目录>/surrogate.bundle.json"
python -m process_pipeline.surrogate evaluate "<运行目录>/surrogate.bundle.json" --output "<运行目录>/surrogate.evaluation.json"
python -m process_pipeline.surrogate predict "<运行目录>/surrogate.bundle.json" --points "{output / 'queries.json'}" --output "<运行目录>/surrogate.predictions.json"
```

`manifest.json` 同时记录文件字节哈希和Python canonical JSON哈希，以及当前web分组函数/拟合代码的文件哈希。`prepare.py`会拒绝覆盖已冻结目录。执行前确认本目录各文件哈希仍与manifest一致；原生运行由主任务另外触发。
'''
    (output / "PREREGISTRATION.md").write_text(note, encoding="utf-8")
    print(json.dumps({"directory": str(output), "profile_sha256": manifest["profile_sha256"], "counts": counts,
                      "preflight": manifest["preflight"], "native_execution_performed": False}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
