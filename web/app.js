"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const normalizePath = value => String(value || "").trim().replace(/\//g, "\\").toLowerCase();
  const NAMES = {REAC_TEMP:"反应温度",TEMP:"温度设定",PRES:"压力设定",DELP:"压差设定",DUTY:"热负荷设定",LENGTH:"长度",DIAM:"直径",TOTFLOW:"总流量",MASSFLOW:"质量流量",MOLEFLOW:"摩尔流量",VFRAC:"汽相分率",AREA:"换热面积",U:"总传热系数",EFF:"效率",EFFICIENCY:"效率",VALUE:"规格值",P_SPEC:"压力规格方式",SPEC:"规格方式",FLOWBASE:"流量输入基准",BASIS:"输入基准"};
  const MAX_ROWS = 5000;
  const DRAFT_KEY = "aspen-workspace-draft-v1";
  const state = {token:"",catalog:{},catalogPath:"",columns:[],rows:[],selected:new Set(),picker:new Set(),job:{kind:"idle",status:"idle",results:[],logs:[]},busy:false,pending:false,connected:false,poll:null,scanRequested:false,scanPath:"",runFingerprint:"none",lastJobRender:"",rangeArrays:[],fillKey:null,initialized:false};
  let rowSerial = 0;
  let toastTimer;
  let draftTimer;

  function newRow(parameters = {}, name) {
    return {id:++rowSerial,name:name ?? `运行 ${rowSerial}`,values:Object.fromEntries(Object.entries(parameters).map(([key,value]) => [key,value == null ? "" : String(value)]))};
  }
  state.rows = [newRow(),newRow(),newRow()];
  function saveDraft() {
    if(!state.initialized) return;
    try {localStorage.setItem(DRAFT_KEY,JSON.stringify({model_path:$("model-path").value,catalogPath:state.catalogPath,catalog:state.catalog,columns:state.columns,rows:state.rows,rowSerial,runFingerprint:state.runFingerprint}));}
    catch { /* The JSON download remains available when browser storage is full or disabled. */ }
  }
  function queueSaveDraft() { clearTimeout(draftTimer);draftTimer=setTimeout(saveDraft,300); }
  function restoreDraft() {
    try {
      const draft=JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if(!draft || !Array.isArray(draft.columns) || !Array.isArray(draft.rows) || draft.rows.length>MAX_ROWS || !draft.catalog || typeof draft.catalog !== "object") return false;
      if(draft.columns.some(key => typeof key !== "string" || !own(draft.catalog,key)) || draft.rows.some(row => !row || !Number.isInteger(row.id) || typeof row.name !== "string" || !row.values || typeof row.values !== "object")) return false;
      state.catalog=draft.catalog;state.catalogPath=draft.catalogPath || "";state.columns=draft.columns;state.rows=draft.rows;state.runFingerprint=draft.runFingerprint || "none";rowSerial=Math.max(Number(draft.rowSerial)||0,...state.rows.map(row => row.id),0);
      $("model-path").value=draft.model_path || "";syncModelSelect();return true;
    } catch { return false; }
  }
  function title(key) {
    const spec = state.catalog[key] || {};
    if (spec.title) return spec.title;
    const label = String(spec.label || key).split("/");
    let name = NAMES[label[0]] || label[0];
    if (label[0] === "FLOW") name = "组分输入值";
    if (label[0] === "TEMP" && spec.section === "Streams") name = "物流温度";
    if (label.length > 1) name += " · " + label.slice(1).join("/");
    return spec.owner ? `${spec.owner} · ${name}` : name;
  }
  function unit(key) { return state.catalog[key]?.unit || "单位待核对"; }
  function isCommon(spec) { return spec.common ?? (own(NAMES,String(spec.label || "").split("/")[0]) || String(spec.label).startsWith("FLOW/") || /[\u4e00-\u9fff]/.test(spec.label || "")); }
  function isLocked() { return state.busy || state.pending; }
  function modelReady() { return Boolean(state.catalogPath && normalizePath(state.catalogPath) === normalizePath($("model-path").value) && Object.keys(state.catalog).length); }
  function showAlert(message) { $("alert-text").textContent = message; $("alert").hidden = false; $("alert").scrollIntoView({behavior:"smooth",block:"nearest"}); }
  function toast(message) { clearTimeout(toastTimer); $("toast").textContent=message; $("toast").hidden=false; toastTimer=setTimeout(() => { $("toast").hidden=true; },3500); }
  function fail(error) { showAlert(error?.message || String(error)); }
  function currentFingerprint() { return JSON.stringify([normalizePath($("model-path").value),state.columns,state.rows.map(row => [row.name,row.values])]); }
  function cellValue(raw, key) {
    const value = String(raw).trim();
    if (value === "") return undefined;
    if (typeof state.catalog[key]?.value === "string") return value;
    if (typeof state.catalog[key]?.value === "boolean" && /^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
      const number=Number(value);
      if (!Number.isFinite(number)) throw new Error(`${title(key)} 中有超出范围的数值。`);
      return number;
    }
    if (typeof state.catalog[key]?.value === "number") throw new Error(`${title(key)} 需要有效数值，收到“${value}”。`);
    return value;
  }
  function plan() {
    return {model_path:$("model-path").value.trim(),parameter_catalog:state.catalog,parameter_columns:[...state.columns],parameter_sets:state.rows.map(row => ({_name:row.name.trim() || `运行 ${state.rows.indexOf(row)+1}`,parameters:Object.fromEntries(state.columns.map(key => [key,cellValue(row.values[key] ?? "",key)]).filter(([,value]) => value !== undefined))}))};
  }
  async function api(path, body) {
    const response = await fetch(path,{method:body === undefined ? "GET" : "POST",headers:body === undefined ? {} : {"Content-Type":"application/json","X-Session-Token":state.token},body:body === undefined ? undefined : JSON.stringify(body),cache:"no-store"});
    let data;
    try { data=await response.json(); } catch { throw new Error(`本机服务返回了无法读取的响应（${response.status}）。请检查启动窗口。`); }
    if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
    return data;
  }
  async function action(callback) {
    if (isLocked()) return;
    state.pending=true;renderControls();
    try { await callback(); } catch(error) { fail(error); }
    finally { state.pending=false;renderControls(); }
  }
  function renderControls() {
    const locked=isLocked();
    const ready=modelReady();
    const count=state.columns.length;
    const controls=["import-plan","export-plan","load-example","scan-model","model-select","model-path","add-columns","add-row","generate-rows","duplicate-rows","delete-rows","copy-table","confirm-columns","confirm-range","confirm-fill"];
    for (const id of controls) $(id).disabled=locked;
    $("add-columns").disabled=locked || !ready;
    $("generate-rows").disabled=locked || !count;
    $("duplicate-rows").disabled=locked || !state.selected.size;
    $("delete-rows").disabled=locked || !state.selected.size;
    $("copy-table").disabled=!count || !state.rows.length;
    $("scan-model").disabled=locked || !$("model-path").value.trim();
    $("export-plan").disabled=locked || !ready || !state.rows.length;
    $("start-run").disabled=locked || !ready || !state.rows.length;
    $("start-run").hidden=state.busy && state.job.kind === "run";
    $("stop-run").hidden=!(state.busy && state.job.kind === "run");
    $("stop-run").disabled=state.pending || Boolean(state.job.stop_requested);
    $("stop-run").textContent=state.job.stop_requested ? "已请求停止，等待当前行完成" : "完成当前行后停止";
    for (const element of $("sheet").querySelectorAll("input,button")) element.disabled=locked;
    $("row-count").textContent=state.rows.length;
    $("column-count").textContent=count;
    $("catalog-badge").textContent=ready ? `${Object.keys(state.catalog).length} 个可选参数` : (state.busy && state.job.kind === "scan" ? "正在读取…" : "尚未读取参数");
    $("catalog-badge").className=`badge ${ready ? "good" : "neutral"}`;
    $("step-model").className=`workflow-step ${ready ? "done" : "current"}`;
    $("step-plan").className=`workflow-step ${ready ? (count ? "done" : "current") : ""}`;
    $("step-run").className=`workflow-step ${state.job.status === "completed" ? "done" : (count ? "current" : "")}`;
    if (state.busy && state.job.kind === "run") {
      $("run-ready").textContent=`正在执行第 ${state.job.current || 1} / ${state.job.total} 行`;
      $("run-description").textContent=state.job.stop_requested ? "当前 Aspen 计算完成后结束，不再开始下一行。" : "每行从原模型重新加载，按顺序独立计算。";
    } else if (state.busy && state.job.kind === "scan") {
      $("run-ready").textContent="正在读取 Aspen 模型参数";
      $("run-description").textContent="首次启动 Aspen 可能需要一些时间，请稍候。";
    } else if (ready) {
      $("run-ready").textContent=`准备运行 ${state.rows.length} 次 · 每次最多设置 ${count} 个参数`;
      $("run-description").textContent=count ? "同一行的参数一起写入；各行依次独立运行。" : "添加参数列设置新工况，或直接运行原始模型。";
    } else {
      $("run-ready").textContent="先读取模型参数，开始编排";
      $("run-description").textContent="一次运行中，各参数同时生效。";
    }
  }
  function rowStatus(index) {
    if (state.job.kind !== "run" || (state.runFingerprint && state.runFingerprint !== currentFingerprint())) return ["", "待运行"];
    const result=(state.job.results || []).find(item => Number(item.run_index) === index+1);
    if (result) return result.status === "success" ? ["success","执行完成"] : ["failed","执行失败"];
    if (state.busy && Number(state.job.current) === index+1) return ["running","运行中…"];
    if (state.job.status === "stopped") return ["","未执行"];
    return ["","待运行"];
  }
  function renderSheet() {
    const hasColumns=Boolean(state.columns.length);
    const allSelected=state.rows.length && state.rows.every(row => state.selected.has(row.id));
    let html=`<thead><tr><th class="check-cell"><input type="checkbox" id="select-all" aria-label="选择全部运行行" ${allSelected ? "checked" : ""}></th><th class="index-cell">序号</th><th class="name-cell name-head">运行名称</th>`;
    if (hasColumns) for (const key of state.columns) html+=`<th class="param-cell"><button class="param-title" data-fill="${escapeHtml(key)}" title="${escapeHtml(state.catalog[key]?.detail || `${title(key)}\n模型原值：${state.catalog[key]?.value}\n点击整列填值`)}">${escapeHtml(title(key))}<span class="param-unit">${escapeHtml(unit(key))}</span></button><button class="remove-column" data-remove="${escapeHtml(key)}" aria-label="删除 ${escapeHtml(title(key))} 列" title="删除这一列">×</button></th>`;
    else html+='<th class="empty-head">在这里，把参数添加为列</th>';
    html+='<th class="add-column-cell"><button class="add-column-inline" id="inline-add-column" aria-label="添加参数列" title="添加参数列">＋</button></th><th class="status-cell">运行状态</th></tr></thead><tbody>';
    state.rows.forEach((row,index) => {
      const [status,label]=rowStatus(index);
      html+=`<tr data-row="${row.id}" class="${state.selected.has(row.id) ? "selected" : ""} ${status === "running" ? "running" : ""}"><td class="check-cell"><input type="checkbox" class="row-select" data-row-id="${row.id}" aria-label="选择第 ${index+1} 行" ${state.selected.has(row.id) ? "checked" : ""}></td><td class="index-cell">${String(index+1).padStart(2,"0")}</td><td class="name-cell"><input class="row-name" data-row-id="${row.id}" value="${escapeHtml(row.name)}" aria-label="第 ${index+1} 行运行名称"></td>`;
      if (hasColumns) for (const key of state.columns) html+=`<td class="param-cell"><input class="value-input" data-row-id="${row.id}" data-key="${escapeHtml(key)}" value="${escapeHtml(row.values[key] ?? "")}" placeholder="原值 ${escapeHtml(state.catalog[key]?.value ?? "")}" aria-label="第 ${index+1} 行 ${escapeHtml(title(key))} ${escapeHtml(unit(key))}" spellcheck="false" autocomplete="off"></td>`;
      else if(index === 0) html+=`<td class="empty-sheet-cell" rowspan="${Math.max(3,state.rows.length)}"><div class="empty-sheet-content"><span class="empty-sheet-mark">＋</span><div><strong>先选几个想改变的参数</strong><p>例如反应器温度、泵压力、进料流量。<br>它们可以来自不同设备，一起放进这张表。</p><button class="text-button" id="empty-add-columns">添加第一组参数列 →</button></div></div></td>`;
      html+=`<td class="add-column-cell"></td><td class="status-cell"><span class="row-status ${status}" data-status-id="${row.id}">${label}</span></td></tr>`;
    });
    if(!state.rows.length) html+=`<tr><td colspan="${5+(hasColumns ? state.columns.length : 1)}" style="padding:40px;text-align:center;color:#839b89">还没有运行行。点击“添加运行行”开始。</td></tr>`;
    html+="</tbody>";
    $("sheet").innerHTML=html;
    $("sheet").style.minWidth=`${hasColumns ? 378+state.columns.length*169 : 755}px`;
    renderControls();
    if (!modelReady()) {
      $("inline-add-column").disabled=true;
      if($("empty-add-columns")) $("empty-add-columns").disabled=true;
    }
    queueSaveDraft();
  }
  function refreshRowStatus() {
    state.rows.forEach((row,index) => {
      const element=$("sheet").querySelector(`[data-status-id="${row.id}"]`);
      if(!element) return;
      const [status,label]=rowStatus(index);
      element.textContent=label;element.className=`row-status ${status}`;
      element.closest("tr").classList.toggle("running",status === "running");
    });
  }
  function formatValue(value) { if(value == null) return "—"; if(typeof value === "number") return Number.isInteger(value) ? String(value) : Number(value.toPrecision(7)).toString(); return typeof value === "object" ? JSON.stringify(value) : String(value); }
  function dataTable(records) {
    const entries=Object.entries(records || {});
    if(!entries.length) return '<p>未返回此类数据。</p>';
    const labels={type:"设备类型",heat_kW:"热负荷 (kW)",power_kW:"电耗 (kW)",temperature_C:"温度 (°C)",temperature_K:"温度 (K)",pressure_bar:"压力 (bar)",pressure_MPa:"压力 (MPa)",mass_flow_kg_h:"质量流量 (kg/h)",mass_flow_kg_hr:"质量流量 (kg/h)",mole_flow_kmol_h:"摩尔流量 (kmol/h)",mole_flow_kmol_hr:"摩尔流量 (kmol/h)",vapor_fraction:"汽相分率"};
    const keys=Object.keys(labels).filter(key => entries.some(([,record]) => own(record || {},key)));
    const details=Object.fromEntries(entries.map(([name,record]) => [name,Object.fromEntries(Object.entries(record || {}).filter(([key]) => !keys.includes(key)))]).filter(([,record]) => Object.keys(record).length));
    return `<table><thead><tr><th>名称</th>${keys.map(key => `<th>${escapeHtml(labels[key])}</th>`).join("")}</tr></thead><tbody>${entries.map(([name,record]) => `<tr><td>${escapeHtml(name)}</td>${keys.map(key => `<td>${escapeHtml(formatValue(record?.[key]))}</td>`).join("")}</tr>`).join("")}</tbody></table>${Object.keys(details).length ? `<details class="raw-result"><summary>查看组成与原始读数</summary><pre>${escapeHtml(JSON.stringify(details,null,2))}</pre></details>` : ""}`;
  }
  function renderJob() {
    const job=state.job;
    const results=job.results || [];
    const isRun=job.kind === "run";
    const isScan=job.kind === "scan";
    const labels={idle:"等待运行",running:isScan ? "正在读取模型" : "正在运行",completed:isScan ? "参数读取完成" : "本批次已结束",failed:isScan ? "参数读取失败" : "运行失败",stopped:"已停止"};
    $("job-badge").textContent=labels[job.status] || "等待运行";
    $("job-badge").className=`badge ${job.status === "running" ? "working" : job.status === "failed" ? "bad" : job.status === "completed" ? "good" : "neutral"}`;
    $("job-progress").hidden=job.status === "idle" || (!state.busy && !isRun);
    const completed=Number(job.completed || 0),total=Number(job.total || 0);
    $("progress-label").textContent=isScan ? "正在启动 Aspen 并读取设备与物流参数…" : state.busy ? `正在计算：第 ${job.current || completed+1} 行${job.stop_requested ? " · 完成后停止" : ""}` : job.status === "stopped" ? "已停止，后续工况未运行" : job.status === "failed" ? "运行已结束，请查看错误信息" : `批次已结束 · ${results.filter(item => item.status === "success").length} 行执行完成${results.some(item => item.status !== "success") ? `，${results.filter(item => item.status !== "success").length} 行失败` : ""}`;
    $("progress-count").textContent=isScan ? "请稍候" : `${completed} / ${total} 行`;
    $("progress-fill").className=isScan && state.busy ? "indeterminate" : "";
    $("progress-fill").style.width=`${total ? Math.min(100,completed/total*100) : 0}%`;
    $("results-empty").hidden=results.length>0 || state.busy;
    $("results-footnote").hidden=!results.length;
    const signature=JSON.stringify([job.id,results]);
    if(signature !== state.lastJobRender) {
      const expanded=new Set([...$("result-list").querySelectorAll("details[open]")].map(item => item.dataset.result));
      $("result-list").innerHTML=results.map((result,index) => `<details class="result-item" data-result="${index}" ${expanded.has(String(index)) ? "open" : ""}><summary><span class="result-number">${String(result.run_index || index+1).padStart(2,"0")}</span><span class="result-name">${escapeHtml(result.run_name || `运行 ${index+1}`)}</span><span class="badge ${result.status === "success" ? "good" : "bad"}">${result.status === "success" ? "执行完成" : "执行失败"}</span><span class="result-time">${result.elapsed_time_seconds != null ? `${escapeHtml(result.elapsed_time_seconds)} 秒` : ""}</span></summary><div class="result-detail">${result.error ? `<p style="color:var(--red)">${escapeHtml(result.error)}</p>` : ""}<h4>本行写入参数</h4><p>${Object.keys(result.parameters || {}).length ? Object.entries(result.parameters).map(([key,value]) => `${escapeHtml(title(key))} = ${escapeHtml(formatValue(value))} ${escapeHtml(unit(key))}`).join(" · ") : "全部使用原模型值"}</p>${Object.keys(result.blocks || {}).length ? `<h4>设备结果</h4>${dataTable(result.blocks)}` : ""}${Object.keys(result.streams || {}).length ? `<h4>物流结果</h4>${dataTable(result.streams)}` : ""}${result.output_dir ? `<h4>结果保存位置</h4><p>${escapeHtml(result.output_dir)}</p>` : ""}${result.aspen_run_status ? `<h4>Aspen 返回状态</h4><p>${escapeHtml(formatValue(result.aspen_run_status))}</p>` : ""}</div></details>`).join("");
      state.lastJobRender=signature;
    }
    const logLines=(job.logs || []).map(line => typeof line === "string" ? line : JSON.stringify(line));
    const log=$("run-log"),stick=log.scrollTop+log.clientHeight >= log.scrollHeight-30;
    const logText=logLines.length ? logLines.join("\n") : "还没有运行日志。";
    if(log.textContent !== logText) { log.textContent=logText; if(stick) log.scrollTop=log.scrollHeight; }
    $("log-count").textContent=`${logLines.length} 条`;
    const safeDownload=typeof job.summary_url === "string" && /^\/api\/download\/[a-zA-Z0-9_-]+\/summary\.csv$/.test(job.summary_url);
    $("download-summary").hidden=!safeDownload;
    if(safeDownload) $("download-summary").href=job.summary_url;
    refreshRowStatus();renderControls();
  }
  async function fetchState(initial=false) {
    try {
      const data=await api("/api/state");
      state.connected=true;state.token=data.token || state.token;
      $("connection-dot").className="connection-dot connected";
      $("connection-text").textContent="本机服务已连接";
      const previousStatus=state.job.status;
      state.job=data.job || state.job;state.busy=Boolean(data.busy || state.job.status === "running");
      if(initial) {
        $("model-select").innerHTML='<option value="">选择模型或填写路径</option>'+(data.models || []).map(model => `<option value="${escapeHtml(model.path)}">${escapeHtml(model.name)}</option>`).join("");
        $("model-path").value=data.model_path || "";
        syncModelSelect();
        if(data.catalog && Object.keys(data.catalog).length) { state.catalog=data.catalog;state.catalogPath=data.model_path; }
        const restored=restoreDraft();
        state.initialized=true;
        renderSheet();
        if(restored) toast("已恢复本机草稿，工况表可以继续编辑。");
      }
      if(state.scanRequested && !state.busy) {
        state.scanRequested=false;
        if(state.job.kind === "scan" && state.job.status === "completed") {
          const changedModel=normalizePath(state.catalogPath) !== normalizePath(state.scanPath);
          state.catalog=data.catalog || {};state.catalogPath=data.model_path || state.scanPath;
          if(changedModel) { state.columns=[];state.selected.clear();rowSerial=0;state.rows=[newRow(),newRow(),newRow()]; }
          else state.columns=state.columns.filter(key => own(state.catalog,key));
          renderSheet();toast(`已读取 ${Object.keys(state.catalog).length} 个参数，可以添加参数列了。`);
          $("model-note").textContent="模型已就绪。点击“添加参数列”，搜索设备、物流或参数名称。";
        }
      }
      if(state.job.status === "failed" && previousStatus !== "failed" && state.job.error) showAlert(state.job.error);
      if(previousStatus === "running" && !state.busy && state.job.kind === "run") toast(state.job.status === "stopped" ? "当前行已完成，批次已停止。" : "本批次已结束，可以查看结果。" );
      renderJob();
      clearTimeout(state.poll);
      if(state.busy) state.poll=setTimeout(() => fetchState(),1200);
    } catch(error) {
      state.connected=false;$("connection-dot").className="connection-dot failed";$("connection-text").textContent="本机服务连接中断";
      if(initial) showAlert("无法连接本机服务。请使用“启动网页版.bat”启动工作台，不要直接双击 HTML 文件。\n"+error.message);
      else { $("progress-label").textContent="暂时无法获取进度，正在重新连接…"; state.poll=setTimeout(() => fetchState(),2500); }
    }
  }
  function syncModelSelect() { const matching=[...$("model-select").options].find(option => normalizePath(option.value) === normalizePath($("model-path").value));$("model-select").value=matching ? matching.value : ""; }
  async function scanModel() {
    if(!$("model-path").value.trim()) return showAlert("先选择模型，或填写模型文件的完整路径。" );
    const changed=state.catalogPath && normalizePath(state.catalogPath) !== normalizePath($("model-path").value);
    if(changed && state.columns.length && !window.confirm("更换模型后将重新编排工况。建议先保存现有方案。继续读取新模型吗？")) return;
    await action(async () => {
      const path=$("model-path").value.trim();
      await api("/api/scan",{model_path:path});state.scanRequested=true;state.scanPath=path;
      $("alert").hidden=true;await fetchState();
    });
  }
  function openPicker() {
    if(isLocked()) return;
    if(!modelReady()) { showAlert("先点击“读取模型参数”，再添加参数列。");return; }
    state.picker.clear();$("parameter-search").value="";$("parameter-section").value="";$("common-only").checked=true;
    const owners=[...new Set(Object.values(state.catalog).map(spec => spec.owner).filter(Boolean))].sort((a,b) => a.localeCompare(b,undefined,{numeric:true}));
    $("parameter-owner").innerHTML='<option value="">全部设备 / 物流</option>'+owners.map(owner => `<option value="${escapeHtml(owner)}">${escapeHtml(owner)}</option>`).join("");
    renderPicker();$("parameter-dialog").showModal();$("parameter-search").focus();
  }
  function renderPicker() {
    const search=$("parameter-search").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const section=$("parameter-section").value,owner=$("parameter-owner").value,common=$("common-only").checked;
    const matches=Object.entries(state.catalog).filter(([key,spec]) => (!section || spec.section === section) && (!owner || spec.owner === owner) && (!common || isCommon(spec)) && search.every(term => `${key} ${title(key)} ${spec.label} ${spec.owner} ${spec.unit}`.toLowerCase().includes(term)));
    matches.sort(([ka,sa],[kb,sb]) => Number(state.columns.includes(ka))-Number(state.columns.includes(kb)) || String(sa.owner).localeCompare(String(sb.owner),undefined,{numeric:true}) || title(ka).localeCompare(title(kb),"zh-CN"));
    $("parameter-found").textContent=`${matches.length} 个参数`;
    $("parameter-list").innerHTML=matches.length ? matches.map(([key,spec]) => {
      const added=state.columns.includes(key),selected=state.picker.has(key);
      return `<label class="parameter-option ${added ? "already-added" : selected ? "selected" : ""}" title="${escapeHtml(spec.detail || spec.path || key)}"><input type="checkbox" data-pick="${escapeHtml(key)}" ${added ? "checked disabled" : selected ? "checked" : ""}><span class="parameter-info"><span class="parameter-title-line"><strong>${escapeHtml(title(key))}</strong><small>${added ? "已在表格中" : `原值 ${escapeHtml(formatValue(spec.value))} · ${escapeHtml(unit(key))}`}</small></span><p>${spec.section === "Streams" ? "物流" : "设备"} · ${escapeHtml(spec.owner || "")}<span class="parameter-key"> &nbsp; ${escapeHtml(spec.label || key)}</span>${String(spec.label).startsWith("FLOW/") ? "<br>组分值的含义取决于模型的流量输入基准。" : ""}${spec.label === "VALUE" ? "<br>规格值的含义取决于该设备的规格方式。" : ""}</p></span></label>`;
    }).join("") : '<div class="no-parameters">没有找到匹配的参数。<br>试试减少关键词，或取消勾选“常用参数”。</div>';
    updatePickerCount();
  }
  function updatePickerCount() { $("parameter-selection-count").textContent=`已选择 ${state.picker.size} 个新参数`;$("confirm-columns").disabled=!state.picker.size; }
  function focusCell(rowIndex,columnIndex) { const row=state.rows[rowIndex],key=state.columns[columnIndex];if(!row || !key) return; const element=[...$("sheet").querySelectorAll(".value-input")].find(input => Number(input.dataset.rowId) === row.id && input.dataset.key === key);if(element) { element.focus();element.select(); } }
  function addRow() { if(isLocked()) return;if(state.rows.length >= MAX_ROWS) return showAlert(`单个方案最多支持 ${MAX_ROWS} 行。`);state.rows.push(newRow());renderSheet();focusCell(state.rows.length-1,0); }
  function removeColumn(key) { if(isLocked()) return;if(state.rows.some(row => String(row.values[key] ?? "").trim()) && !confirm(`删除“${title(key)}”列及其中已填写的值？`)) return;state.columns=state.columns.filter(column => column !== key);for(const row of state.rows) delete row.values[key];renderSheet();toast("已删除参数列"); }
  function fillColumn(key) { if(isLocked()) return;state.fillKey=key;$("fill-column-title").textContent=`${title(key)} · ${unit(key)} · 模型原值 ${formatValue(state.catalog[key]?.value)}`;$("fill-value").value="";$("fill-scope").textContent=state.selected.size ? `将填入勾选的 ${state.selected.size} 行。` : `将填入全部 ${state.rows.length} 行。`;$("fill-dialog").showModal();$("fill-value").focus(); }
  function pasteGrid(event,input) {
    const text=event.clipboardData.getData("text/plain");
    if(!/[\t\r\n]/.test(text)) return;
    event.preventDefault();
    if(isLocked()) return;
    let lines=text.replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n");
    if(lines.at(-1) === "") lines.pop();
    const cells=lines.map(line => line.split("\t"));
    const firstRow=state.rows.findIndex(row => row.id === Number(input.dataset.rowId));
    const firstColumn=state.columns.indexOf(input.dataset.key);
    const width=Math.max(...cells.map(row => row.length));
    if(firstColumn+width > state.columns.length) return showAlert(`粘贴区域有 ${width} 列，当前位置右侧只有 ${state.columns.length-firstColumn} 列。请先添加足够的参数列。`);
    if(firstRow+cells.length > MAX_ROWS) return showAlert(`粘贴后超过 ${MAX_ROWS} 行，请拆分为多个方案。`);
    while(state.rows.length < firstRow+cells.length) state.rows.push(newRow());
    cells.forEach((values,dy) => values.forEach((value,dx) => { state.rows[firstRow+dy].values[state.columns[firstColumn+dx]]=value.trim(); }));
    renderSheet();focusCell(firstRow,firstColumn);toast(`已粘贴 ${cells.length} 行 × ${width} 列`);
  }
  async function copyTable() {
    const rows=state.selected.size ? state.rows.filter(row => state.selected.has(row.id)) : state.rows;
    const text=rows.map(row => state.columns.map(key => row.values[key] ?? "").join("\t")).join("\n");
    try { await navigator.clipboard.writeText(text);toast(`已复制 ${rows.length} 行参数值，可粘贴到 Excel`); } catch { showAlert("浏览器未允许复制。请选中单元格内容后使用 Ctrl+C。"); }
  }
  function parseValues(text) {
    if(!text.trim()) throw new Error("为已选参数填写至少一个值。" );
    if(text.includes(":")) {
      const pieces=text.trim().split(":");
      if(pieces.some(value => !value.trim())) throw new Error("范围的起点、终点和步长都需要填写。");
      const parts=pieces.map(value => Number(value.trim()));
      if(parts.length !== 3 || parts.some(value => !Number.isFinite(value)) || parts[2] === 0) throw new Error("范围请填写为“起点:终点:步长”，步长不能为 0。" );
      const [start,end,step]=parts;
      if((end-start)*step<0) throw new Error("步长方向与起点、终点不一致。" );
      const count=Math.floor((end-start)/step+1e-9)+1;
      if(count>MAX_ROWS) throw new Error(`单个参数最多生成 ${MAX_ROWS} 个值。`);
      return Array.from({length:count},(_,index) => String(Number((start+index*step).toPrecision(12))));
    }
    const values=text.split(/[,，;；\n]+/).map(value => value.trim()).filter(Boolean);
    if(!values.length) throw new Error("请填写至少一个值。" );
    if(values.length>MAX_ROWS) throw new Error(`单个参数最多填写 ${MAX_ROWS} 个值。`);
    return values;
  }
  function calculateRange() {
    const selections=[...$("range-fields").querySelectorAll(".range-field")].filter(field => field.querySelector("[type=checkbox]").checked).map(field => ({key:field.dataset.key,values:parseValues(field.querySelector(".range-values").value)}));
    if(!selections.length) throw new Error("至少选择一个参数并填写数值。" );
    const mode=document.querySelector('[name="range-mode"]:checked').value;
    let count;
    if(mode === "linked") { count=Math.max(...selections.map(item => item.values.length));if(selections.some(item => item.values.length !== 1 && item.values.length !== count)) throw new Error("逐行配对时，各参数的值数量需相同；只有一个值的参数会保持固定。" ); }
    else count=selections.reduce((total,item) => total*item.values.length,1);
    if(count+state.rows.length>MAX_ROWS) throw new Error(`将新增 ${count.toLocaleString()} 行，超过单个方案 ${MAX_ROWS} 行的上限。请减少参数值或拆分方案。`);
    return {selections,mode,count};
  }
  function previewRange() {
    try { const {selections,mode,count}=calculateRange();$("range-count").textContent=`将新增 ${count} 次运行`;$("range-preview").textContent=`${selections.map(item => `${title(item.key)}：${item.values.length} 个值`).join("；")}。${mode === "linked" ? "按照位置逐行配对，单个值保持固定。" : "尝试全部参数值组合。"}`;$("confirm-range").disabled=false; }
    catch(error) { $("range-count").textContent="检查参数值";$("range-preview").textContent=error.message;$("confirm-range").disabled=true; }
  }
  function openRange() {
    if(isLocked() || !state.columns.length) return;
    $("range-base").innerHTML='<option value="">原模型值（其余列留空）</option>'+state.rows.map((row,index) => `<option value="${row.id}">第 ${index+1} 行 · ${escapeHtml(row.name)}</option>`).join("");
    if(state.selected.size === 1) $("range-base").value=[...state.selected][0];
    $("range-fields").innerHTML=state.columns.map(key => `<div class="range-field" data-key="${escapeHtml(key)}"><input type="checkbox" aria-label="变化 ${escapeHtml(title(key))}"><label>${escapeHtml(title(key))}<small>${escapeHtml(unit(key))}</small></label><input class="range-values" placeholder="例如 600, 610, 620" aria-label="${escapeHtml(title(key))} 的变化值" disabled></div>`).join("");
    previewRange();$("range-dialog").showModal();
  }
  function generateRange() {
    try {
      const {selections,mode,count}=calculateRange();
      const base=state.rows.find(row => String(row.id) === $("range-base").value)?.values || {};
      let sets;
      if(mode === "linked") sets=Array.from({length:count},(_,index) => Object.fromEntries(selections.map(item => [item.key,item.values[item.values.length === 1 ? 0 : index]])));
      else sets=selections.reduce((combos,item) => combos.flatMap(combo => item.values.map(value => ({...combo,[item.key]:value}))),[{}]);
      state.rows.push(...sets.map(values => newRow({...base,...values})));
      $("range-dialog").close();renderSheet();toast(`已追加 ${count} 次运行`);
    } catch(error) { fail(error); }
  }
  async function importConfiguration(data) {
    if(!data || typeof data !== "object" || !Array.isArray(data.parameter_sets) || !data.parameter_catalog || typeof data.parameter_catalog !== "object" || !data.model_path) throw new Error("方案需包含 model_path、parameter_catalog 和 parameter_sets。请导入此工作台或新版桌面程序保存的 JSON 方案。" );
    if(data.parameter_sets.length>MAX_ROWS) throw new Error(`方案超过 ${MAX_ROWS} 行，请拆分后导入。`);
    if(data.parameter_columns !== undefined && (!Array.isArray(data.parameter_columns) || data.parameter_columns.some(key => typeof key !== "string"))) throw new Error("方案的 parameter_columns 应为参数标识列表。" );
    const rows=data.parameter_sets.map((item,index) => {
      if(!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`第 ${index+1} 行的格式不正确。`);
      const parameters=own(item,"parameters") ? item.parameters : Object.fromEntries(Object.entries(item).filter(([key]) => !key.startsWith("_")));
      if(!parameters || typeof parameters !== "object" || Array.isArray(parameters)) throw new Error(`第 ${index+1} 行的 parameters 格式不正确。`);
      if(Object.values(parameters).some(value => value !== null && !["number","string","boolean"].includes(typeof value))) throw new Error(`第 ${index+1} 行包含不支持的参数值。`);
      return {parameters,name:item._name || item.name || `运行 ${index+1}`};
    });
    const columns=[...new Set([...(data.parameter_columns || []),...rows.flatMap(row => Object.keys(row.parameters))])];
    if(columns.some(key => !own(data.parameter_catalog,key))) throw new Error("方案中有参数列缺少对应的参数定义，请重新读取模型并保存方案。" );
    const response=await api("/api/catalog",{model_path:data.model_path,parameter_catalog:data.parameter_catalog});
    state.catalog=response.catalog || response.parameter_catalog || data.parameter_catalog;state.catalogPath=response.model_path || data.model_path;state.columns=columns;rowSerial=0;state.rows=rows.map(row => newRow(row.parameters,row.name));state.selected.clear();state.runFingerprint="imported";
    $("model-path").value=state.catalogPath;syncModelSelect();$("alert").hidden=true;renderSheet();
    $("model-note").textContent="已载入方案中的参数定义。列、空白行和数值已恢复，可编辑后运行。";
  }
  async function loadExample() {
    if(state.columns.length && !confirm("载入已有示例将替换当前工况表。继续吗？")) return;
    await action(async () => {const example=await api("/api/example");await importConfiguration(example);toast("已载入已有的多设备方案，可直接编辑和运行");});
  }
  async function savePlan() {
    await action(async () => {
      const response=await api("/api/plan",plan());
      const link=document.createElement("a");
      link.href=response.download_url;link.download="aspen_plan.json";document.body.appendChild(link);link.click();link.remove();
      toast("方案已保存到本机并开始下载，包含全部行、列和空白值");
    });
  }
  async function startRun() {
    if(!modelReady()) return showAlert("请先读取当前模型的参数，或导入已有方案。" );
    if(!state.rows.length) return showAlert("至少添加一行工况后再运行。" );
    await action(async () => {
      const data=plan();
      await api("/api/run",data);state.runFingerprint=currentFingerprint();$("alert").hidden=true;await fetchState();$("results").scrollIntoView({behavior:"smooth",block:"nearest"});
      saveDraft();
    });
  }
  function bindEvents() {
    $("alert-close").addEventListener("click",() => {$("alert").hidden=true;});
    for(const button of document.querySelectorAll("[data-close]")) button.addEventListener("click",() => $(button.dataset.close).close());
    for(const dialog of document.querySelectorAll("dialog")) dialog.addEventListener("click",event => {if(event.target === dialog) {const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom) dialog.close();}});
    $("open-help").addEventListener("click",() => $("help-dialog").showModal());
    $("table-help").addEventListener("click",() => {$("inline-help").hidden=!$("inline-help").hidden;$("table-help").textContent=$("inline-help").hidden ? "怎样填写？" : "收起说明";});
    $("model-select").addEventListener("change",() => {if($("model-select").value) $("model-path").value=$("model-select").value;renderControls();queueSaveDraft();});
    $("model-path").addEventListener("input",() => {syncModelSelect();renderControls();queueSaveDraft();});
    $("scan-model").addEventListener("click",scanModel);
    $("load-example").addEventListener("click",loadExample);
    $("add-columns").addEventListener("click",openPicker);
    $("add-row").addEventListener("click",addRow);
    $("copy-table").addEventListener("click",copyTable);
    $("duplicate-rows").addEventListener("click",() => {const rows=state.rows.filter(row => state.selected.has(row.id));if(rows.length+state.rows.length>MAX_ROWS) return showAlert(`单个方案最多支持 ${MAX_ROWS} 行。`);const copies=rows.map(row => newRow({...row.values},`${row.name} 副本`));state.rows.push(...copies);state.selected=new Set(copies.map(row => row.id));renderSheet();toast(`已复制 ${rows.length} 行`);});
    $("delete-rows").addEventListener("click",() => {if(!state.selected.size) return;if(!confirm(`删除已勾选的 ${state.selected.size} 个运行行？`)) return;state.rows=state.rows.filter(row => !state.selected.has(row.id));state.selected.clear();renderSheet();});
    $("sheet").addEventListener("click",event => {const remove=event.target.closest("[data-remove]"),fill=event.target.closest("[data-fill]");if(remove) removeColumn(remove.dataset.remove);else if(fill) fillColumn(fill.dataset.fill);else if(event.target.closest("#inline-add-column,#empty-add-columns")) openPicker();});
    $("sheet").addEventListener("change",event => {if(event.target.id === "select-all") {state.selected=event.target.checked ? new Set(state.rows.map(row => row.id)) : new Set();renderSheet();}else if(event.target.matches(".row-select")) {const id=Number(event.target.dataset.rowId);event.target.checked ? state.selected.add(id) : state.selected.delete(id);event.target.closest("tr").classList.toggle("selected",event.target.checked);$("select-all").checked=state.rows.every(row => state.selected.has(row.id));renderControls();}});
    $("sheet").addEventListener("input",event => {const row=state.rows.find(item => item.id === Number(event.target.dataset.rowId));if(!row || isLocked()) return;if(event.target.matches(".value-input")) row.values[event.target.dataset.key]=event.target.value;else if(event.target.matches(".row-name")) row.name=event.target.value;refreshRowStatus();queueSaveDraft();});
    $("sheet").addEventListener("paste",event => {if(event.target.matches(".value-input")) pasteGrid(event,event.target);});
    $("sheet").addEventListener("keydown",event => {
      if(event.isComposing || !["Enter","Tab"].includes(event.key) || !event.target.matches(".value-input")) return;
      let row=state.rows.findIndex(item => item.id === Number(event.target.dataset.rowId));
      let column=state.columns.indexOf(event.target.dataset.key);
      const direction=event.shiftKey ? -1 : 1;
      if(event.key === "Enter") row+=direction;
      else { column+=direction;if(column>=state.columns.length) {row++;column=0;}else if(column<0) {row--;column=state.columns.length-1;} }
      if(row<0 || row>=state.rows.length) {if(event.key === "Enter") event.preventDefault();return;}
      event.preventDefault();focusCell(row,column);
    });
    for(const id of ["parameter-search","parameter-section","parameter-owner","common-only"]) $(id).addEventListener(id === "parameter-search" ? "input" : "change",renderPicker);
    $("parameter-list").addEventListener("change",event => {const key=event.target.dataset.pick;if(!key) return;event.target.checked ? state.picker.add(key) : state.picker.delete(key);event.target.closest("label").classList.toggle("selected",event.target.checked);updatePickerCount();});
    $("confirm-columns").addEventListener("click",() => {const start=state.columns.length;state.columns.push(...[...state.picker].filter(key => !state.columns.includes(key)));$("parameter-dialog").close();renderSheet();focusCell(0,start);toast(`已添加 ${state.columns.length-start} 个参数列`);});
    $("confirm-fill").addEventListener("click",() => {const rows=state.selected.size ? state.rows.filter(row => state.selected.has(row.id)) : state.rows;for(const row of rows) row.values[state.fillKey]=$("fill-value").value;$("fill-dialog").close();renderSheet();toast(`已填入 ${rows.length} 行`);});
    $("fill-value").addEventListener("keydown",event => {if(event.key === "Enter") $("confirm-fill").click();});
    $("generate-rows").addEventListener("click",openRange);
    $("range-fields").addEventListener("change",event => {if(event.target.type === "checkbox") event.target.closest(".range-field").querySelector(".range-values").disabled=!event.target.checked;previewRange();});
    $("range-fields").addEventListener("input",previewRange);
    for(const radio of document.querySelectorAll('[name="range-mode"]')) radio.addEventListener("change",previewRange);
    $("confirm-range").addEventListener("click",generateRange);
    $("export-plan").addEventListener("click",savePlan);
    $("import-plan").addEventListener("click",() => $("import-file").click());
    $("import-file").addEventListener("change",async event => {const file=event.target.files[0];event.target.value="";if(!file) return;if(file.size>25*1024*1024) return showAlert("方案文件超过 25 MB，请检查文件是否正确。" );if(state.columns.length && !confirm("导入方案将替换当前工况表。继续吗？")) return;await action(async () => {let data;try {data=JSON.parse(await file.text());}catch {throw new Error("文件不是有效的 JSON 方案。");}await importConfiguration(data);toast(`已恢复 ${state.rows.length} 行 × ${state.columns.length} 列`);});});
    $("start-run").addEventListener("click",startRun);
    $("stop-run").addEventListener("click",async () => {try {$("stop-run").disabled=true;await api("/api/stop",{});await fetchState();}catch(error) {fail(error);renderControls();}});
    window.addEventListener("pagehide",saveDraft);
  }
  bindEvents();renderSheet();fetchState(true);
})();
