"""Freeze one prospective v2 extension; no Aspen execution or model fitting."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[1]
sys.path.insert(0, str(ROOT))
from process_pipeline.profile import canonical_hash, validate_plan

read = lambda path: json.loads(path.read_text(encoding='utf-8-sig'))
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    output = BASE/'v2-extension-plan'
    if output.exists():
        raise ValueError('The v2 design directory already exists; never overwrite a frozen design')
    original = BASE/'generic-pilot-plan'; local = BASE/'local-perturbation-plan'
    profile, original_plan = read(original/'profile.json'), read(original/'plan.json')
    local_plan, local_mapping = read(local/'plan.json'), read(local/'mapping.json')
    bundle = read(BASE/'generic-native-pilot-analysis/model.bundle.json')
    criteria = read(original/'criteria.json')
    stamp = datetime.now(timezone.utc).isoformat()
    points = []
    for temperature in (317, 327, 337, 347):
        for length in (8, 16.5):
            points.append({'id': f'v2-train-T{temperature}-L{str(length).replace(".", "p")}',
                           'parameters': {'reactor_temperature_K': temperature+273.15, 'tube_length_m': length}, 'split': 'training'})
    for temperature, length in ((322, 9.75), (332, 14), (342, 18.25), (348, 6.75)):
        points.append({'id': f'v2-verify-T{temperature}-L{str(length).replace(".", "p")}',
                       'parameters': {'reactor_temperature_K': temperature+273.15, 'tube_length_m': length}, 'split': 'verification'})
    plan = {'plan_version': 1, 'profile_id': profile['id'], 'profile_sha256': canonical_hash(profile),
            'model_sha256': profile['model']['sha256'], 'points': points,
            'split_design': {'method': 'Prospectively frozen v2 extension after observing v1 errors',
                             'training_count': 8, 'verification_count': 4, 'original_splits_changed': False}}
    validate_plan(plan, profile)
    rows = []
    def add(point, batch, cohort):
        rows.append({'id': point['id'], 'split': point['split'], 'cohort': cohort, 'batch': batch,
                     'inputs': point['parameters'], 'source': f"{batch}/runs/{point['id']}/raw.json"})
    for point in original_plan['points']:
        add(point, 'generic-native-pilot-17', {'training': 'original_training_12', 'holdout': 'legacy_holdout_3', 'verification': 'legacy_verification_2'}[point['split']])
    mapped = {row['id']: row for row in local_mapping}; excluded = []
    for point in local_plan['points']:
        mapping = mapped[point['id']]
        if mapping['new_coordinate']:
            add(point, 'native-local-perturbation-9', 'local_verification_8')
        else:
            excluded.append({'id': point['id'], 'batch': 'native-local-perturbation-9',
                             'original_point_id': mapping['original_point_id'], 'original_split': mapping['original_split'],
                             'inputs': point['parameters'], 'source': f"native-local-perturbation-9/runs/{point['id']}/raw.json",
                             'reason': 'Repeated original holdout coordinate; retain separately, never duplicate in the fitting dataset or relabel as new verification'})
    for point in points:
        add(point, 'native-v2-extension-12', 'extension_training_8' if point['split'] == 'training' else 'prospective_verification_4')
    ids = [row['id'] for row in rows]
    coordinates = [tuple(row['inputs'][key] for key in ('reactor_temperature_K', 'tube_length_m')) for row in rows]
    counts = dict(Counter(row['split'] for row in rows)); cohort_counts = dict(Counter(row['cohort'] for row in rows))
    assert len(rows) == len(set(ids)) == len(set(coordinates)) == 37
    assert counts == {'training': 20, 'holdout': 3, 'verification': 14}
    assert len(excluded) == 1 and excluded[0]['original_point_id'] == 'case-008'
    original_by_id = {point['id']: point for point in original_plan['points']}
    assert all(row['split'] == original_by_id[row['id']]['split'] and row['inputs'] == original_by_id[row['id']]['parameters'] for row in rows if row['batch'] == 'generic-native-pilot-17')
    assert canonical_hash(profile) == bundle['profile_sha256']
    assert criteria['criteria'] == bundle['validation_policy']
    cohorts = {'cohort_version': 1, 'source_paths_relative_to': 'outputs/workspace-bilingual-20261117',
               'rows': rows, 'counts': counts, 'cohort_counts': cohort_counts, 'excluded_repeats': excluded,
               'fresh_independent_cohort': 'prospective_verification_4',
               'previously_known_verification_cohorts': ['legacy_verification_2', 'local_verification_8'],
               'reporting': 'Report every cohort separately; all 14 verification rows also remain in the combined qualification gate. Legacy holdout and verification are development evidence for v2, not newly independent tests.'}
    table = '\n'.join(f"| {point['id']} | {point['parameters']['reactor_temperature_K']-273.15:g} | {point['parameters']['reactor_temperature_K']:g} | {point['parameters']['tube_length_m']:g} | {point['split']} |" for point in points)
    note = f'''# HTL v2：一次前瞻冻结扩点计划

冻结时间（UTC）：{stamp}。本次只准备计划，没有运行 Aspen、求解新增响应或拟合 v2。

## 分版与已知信息

原 v1 的17点、12/3/2分组、5%标准和全部失败结论保持不变。已知335 ℃ /8.5 m独立复核点三响应超过5%；345 ℃ /17.5 m均通过。此次扩点是在看到v1误差后选择的自适应开发设计，不能把v1已知校验点称为v2全新独立验证。原模型与原bundle不覆盖。

基线模型SHA-256：`{bundle['model_sha256']}`。
基线bundle SHA-256：`{bundle['bundle_sha256']}`。
Aspen源归档SHA-256：`{profile['model']['sha256']}`。
不修改压力、物性/动力学或产品定义，不扩充全厂LCA边界。复用相同profile、原生单位、fixed/linked控制、固定背景因子。

## 这次唯一的新增原生任务

8个训练点为T=317/327/337/347 ℃ × L=8/16.5 m；4个此前未求解的新保留复核点如表。原生温度按℃+273.15精确转K，长度保持meter。12点均与原17点及局部9点不重合。执行顺序按plan，原生COM由主任务串行启动；本准备脚本不调用COM。

| 新ID | ℃ | K | m | 固定分组 |
|---|---:|---:|---:|---|
{table}

新原生任务建议输出目录为`native-v2-extension-12`，与`cohorts.json`的来源批次一致。源文件只读，每点使用独立副本；超时、清理不确定、源身份改变按既有runner规则停止剩余点并保留未尝试行，不自动补点。

## 合并数据：37个唯一坐标，保留全部来源

- training20 = 原12 + 新8；任何holdout/verification都不能移入训练。
- holdout3 = 原3，仍保留旧split，报告为legacy/development evidence。
- verification14 = 原2 + 局部8 + 新4。新4作为该v2前瞻保留组单列，原2和局部8作为另两个组单列；不能只展示混合后的平均误差。
- 原局部9点的中心`local-05`重复原`case-008` holdout坐标，重复运行文件和比较结果独立留存，不再放进合并dataset，不能算第38个唯一点。
- `cohorts.json`冻结每个计划ID、坐标、split、批次命名空间和来源。原始dataset文件不改写；合并时另建v2 dataset，给source保留批次，绑定三批dataset/raw证据哈希。
- 即使原生失败/未尝试，计划行也保留；不得删掉、替换或换成预测值。任何37个计划唯一点缺失或门禁未通过，都阻断完整v2验收，不允许用幸存点通过。

## 拟合和误差政策

只执行一次v2拟合，仅用合格的20个计划training的原生输出。固定Matérn5/2核族和现有训练-only边际似然优化策略；输入标准化及输出普通中心化/缩放只来自training。使用既有默认噪声方差1e-8、alpha1e-10、random_state20261117、optimizer重启0，不进行超参数搜索、核比较或根据复核结果调参重试。

`criteria.json`与v1原文件字节一致：每响应最大相对误差<=0.05；相对分母floor能耗0.01 kWh/kg、目标/feed0.001 fraction、气候影响0.01 kg CO2-eq/kg。floor用于接近零分母，不是排除工况的阈值。这是预测误差验收，不是能耗/碳足迹/产率的工况达标门槛。

原3holdout与全部14verification仍进入总体门禁；另外必须对legacy2、local8和prospective4逐组报告数量、失败、MAE、RMSE、最大相对误差及原生/预测值。新4通过不能掩盖其他组失败；新4不通过也不能靠13个旧/局部点平均稀释。旧数据与局部数据曾参与设计判断，不承担新独立验证的地位。

实现注意：现有通用`evaluate`只按holdout/verification汇总，需用冻结cohort映射对其记录另行分组展示，而不改拟合/标准；fresh4-only dataset没有2个holdout会触发通用准备门禁，不能把这种调用结果混同于fresh4响应失败。合并数据的split与本文件一致即可维持原整体门禁。

任何计划原生行失败都阻断完整验收。若训练点失败，保留证据并阻断合格v2发布；若仍生成受限诊断拟合，必须明确exploratory，不得仅因幸存训练上的validation.passed就发布普通预测。缺失行不得悄悄补跑替换。若单次拟合或原5%验收不通过，保留v2探索性结果，不移动标准、不重分组、不调参重试。

## 声明范围

20训练点加4个新保留点仍是小型方法示范，不能证明全连续域准确、物理可靠性、概率鲁棒性或新的完整LCA。凸包门禁继续仅阻止外推。若重新使用原9候选/9情景，应绑定v2新modelhash并单独版本输出，保留v1原81查询和排名，不以v2替换历史失败。

## 冻结检查

`manifest.json`记录profile/plan/criteria/cohort/本文字节哈希、原17点及局部9点设计哈希、v1模型绑定和当前算法源码哈希。执行前核对；本目录存在后准备脚本拒绝覆盖。准备脚本未读取尚未完成的local9响应，也未读取任何新12点响应。
'''
    files = {'profile.json': (original/'profile.json').read_bytes(), 'criteria.json': (original/'criteria.json').read_bytes(),
             'plan.json': (json.dumps(plan, ensure_ascii=False, allow_nan=False, indent=2)+'\n').encode('utf-8'),
             'cohorts.json': (json.dumps(cohorts, ensure_ascii=False, allow_nan=False, indent=2)+'\n').encode('utf-8'),
             'PREREGISTRATION.md': note.encode('utf-8')}
    bindings = [original/'manifest.json', original/'plan.json', original/'profile.json', original/'criteria.json',
                local/'manifest.json', local/'plan.json', local/'mapping.json',
                BASE/'generic-native-pilot-analysis/model.bundle.json', BASE/'generic-native-pilot-analysis/evaluation.json',
                ROOT/'process_pipeline/surrogate.py', ROOT/'process_pipeline/robustness.py', Path(__file__)]
    manifest = {'preregistration_version': 1, 'version': 'v2-extension', 'created_at': stamp,
                'design_status': 'Prospective extension chosen after reviewing v1 errors; no v2 native responses yet',
                'profile_id': profile['id'], 'profile_sha256': canonical_hash(profile), 'native_model_sha256': profile['model']['sha256'],
                'baseline_model_sha256': bundle['model_sha256'], 'baseline_bundle_sha256': bundle['bundle_sha256'],
                'new_case_count': 12, 'new_training_count': 8, 'new_prospective_verification_count': 4,
                'combined_unique_coordinate_count': 37, 'combined_split_counts': counts, 'combined_cohort_counts': cohort_counts,
                'excluded_duplicate_native_runs': excluded, 'algorithm': {'family': 'constant_times_matern52_plus_fixed_white',
                    'noise_level': 1e-8, 'alpha': 1e-10, 'random_state': 20261117, 'n_restarts_optimizer': 0,
                    'training_only_hyperparameter_optimization': True, 'maximum_fit_attempts': 1, 'holdout_based_tuning_allowed': False},
                'criteria_unchanged': True, 'original_splits_unchanged': True, 'all_planned_unique_native_cases_required_for_complete_acceptance': True,
                'canonical_sha256': {'plan.json': canonical_hash(plan), 'criteria.json': canonical_hash(criteria), 'cohorts.json': canonical_hash(cohorts)},
                'file_sha256': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()},
                'source_file_sha256': {str(path.relative_to(ROOT)).replace('\\', '/'): digest(path) for path in bindings},
                'preflight': {'schema_accepted': True, 'unique_coordinates': True, 'no_new_coordinate_overlap_with_prior_native_designs': True,
                              'all_original_splits_preserved': True, 'domain_and_native_units_unchanged': True},
                'native_execution_performed': False, 'model_fit_performed': False, 'new_response_data_read': False,
                'physical_validation': False}
    output.mkdir()
    for name, data in files.items():
        (output/name).write_bytes(data)
    (output/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, allow_nan=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'output': str(output), 'created_at': stamp, 'plan_sha256': canonical_hash(plan),
                      'split_counts': counts, 'cohort_counts': cohort_counts, 'native_execution_performed': False, 'model_fit_performed': False}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
