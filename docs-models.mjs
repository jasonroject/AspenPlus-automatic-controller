// Native-model documentation shares exact commands between interface languages.
const commands=[
'python -m process_pipeline.cli inspect-model --model "C:\\models\\process.bkp" --output "C:\\analysis\\discovery.json"',
'python -m process_pipeline.cli scan --profile "C:\\analysis\\aspen-profile.json" --plan "C:\\analysis\\scan-plan.json" --model "C:\\models\\process.bkp" --output "C:\\analysis\\job-001"',
'python -m process_pipeline.surrogate fit "C:\\analysis\\job-001\\dataset.json" --config "C:\\analysis\\criteria.json" --output "C:\\analysis\\model.bundle.json"\npython -m process_pipeline.surrogate evaluate "C:\\analysis\\model.bundle.json" --output "C:\\analysis\\evaluation.json"',
'python -m process_pipeline.robustness "C:\\analysis\\model.bundle.json" --config "C:\\analysis\\scenarios.json" --output "C:\\analysis\\scenario-results.json"',
'python -m process_pipeline.cli validate-profile --profile "C:\\analysis\\aspen-profile.json" --model "C:\\models\\process.bkp"',
JSON.stringify({config_version:1,candidates:[{id:'candidate-a',inputs:{reactor_temperature_K:598.15,tube_length_m:8.5}},{id:'candidate-b',inputs:{reactor_temperature_K:608.15,tube_length_m:12.5}}],perturbations:{reactor_temperature_K:{unit:'K',halfwidth:1},tube_length_m:{unit:'meter',halfwidth:.25}},scenarios:[{id:'center',offsets:{reactor_temperature_K:0,tube_length_m:0}},{id:'lower-both',offsets:{reactor_temperature_K:-1,tube_length_m:-1}},{id:'higher-both',offsets:{reactor_temperature_K:1,tube_length_m:1}}],preferences:[{id:'equal',weights:{purchased_energy_kWh_kg:1,yield_fraction:1,'impact:Climate change':1}}]},null,2)
];
const code=(index,label='PowerShell')=>'<div class="code-block"><div class="code-bar"><span>'+label+'</span><button class="copy-button" type="button" aria-label="Copy '+label+' example">Copy</button></div><pre><code>'+commands[index]+'</code></pre></div>';
const pilotErrors=(zh=false)=>'<div class="table-wrap" tabindex="0" role="region" aria-label="'+(zh?'17 点代理模型误差':'17-case surrogate errors')+'"><table><thead><tr><th>'+(zh?'最大相对误差':'Maximum relative error')+'</th><th>'+(zh?'留出集 · 3 点':'Holdout · 3 points')+'</th><th>'+(zh?'独立复核 · 2 点':'Independent verification · 2 points')+'</th></tr></thead><tbody>'+[
  [zh?'单位产品购入能耗':'Purchased-energy intensity','1.4443%','5.7618%'],
  [zh?'目标产物 / 进料产率':'Target / feed yield','0.7308%','9.7716%'],
  [zh?'声明的气候影响':'Declared climate impact','1.3345%','9.5367%']
].map(row=>'<tr>'+row.map(value=>'<td>'+value+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
export const localModelsDoc={
id:'models',group:'Build with the module',title:'Local Aspen models',
description:'Review a model profile, prepare a bounded scan, then import traceable energy and environmental results.',
body:[
'<div class="hero-actions" style="justify-content:flex-start"><a class="pill-button" href="models.html">Open local models →</a></div>',
'<h2 id="review">1. Inspect and review the model</h2>',
'<p>The browser does not run native Aspen files. With a local licensed Aspen installation, inspect a copied <code>.bkp</code> archive to list its input/output nodes and native units. Discovery reads the model without solving it. Its generated profile stays an <strong>incomplete draft</strong> until you declare safe numeric inputs and ranges, accepted solver status codes, topology, enthalpy basis, product/feed and the LCA mapping.</p>',
'<p>External steady-state models, including recycle loops, can use the same contract after review. A process name does not supply a valid mapping, utility efficiency or environmental factor. Save an <code>.apw</code> file as a separate <code>.bkp</code> in Aspen first. The source archive is preserved and bound by SHA-256.</p>',
'<p>For the full local workflow, use Python 3.12 or later and install <code>process_pipeline/requirements.txt</code> in a dedicated virtual environment. It includes the scientific stack and Windows COM bindings; Aspen and Node.js are separate installations. Run the commands with that environment’s Python. The repository README includes installation checks and a replay example that never starts Aspen.</p>',
code(0),'<p>The command writes <code>discovery-profile-draft.json</code>. Complete its missing mappings and review the native units and operating assumptions before setting <code>review.state</code> to <code>reviewed</code>. Save the completed file as <code>aspen-profile.json</code>, then validate it:</p>',code(4),
'<h2 id="plan">2. Review the plan and run locally</h2>',
'<p>Load the reviewed profile on the <a href="models.html">local models page</a>, then select <strong>Plan the scan →</strong>. Set lower/upper values and point counts in the displayed native units. For a first pilot, choose <strong>Verification only</strong>; for fitting, choose <strong>Frozen training + holdout design</strong>. Custom JSON plans can also declare verification points. Review linked/fixed controls and operating constraints; the planner does not infer them.</p>',
'<p>Select <strong>Preview scan plan</strong>, inspect the generated rows, then <strong>Continue to local execution →</strong>. After confirming the review checkbox, download <code>aspen-profile.json</code> and <code>scan-plan.json</code>. Keep the total at or below 100 points. Put these files at the paths used by the command below and choose a new output directory.</p>',
'<p>The local runner opens a separate copied archive for each point and writes only the numeric Input paths in the reviewed whitelist. It checks exact unit strings and input readback, runs serially and retains failures. A solver or cleanup failure stays in the job ledger. Website language changes do not alter setpoints or case IDs.</p>',code(1),
'<h2 id="import-results">3. Import and inspect results</h2>',
'<p>Import <code>project.json</code> from the completed job on the local models page, then open it in process analysis. Review the retained scan summary before calculating. <code>ledger.json</code> lists every planned point, including normalization failures; per-case raw captures and reports remain in the local job directory. <code>dataset.json</code> contains audited metrics and frozen splits for optional prediction.</p>',
'<p>Keep five checks separate: automation returned, native status accepted, numerical closure, complete category factors, and complete metric inputs. A passed balance does not establish thermophysical accuracy or experimental validation. Inventory-based LCA still needs explicit external quantities, factor methods and sources; missing factors produce incomplete results.</p>',
'<h2 id="prediction">Optional prediction and robustness</h2>',
'<p>The generic local surrogate fits accepted training cases and reports errors on reserved cases. Create <code>criteria.json</code> with unit-matched prediction-error limits for every response; the scan does not generate this policy. Its schema is documented in the repository’s <code>process_pipeline/SURROGATE.md</code>. Ordinary prediction requires passing those checks. Failed validation cases stay in the assessment. Queries must stay within both the declared range and the actual training convex hull.</p>',code(2),
'<p>Predicted energy or impacts approximate supplied response labels; they do not run a fresh balance or rebuild an LCA inventory. Use <a href="#fuzzy">fuzzy supports and preference comparisons</a> for declared input/weight variation, and the separate <a href="#htl">HTL workspace</a> for its existing operating-variation analysis. Grid shares, fuzzy supports and validation errors are different quantities; none is an automatic probability of real-world success.</p>',
'<h2 id="scenarios">Compare finite scenarios</h2>',
'<p>Prepare a scenario configuration with candidate inputs, exact units, perturbation widths, explicit scenario offsets and response weights. Then use the frozen model to generate a result file:</p>',code(3),
'<details><summary>Example scenario configuration</summary><p>Save as <code>scenarios.json</code>. These keys match the HTL profile example; replace names, units, candidates and widths with your own model declarations. This explicitly tests three shared offset scenarios, not every combination in a continuous region.</p>',code(5,'JSON'),'</details>',
'<p>On <a href="models.html">Local models</a>, use <strong>Already have results? Open files →</strong> and select <strong>Choose model results JSON</strong> to import <code>scenario-results.json</code>. This is a model-result file; use the separate combined-project input for energy/LCA <code>project.json</code>. Inspect metric ranges, coverage and rank stability before comparing candidates.</p>',
'<p>The reported leading shares divide credit among ties over the selected deterministic scenarios, for each declared preference. They are not probabilities of success. Any unsupported candidate/scenario keeps its diagnostic and withholds the complete global ranking. No operating-performance threshold is imposed; the predictor’s error checks are separate. This analysis neither refits the model nor recalculates background LCA factors.</p>',
'<h2 id="pilot">Try the 17-case native pilot</h2>',
'<p>All 17 copied-model HTL runs passed the declared execution and accounting checks. Their frozen assignment is <strong>12 training, 3 holdout and 2 independent verification points</strong>. At the 335 °C / 8.5 m verification point, all three responses exceeded the prespecified 5% relative-error limit; the 345 °C / 17.5 m point passed all three checks. The verification group therefore failed, so <strong>ordinary prediction remains disabled</strong>. Its prediction and scenario files are explicitly exploratory.</p>',pilotErrors(),
'<p>This HR pilot reports purchased energy in kWh/kg outlet target and climate impact per kg of the same target; yield is the target/feed mass ratio. The target is catechol + o-cresol before separation. The older HTL lab instead displays electricity and target mass per 100 kg wet feed over 1 h, while its footprint remains per kg target. Compare only after aligning these denominators and declared inventories.</p>',
'<p>Open <a href="models.html">Local Aspen models</a> to try the 17-case project and inspect model checks, mean predictions or finite scenarios. Complete scenario coverage means every requested query was evaluated; it does not mean the predictor passed validation. Leading shares are not probabilities, and the run checks do not establish physical validation. This generic pilot is separate from the older HTL reference model.</p>',
'<p>For source scope and reproducibility, read the <a href="data/generic-htl-pilot/README.md">pilot package notes</a> or download the <a href="data/generic-htl-pilot/index.json" download>file manifest and hashes</a>. Native model archives and private raw execution directories are not included.</p>',
'<h2 id="artifacts">Files and recovery</h2>',
'<ul><li><code>profile.json + plan.json</code>: reviewed mappings and frozen requested inputs.</li><li><code>ledger.json + runs/</code>: every success/failure, raw evidence, warnings and source lineage.</li><li><code>project.json</code>: browser five-table project, including scan_audit.</li><li><code>dataset.json</code>: audited responses and splits for the generic surrogate.</li><li><code>model.bundle.json</code>: frozen model state, source identity and validation status.</li></ul>',
'<p>Use a new absolute output directory for each native job. Existing evidence is retained. A draft profile is blocked while required metadata or operating assumptions remain unreviewed. The inherited HTL foreground inventory is not a full-plant LCA.</p>'
].join('')
};
export const localModelsDocZh={
id:'models',group:'模块开发',title:'本地 Aspen 模型',
description:'核查模型配置、准备有限扫描，再导入带来源的能量与环境分析结果。',
body:[
'<div class="hero-actions" style="justify-content:flex-start"><a class="pill-button" href="models.html">打开本地模型 →</a></div>',
'<h2 id="review">1. 检查模型与映射</h2>',
'<p>浏览器不执行 Aspen 原生文件。使用本地已授权安装的 Aspen，读取 <code>.bkp</code> 副本，列出输入、输出节点及原生单位。检查过程只读，不重新求解。自动生成的配置保持<strong>未完成草稿</strong>，直到明确可写数值输入与范围、可接受的求解状态、拓扑、焓基准、产品/进料以及 LCA 映射。</p>',
'<p>外部稳态模型（含循环回路）经核查后可采用同一契约。设备名称不能代替实际映射、公用工程效率或环境因子。<code>.apw</code> 须先在 Aspen 中另存为独立 <code>.bkp</code>。原始文件保留，并以 SHA-256 绑定身份。</p>',
'<p>完整本地流程使用 Python 3.12 或更新版本，在独立虚拟环境中安装 <code>process_pipeline/requirements.txt</code>。该文件包含科学计算库及 Windows COM 接口；Aspen 和 Node.js 需另行安装。后续命令使用该环境的 Python 执行。仓库 README 提供安装检查，以及不会启动 Aspen 的回放示例。</p>',
code(0),'<p>命令生成 <code>discovery-profile-draft.json</code>。补齐缺失映射并核查原生单位及操作假设后，才能将 <code>review.state</code> 设为 <code>reviewed</code>。把已完成配置保存为 <code>aspen-profile.json</code>，再运行验证：</p>',code(4),
'<h2 id="plan">2. 检查计划并在本地运行</h2>',
'<p>在<a href="models.html">本地模型页</a>加载已核查配置，点击<strong>规划扫描 →</strong>，按显示的原生单位设置上下限与点数。首次试运行选择<strong>仅做复核</strong>；准备拟合时选择<strong>固定训练集 + 留出集</strong>。自定义 JSON 计划还可明确加入复核点。需核查关联/固定控制及操作约束，规划器不会自动推断。</p>',
'<p>点击<strong>预览扫描计划</strong>，检查生成的各行，再选<strong>继续到本地执行 →</strong>。勾选核查确认后下载 <code>aspen-profile.json</code> 和 <code>scan-plan.json</code>，总数不超过 100 点。将文件放在下方命令对应路径，并使用新的输出目录。</p>',
'<p>本地执行器对每个工况使用独立模型副本，只写入白名单中的数值 Input 节点。严格检查单位和写入回读，按顺序运行并保留失败。求解或清理异常记录在任务台账中。网站语言切换不改变设定值或工况 ID。</p>',code(1),
'<h2 id="import-results">3. 导入并检查结果</h2>',
'<p>在本地模型页导入已完成任务的 <code>project.json</code>，再打开过程分析。计算前查看保留的扫描摘要。<code>ledger.json</code> 记录所有计划工况，包括未能归一化的工况；原始读取、报告和日志保留在本地任务目录。<code>dataset.json</code> 保存核查后的指标及预先划分，可用于后续预测。</p>',
'<p>区分五项检查：自动控制返回、原生状态通过、数值闭合、类别因子完整、指标输入完整。衡算通过不能证明物性准确或实验有效。清单 LCA 仍需要明确的外部数量、因子方法与来源；缺失因子会保留为不完整结果。</p>',
'<h2 id="prediction">可选预测与鲁棒性</h2>',
'<p>通用本地代理模型仅拟合已通过检查的训练工况，再报告保留工况的预测误差。需自行创建 <code>criteria.json</code>，为每个响应声明匹配单位的预测误差限；扫描不会替你生成这项标准。结构说明见仓库 <code>process_pipeline/SURROGATE.md</code>。通过这些检查后才启用常规预测，失败验证点保留在评估中。查询必须同时位于声明范围和实际训练点凸包内。</p>',code(2),
'<p>预测能耗或环境影响是对输入标签的近似，不会为每个查询重新求解能量衡算或构建 LCA 清单。声明输入与权重的变动可用<a href="#fuzzy">模糊支持与偏好比较</a>；已有操作扰动分析见独立的 <a href="#htl">HTL 工作区</a>。网格占比、模糊支持和验证误差含义不同，均不自动代表现实中的成功概率。</p>',
'<h2 id="scenarios">比较有限扰动情景</h2>',
'<p>在情景配置中声明候选输入、准确单位、扰动宽度、明确的情景偏移量及响应权重，再通过冻结模型生成结果文件：</p>',code(3),
'<details><summary>情景配置示例</summary><p>保存为 <code>scenarios.json</code>。字段与 HTL 配置示例对应；使用自己的模型时，需替换名称、单位、候选值和扰动宽度。这里明确只测试三组共享偏移情景，不代表连续区域内的所有组合。</p>',code(5,'JSON'),'</details>',
'<p>在<a href="models.html">本地模型</a>页点击<strong>已有运行结果？直接导入 →</strong>，使用<strong>选择模型结果 JSON</strong>导入 <code>scenario-results.json</code>。这是模型结果文件；能量/LCA 的 <code>project.json</code> 使用另一个合并项目入口。先检查指标范围、覆盖情况与名次稳定性，再比较候选工况。</p>',
'<p>领先份额是在每组声明偏好下，对所选确定性情景的并列领先者分摊计算，不能解释为成功概率。任一候选/情景不受支持时，会保留诊断并暂不提供完整全局排序。这里不设工况性能门槛，预测器的误差检查是另一项要求。情景分析不重新拟合模型，也不重新计算背景 LCA 因子。</p>',
'<h2 id="pilot">试用 17 工况原生示例</h2>',
'<p>17 个 HTL 模型副本工况均通过声明的运行与核算检查。预先冻结的划分为<strong>12 个训练点、3 个留出点和 2 个独立复核点</strong>。335 °C / 8.5 m 复核点的三项响应均超过预设的 5% 相对误差上限；345 °C / 17.5 m 复核点的三项均通过。复核组整体未通过，因此<strong>常规预测仍未启用</strong>，预测与情景文件均明确保留探索性标记。</p>',pilotErrors(true),
'<p>本 HR 试运行的购入能耗以 kWh/kg 出口目标单体表示，气候影响也按每 kg 相同目标单体核算；产率为目标产物与进料的质量比。目标单体是分离前的邻苯二酚与邻甲酚。旧 HTL 模块的电耗和单体量按 100 kg 湿进料、1 h 展示，碳足迹仍按每 kg 目标单体。比较前需统一分母和声明的清单边界。</p>',
'<p>打开<a href="models.html">本地 Aspen 模型</a>，试用 17 工况项目，并检查模型误差、均值预测或有限情景。情景覆盖完整只表示所有请求均已评估，不表示预测器通过验证；领先份额不是概率，运行检查也不能证明物理有效性。本通用试运行与旧版 HTL 参考模型相互独立。</p>',
'<p>来源范围与复现说明见<a href="data/generic-htl-pilot/README.md">试运行数据包说明</a>，也可下载<a href="data/generic-htl-pilot/index.json" download>文件清单与哈希</a>。数据包不包含原生模型档案或私人原始运行目录。</p>',
'<h2 id="artifacts">文件与恢复</h2>',
'<ul><li><code>profile.json + plan.json</code>：核查后的映射和预先冻结的请求输入。</li><li><code>ledger.json + runs/</code>：全部成功/失败记录、原始证据、警告与来源。</li><li><code>project.json</code>：供浏览器使用的五张表，包含 scan_audit。</li><li><code>dataset.json</code>：供通用代理模型使用的指标与数据划分。</li><li><code>model.bundle.json</code>：冻结模型、来源身份及验证状态。</li></ul>',
'<p>每次原生任务使用新的绝对输出目录，已有证据保留。必要元数据或操作假设未核查时，草稿会明确阻止扫描。HTL 示例继承的前景清单不能称为完整全厂 LCA。</p>'
].join('')
};
