"use strict";

const $ = (selector) => document.querySelector(selector);
const number = (value) => typeof value === "number" && Number.isFinite(value);
const format = (value, digits = 2) =>
  number(value)
    ? value.toLocaleString("zh-CN", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })
    : "—";
const scaled = (value, factor) => (number(value) ? value * factor : null);
const escapeText = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const state = {
  data: null,
  condition: null,
  scenario: "STD",
  view: "overview",
  equipment: "reactor",
  resultTab: "device",
  points: [],
};
const equipmentIds = ["feed", "pump", "exchanger", "heater", "reactor", "cooler", "separator"];
const titles = {
  overview: ["项目概览", "全流程分析工作台", "从能量集成到环境评价与工况选择"],
  sources: [
    "数据来源",
    "数据来源与核算约定",
    "追溯导入文件、工况关联和单位基准。",
  ],
  cases: [
    "工况数据",
    "浏览研究工况与配对方案",
    "以相同核算基准查看已导入的过程结果和生命周期评价数据。",
  ],
  process: [
    "工况与流程",
    "工况与流程",
    "从 STD / HR 能量集成方案进入清单、碳足迹与工况分析。",
  ],
  lca: [
    "生命周期评价",
    "追溯每一份产品的碳足迹",
    "连接前景清单、全球变暖潜势和目标单体质量，比较 STD 与 HR 方案。",
  ],
  screening: [
    "工况筛选",
    "在产率、焦炭与碳足迹间取舍",
    "先识别三目标 Pareto 候选，再根据研究偏好比较归一化效用。",
  ],
};

function currentCase() {
  return state.data.cases.find(
    (item) =>
      item.condition_id === state.condition && item.scenario === state.scenario,
  );
}

function pair() {
  return ["STD", "HR"].map((scenario) =>
    state.data.cases.find(
      (item) =>
        item.condition_id === state.condition && item.scenario === scenario,
    ),
  );
}

function nominalTemperature(item) {
  if (number(item.inputs.nominal_temperature_c))
    return item.inputs.nominal_temperature_c;
  return number(item.inputs.temperature_k)
    ? item.inputs.temperature_k - 273.15
    : null;
}

function conditionLabel(item) {
  return `${format(nominalTemperature(item), 0)} °C / ${format(item.inputs.length_m, 0)} m`;
}

function metric(title, value, unit, note, digits = 2) {
  return `<article class="metric"><div class="metric-label">${escapeText(title)}</div><div class="metric-number">${format(value, digits)}<span class="metric-unit">${escapeText(unit)}</span></div><div class="metric-note">${escapeText(note)}</div></article>`;
}

function detailRows(rows) {
  return rows
    .map(
      ([key, value]) =>
        `<div><dt>${escapeText(key)}</dt><dd>${escapeText(value)}</dd></div>`,
    )
    .join("");
}

function renderBars(selector, getter, interval = false) {
  const rows = pair();
  const values = rows.map((item) => (item ? getter(item) : null));
  const bounds = interval
    ? rows.flatMap((item) => item?.lca?.ci95_kg_co2e_per_kg_target ?? []).filter(number)
    : [];
  const max = Math.max(...values.filter(number), ...bounds, 0);
  $(selector).innerHTML = rows
    .map((item, index) => {
      const value = values[index];
      const scenario = ["STD", "HR"][index];
      const width =
        number(value) && max > 0 ? (Math.max(0, value) / max) * 100 : 0;
      const ci = item?.lca?.ci95_kg_co2e_per_kg_target;
      const hasInterval = interval && max > 0 && Array.isArray(ci) && ci.length === 2 && ci.every(number);
      const range = hasInterval
        ? `<div class="uncertainty-range" aria-label="${scenario} 的95%分位区间 ${format(ci[0])} 至 ${format(ci[1])}"><i style="left:${ci[0] / max * 100}%;width:${(ci[1] - ci[0]) / max * 100}%"></i>${number(item?.lca?.mc_mean_cf) ? `<b style="left:${item.lca.mc_mean_cf / max * 100}%" title="蒙特卡洛均值 ${format(item.lca.mc_mean_cf, 3)}"></b>` : ""}</div>`
        : "";
      const uncertainty = interval
        ? `<p class="bar-interval">MC 均值 ${format(item?.lca?.mc_mean_cf)} · 95% 分位区间 ${Array.isArray(ci) && ci.length === 2 && ci.every(number) ? `${format(ci[0])}–${format(ci[1])}` : "—"}</p>`
        : "";
      return `<div class="bar-row"><div class="bar-header"><span>${scenario} <small>${index ? "热回收" : "标准加热"}</small></span><strong>${format(value)}</strong></div><div class="bar-track"><div class="bar-fill ${index ? "hr" : ""}" style="width:${width}%"></div></div>${range}${uncertainty}</div>`;
    })
    .join("") + (interval ? `<div class="cf-chart-axis" aria-hidden="true"><span>0</span><span>${format(max / 2, 1)}</span><span>${format(max, 1)}</span></div>` : "");
}

function renderSelection() {
  const item = currentCase();
  if (!item) return;
  const input = item.inputs;
  const out = item.outputs;
  const lca = item.lca;
  $("#case-select").value = state.condition;
  document.querySelectorAll("[data-scenario]").forEach((button) => {
    const active = button.dataset.scenario === state.scenario;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.disabled = !state.data.cases.some(
      (row) =>
        row.condition_id === state.condition &&
        row.scenario === button.dataset.scenario,
    );
  });
  $("#selection-note").textContent =
    `名义温度 ${format(nominalTemperature(item), 0)} °C · 实际 ${format(number(input.temperature_k) ? input.temperature_k - 273.15 : null)} °C`;
  $("#selected-heading").textContent = conditionLabel(item);
  $("#scenario-pill").textContent =
    state.scenario === "STD" ? "STD · 标准加热" : "HR · 热回收";
  $("#process-metrics").innerHTML =
    metric("出口所含目标单体", out.target_monomer_kg, "kg", "统一湿进料基准") +
    metric("焦炭代理指标", out.char_proxy_kg, "kg", "元素碳质量代理", 4) +
    metric(
      "总等效电耗",
      scaled(out.electricity_j, 1 / 3.6e6),
      "kWh",
      "加热与清单泵耗",
    ) +
    metric(
      "单位产品碳足迹",
      lca.cf_kg_co2e_per_kg_target,
      "kg CO₂-eq/kg",
      "出口所含目标单体",
    );
  renderBars("#energy-bars", (row) =>
    scaled(row.outputs.electricity_j, 1 / 3.6e6),
  );
  $("#energy-note").textContent =
    `清单泵耗 ${format(scaled(out.pump_inventory_j, 1 / 3.6e6), 3)} kWh。总电耗按核算周期内的加热负荷与清单泵耗计量。`;
  $("#process-detail").innerHTML = detailRows([
    [
      "实际温度",
      `${format(number(input.temperature_k) ? input.temperature_k - 273.15 : null)} °C / ${format(input.temperature_k)} K`,
    ],
    [
      "压力 / 进料流量",
      `${format(scaled(input.pressure_pa, 1e-6), 1)} MPa / ${format(scaled(input.feed_kg_s, 3600), 1)} kg/h`,
    ],
    ["加热器热负荷", `${format(scaled(out.heater_w, 0.001), 3)} kW`],
    ["反应器维持热负荷", `${format(scaled(out.reactor_w, 0.001), 3)} kW`],
    ["泵功率", `${format(scaled(out.pump_w, 0.001), 3)} kW`],
    ["冷却器热负荷", `${format(scaled(out.cooler_w, 0.001), 3)} kW`],
    ["相分离器热负荷", `${format(scaled(out.separator_w, 0.001), 3)} kW`],
  ]);
  const provenance = item.provenance ?? {};
  const source = state.data.sources?.find(
    (row) => row.id === provenance.source_id,
  );
  const rowText = provenance.rows
    ? Object.entries(provenance.rows)
        .map(([key, row]) => `${key} 第 ${row} 行`)
        .join(" · ")
    : `第 ${provenance.source_row ?? "—"} 行`;
  $("#source-label").textContent =
    `${source?.label ?? provenance.source_id ?? "来源待补充"} · ${rowText}`;
  $("#quality-note").textContent =
    `${item.quality?.note ?? "状态待补充"} 数据状态 ${item.quality?.status ?? "—"}。`;
  $("#lca-metrics").innerHTML =
    metric(
      "核算基准内 GWP",
      lca.gwp_kg_co2e,
      "kg CO₂-eq",
      "100 kg 湿进料核算基准",
    ) +
    metric(
      "确定性碳足迹",
      lca.cf_kg_co2e_per_kg_target,
      "kg CO₂-eq/kg",
      "目标单体质量归一化",
    ) +
    metric("蒙特卡洛均值", lca.mc_mean_cf, "kg CO₂-eq/kg", "背景清单不确定性") +
    metric(
      "蒙特卡洛抽样",
      lca.iterations,
      "次",
      "95% 区间采用 2.5% 与 97.5% 分位数",
      0,
    );
  renderBars("#cf-bars", (row) => row.lca.cf_kg_co2e_per_kg_target, true);
  $("#formula-gwp").textContent = `${format(lca.gwp_kg_co2e, 3)} kg CO₂-eq`;
  $("#formula-mass").textContent =
    `${format(lca.reference_target_kg ?? out.target_monomer_kg, 6)} kg`;
  $("#formula-cf").textContent =
    `${format(lca.cf_kg_co2e_per_kg_target, 3)} kg CO₂-eq/kg`;
  $("#lca-detail").innerHTML = detailRows([
    [
      "系统边界",
      lca.boundary === "cradle-to-gate"
        ? "从摇篮到工厂大门"
        : (lca.boundary ?? "—"),
    ],
    ["影响评价方法", lca.method ?? "—"],
    ["过程核算基准", `${format(state.data.study.basis.wet_feed_kg, 0)} kg 湿进料`],
    ["碳足迹归一化", "1 kg 出口所含目标单体"],
    [
      "运行周期",
      `${format(scaled(state.data.study.basis.duration_s, 1 / 3600), 1)} h`,
    ],
    ["LCA 归一化质量", `${format(lca.reference_target_kg, 6)} kg`],
    ["不确定性范围", "已导入的背景清单蒙特卡洛统计"],
  ]);
  if (state.view === "screening") renderScreening();
  renderWorkspace();
}

function renderCases() {
  if (!state.data) return;
  const temperature = $("#temperature-filter").value;
  const scenario = $("#scenario-filter").value;
  const query = $("#case-search").value.trim().toUpperCase();
  const rows = state.data.cases.filter(
    (item) =>
      (!temperature || String(nominalTemperature(item)) === temperature) &&
      (!scenario || item.scenario === scenario) &&
      (!query || item.id.toUpperCase().includes(query)),
  );
  $("#dataset-summary").textContent =
    `${new Set(state.data.cases.map((item) => item.condition_id)).size} 个工况 · ${state.data.cases.length} 套方案 · 当前显示 ${rows.length} 套`;
  $("#cases-body").innerHTML =
    rows
      .map(
        (item) =>
          `<tr class="${item.id === currentCase()?.id ? "selected-row" : ""}"><td>${escapeText(item.condition_id)}</td><td><span class="pill">${escapeText(item.scenario)}</span></td><td>${format(nominalTemperature(item), 0)}</td><td>${format(item.inputs.length_m, 0)}</td><td>${format(item.outputs.target_monomer_kg, 3)}</td><td>${format(item.outputs.char_proxy_kg, 4)}</td><td>${format(scaled(item.outputs.electricity_j, 1 / 3.6e6))}</td><td>${format(item.lca.cf_kg_co2e_per_kg_target)}</td><td><button class="table-action" data-open-case="${escapeText(item.id)}" aria-label="查看 ${escapeText(item.id)}">查看 →</button></td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="9" class="empty">没有符合条件的工况</td></tr>';
}

function screeningRows(cases) {
  return cases.filter(
    (item) =>
      item.scenario === "STD" &&
      [
        item.outputs.target_monomer_kg,
        item.outputs.char_proxy_kg,
        item.lca.cf_kg_co2e_per_kg_target,
      ].every(number),
  );
}

function paretoFront(cases) {
  const rows = screeningRows(cases);
  return rows.filter(
    (candidate) =>
      !rows.some((other) => {
        const a = [
          candidate.outputs.target_monomer_kg,
          candidate.outputs.char_proxy_kg,
          candidate.lca.cf_kg_co2e_per_kg_target,
        ];
        const b = [
          other.outputs.target_monomer_kg,
          other.outputs.char_proxy_kg,
          other.lca.cf_kg_co2e_per_kg_target,
        ];
        return (
          b[0] >= a[0] &&
          b[1] <= a[1] &&
          b[2] <= a[2] &&
          (b[0] > a[0] || b[1] < a[1] || b[2] < a[2])
        );
      }),
  );
}

function rankCandidates(cases, weights) {
  const rows = screeningRows(cases);
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!rows.length || total <= 0) return [];
  const getters = [
    (item) => item.outputs.target_monomer_kg,
    (item) => item.outputs.char_proxy_kg,
    (item) => item.lca.cf_kg_co2e_per_kg_target,
  ];
  const limits = getters.map((get) => [
    Math.min(...rows.map(get)),
    Math.max(...rows.map(get)),
  ]);
  return paretoFront(rows)
    .map((item) => {
      const utility = getters.map((get, index) => {
        const [min, max] = limits[index];
        if (min === max) return 1;
        return index === 0
          ? (get(item) - min) / (max - min)
          : (max - get(item)) / (max - min);
      });
      return {
        item,
        score: utility.reduce(
          (sum, value, index) => sum + (value * weights[index]) / total,
          0,
        ),
      };
    })
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
}

function renderScreening() {
  const rows = screeningRows(state.data.cases);
  const front = paretoFront(rows);
  const fields = ["yield", "char", "cf"];
  const weights = fields.map((key) => Number($("#weight-" + key).value));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  document.querySelectorAll("[data-weights]").forEach((button) => {
    const preset = button.dataset.weights.split(",").map(Number);
    const presetTotal = preset.reduce((sum, value) => sum + value, 0);
    const active =
      total > 0 &&
      preset.every(
        (value, index) =>
          Math.abs(value / presetTotal - weights[index] / total) < 0.0001,
      );
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  fields.forEach((key, index) => {
    $("#weight-" + key + "-value").textContent =
      total > 0 ? `${format((weights[index] / total) * 100, 0)}%` : "—";
  });
  $("#weight-note").textContent =
    total > 0
      ? "权重按总和归一化。效用范围基于全部完整 STD 工况。"
      : "请将至少一项权重设为大于 0。";
  const ranked = rankCandidates(state.data.cases, weights);
  $("#winner").innerHTML = ranked.length
    ? `当前偏好下的最高得分<strong>${escapeText(conditionLabel(ranked[0].item))}</strong><span>得分 ${format(ranked[0].score, 3)}</span><button class="button primary" data-open-case="${escapeText(ranked[0].item.id)}">查看推荐工况 →</button>`
    : "等待有效工况与权重";
  $("#ranking-body").innerHTML =
    ranked
      .map(({ item, score }, index) => {
        const hr = state.data.cases.find(
          (other) =>
            other.condition_id === item.condition_id && other.scenario === "HR",
        );
        return `<tr><td>${index + 1}</td><td><button class="table-action" data-open-case="${escapeText(item.id)}">${escapeText(conditionLabel(item))}</button></td><td>${format(item.outputs.target_monomer_kg, 3)}</td><td>${format(item.outputs.char_proxy_kg, 4)}</td><td>${format(item.lca.cf_kg_co2e_per_kg_target)}</td><td>${format(hr?.lca?.cf_kg_co2e_per_kg_target)}</td><td>${format(score, 3)}</td></tr>`;
      })
      .join("") || '<tr><td colspan="7" class="empty">暂无可排序工况</td></tr>';
  const stdCount = state.data.cases.filter(
    (item) => item.scenario === "STD",
  ).length;
  $("#pareto-note").textContent =
    `${rows.length} 个完整 STD 工况中有 ${front.length} 个三目标 Pareto 候选。最大化目标单体质量，同时最小化焦炭代理指标与碳足迹。${rows.length < stdCount ? ` ${stdCount - rows.length} 个工况因指标缺失暂不参与。` : ""}`;
  drawPareto(rows, new Set(front.map((item) => item.id)));
}

function drawPareto(rows, frontierIds) {
  const canvas = $("#pareto-chart");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.font = '10px "DM Sans", "Microsoft YaHei", sans-serif';
  context.fillStyle = "#74858e";
  state.points = [];
  if (!rows.length) {
    context.fillText("暂无完整工况", 30, 40);
    return;
  }
  const left = 55,
    right = width - 20,
    top = 34,
    bottom = height - 45;
  const xValues = rows.map((item) => item.lca.cf_kg_co2e_per_kg_target);
  const yValues = rows.map((item) => item.outputs.target_monomer_kg);
  const range = (values) => {
    const min = Math.min(...values),
      max = Math.max(...values);
    const padding = (max - min || Math.abs(max) || 1) * 0.12;
    return [min - padding, max + padding];
  };
  const [xMin, xMax] = range(xValues),
    [yMin, yMax] = range(yValues);
  const xMap = (value) =>
    left + ((value - xMin) / (xMax - xMin)) * (right - left);
  const yMap = (value) =>
    bottom - ((value - yMin) / (yMax - yMin)) * (bottom - top);
  context.fillText("目标单体质量 / kg", left, 14);
  for (let tick = 0; tick <= 4; tick++) {
    const y = top + ((bottom - top) * tick) / 4;
    context.strokeStyle = "#e9eff0";
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(right, y);
    context.stroke();
    context.textAlign = "right";
    context.fillText(
      format(yMax - ((yMax - yMin) * tick) / 4, 1),
      left - 10,
      y + 4,
    );
    const x = left + ((right - left) * tick) / 4;
    context.textAlign = "center";
    context.fillText(
      format(xMin + ((xMax - xMin) * tick) / 4, 1),
      x,
      bottom + 19,
    );
  }
  context.textAlign = "center";
  context.fillText("碳足迹 / kg CO₂-eq·kg⁻¹", (left + right) / 2, height - 4);
  rows
    .slice()
    .sort(
      (a, b) => Number(frontierIds.has(a.id)) - Number(frontierIds.has(b.id)),
    )
    .forEach((item) => {
      const x = xMap(item.lca.cf_kg_co2e_per_kg_target),
        y = yMap(item.outputs.target_monomer_kg);
      const pareto = frontierIds.has(item.id);
      context.beginPath();
      context.arc(x, y, pareto ? 5.5 : 4.5, 0, Math.PI * 2);
      context.fillStyle = pareto ? "#16776c" : "#b4c2ca";
      context.fill();
      if (item.condition_id === state.condition) {
        context.beginPath();
        context.arc(x, y, 9, 0, Math.PI * 2);
        context.strokeStyle = "#b4843c";
        context.lineWidth = 1.4;
        context.stroke();
      }
      state.points.push({ x, y, item });
    });
}

function switchView(view, { historyMode = "push", scroll = true } = {}) {
  if (!titles[view]) return;
  const changed = state.view !== view;
  state.view = view;
  document.body.dataset.view = view;
  document.querySelectorAll(".view").forEach((section) => {
    section.hidden = section.id !== "view-" + view;
  });
  document.querySelectorAll("button[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
    if (button.dataset.view === view)
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("#breadcrumb-view").textContent = titles[view][0];
  $("#page-title").textContent = titles[view][1];
  $("#page-description").textContent = titles[view][2];
  if (!state.data) return;
  if (view === "cases") renderCases();
  if (view === "screening") renderScreening();
  if (view === "overview") renderOverview();
  if (view === "process") {
    window.htlPlant.mount();
    renderPlant();
  }
  saveWorkspace(historyMode);
  if (changed && scroll) window.scrollTo({ top: 0, behavior: "instant" });
}

function selectCase(item, view = state.view, options = {}) {
  state.condition = item.condition_id;
  state.scenario = item.scenario;
  rememberCase(item.id);
  renderSelection();
  switchView(view, options);
}

function savedWorkspace() {
  try {
    return (
      JSON.parse(localStorage.getItem("htl-workspace-state") || "{}") || {}
    );
  } catch {
    return {};
  }
}
function requestedWorkspace() {
  const params = new URLSearchParams(location.hash.slice(1));
  return params.has("view")
    ? {
        view: params.get("view"),
        case: params.get("case"),
        equipment: params.get("equipment"),
        resultTab: params.get("tab"),
        temperature: params.get("temperature"),
        scenarioFilter: params.get("scenario"),
        search: params.get("search"),
        weights: params.has("weights")
          ? params.get("weights").split(",").map(Number)
          : undefined,
      }
    : savedWorkspace();
}
function setWeights(weights) {
  if (
    !Array.isArray(weights) ||
    weights.length !== 3 ||
    !weights.every((value) => number(value) && value >= 0 && value <= 100)
  )
    return;
  ["yield", "char", "cf"].forEach(
    (key, index) => ($("#weight-" + key).value = weights[index]),
  );
}
function restoreWorkspaceControls(saved) {
  setWeights(saved.weights);
  state.equipment = equipmentIds.includes(saved.equipment) ? saved.equipment : "reactor";
  setResultTab(saved.resultTab === "compare" ? "compare" : "device", false);
  for (const [selector, value] of [["#temperature-filter", saved.temperature], ["#scenario-filter", saved.scenarioFilter]]) {
    const select = $(selector);
    select.value = Array.from(select.options).some((option) => option.value === value) ? value : "";
  }
  $("#case-search").value = typeof saved.search === "string" ? saved.search : "";
}
function saveWorkspace(mode = "push") {
  if (!state.data) return;
  const saved = {
    view: state.view,
    case: currentCase().id,
    equipment: state.equipment,
    resultTab: state.resultTab,
    temperature: $("#temperature-filter").value,
    scenarioFilter: $("#scenario-filter").value,
    search: $("#case-search").value,
    weights: ["yield", "char", "cf"].map((key) =>
      Number($("#weight-" + key).value),
    ),
  };
  try {
    localStorage.setItem("htl-workspace-state", JSON.stringify(saved));
  } catch {
    /* Browsing still works without local persistence. */
  }
  const hash =
    "#" +
    new URLSearchParams({
      view: saved.view,
      case: saved.case,
      equipment: saved.equipment,
      tab: saved.resultTab,
      temperature: saved.temperature,
      scenario: saved.scenarioFilter,
      search: saved.search,
      weights: saved.weights.join(","),
    }).toString();
  if (mode !== "none" && hash !== location.hash)
    history[mode === "replace" ? "replaceState" : "pushState"](null, "", hash);
}
// Module navigation controls scroll position, including browser history traversal.
history.scrollRestoration = "manual";
window.addEventListener("popstate", () => {
  if (!state.data) return;
  const saved = requestedWorkspace();
  restoreWorkspaceControls(saved);
  const item =
    state.data.cases.find((row) => row.id === saved.case) || currentCase();
  selectCase(item, titles[saved.view] ? saved.view : "overview", {
    historyMode: "none",
  });
});

function downloadCase() {
  if (!state.data) return;
  const item = currentCase();
  const payload = {
    schema_version: state.data.schema_version,
    study: state.data.study,
    case: item,
    sources: state.data.sources,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${item.id}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document
  .querySelectorAll("button[data-view]")
  .forEach((button) =>
    button.addEventListener("click", () => switchView(button.dataset.view)),
  );
document.querySelectorAll("[data-scenario]").forEach((button) =>
  button.addEventListener("click", () => {
    if (!state.data) return;
    const item = state.data.cases.find(
      (row) =>
        row.condition_id === state.condition &&
        row.scenario === button.dataset.scenario,
    );
    if (item) selectCase(item);
  }),
);
$("#case-select").addEventListener("change", (event) => {
  const item =
    state.data.cases.find(
      (row) =>
        row.condition_id === event.target.value &&
        row.scenario === state.scenario,
    ) ??
    state.data.cases.find((row) => row.condition_id === event.target.value);
  if (item) selectCase(item);
});
for (const [selector, eventName] of [["#temperature-filter", "change"], ["#scenario-filter", "change"], ["#case-search", "input"]]) {
  $(selector).addEventListener(eventName, () => {
    renderCases();
    saveWorkspace("replace");
  });
}
$("#download").addEventListener("click", downloadCase);
document.querySelectorAll('input[type="range"]').forEach((input) =>
  input.addEventListener("input", () => {
    if (state.data) {
      renderScreening();
      saveWorkspace("replace");
    }
  }),
);
document.addEventListener("click", (event) => {
  const overviewButton = event.target.closest("[data-overview-case]");
  if (overviewButton && state.data) {
    const item = state.data.cases.find(
      (row) => row.id === overviewButton.dataset.overviewCase,
    );
    if (item) {
      selectCase(item, "overview", { scroll: false });
      // Re-rendering the matrix replaces its buttons; retain keyboard focus.
      $(".overview-cell.selected")?.focus({ preventScroll: true });
    }
    return;
  }
  const button = event.target.closest("[data-open-case]");
  if (button && state.data) {
    const item = state.data.cases.find(
      (row) => row.id === button.dataset.openCase,
    );
    if (item) selectCase(item, "process");
  }
});
$("#pareto-chart").addEventListener("mousemove", (event) => {
  const bounds = event.target.getBoundingClientRect();
  const x = event.clientX - bounds.left,
    y = event.clientY - bounds.top;
  const point = state.points.find(
    (item) => Math.hypot(item.x - x, item.y - y) < 10,
  );
  const tooltip = $("#chart-tooltip");
  tooltip.hidden = !point;
  if (!point) return;
  tooltip.textContent = `${conditionLabel(point.item)}\n单体 ${format(point.item.outputs.target_monomer_kg, 3)} kg\n焦炭代理 ${format(point.item.outputs.char_proxy_kg, 4)} kg\nCF ${format(point.item.lca.cf_kg_co2e_per_kg_target)}`;
  tooltip.style.left = Math.max(0, Math.min(x + 12, bounds.width - 175)) + "px";
  tooltip.style.top = Math.max(0, y - 65) + "px";
});
$("#pareto-chart").addEventListener("mouseleave", () => {
  $("#chart-tooltip").hidden = true;
});
window.addEventListener("resize", () => {
  if (state.data && state.view === "screening") renderScreening();
});

async function initialize() {
  try {
    const response = await fetch("./data/study.json");
    if (!response.ok)
      throw new Error(`数据请求失败（HTTP ${response.status}）`);
    const data = await response.json();
    if (!Array.isArray(data.cases) || !data.cases.length || !data.study?.basis)
      throw new Error("数据文件缺少工况或核算基准");
    state.data = data;
    const conditions = Array.from(
      new Map(data.cases.map((item) => [item.condition_id, item])).values(),
    ).sort(
      (a, b) =>
        nominalTemperature(a) - nominalTemperature(b) ||
        a.inputs.length_m - b.inputs.length_m,
    );
    $("#case-select").innerHTML = conditions
      .map(
        (item) =>
          `<option value="${escapeText(item.condition_id)}">${escapeText(conditionLabel(item))}</option>`,
      )
      .join("");
    $("#case-select").disabled = false;
    $("#temperature-filter").innerHTML += Array.from(
      new Set(conditions.map(nominalTemperature)),
    )
      .map(
        (value) => `<option value="${value}">${format(value, 0)} °C</option>`,
      )
      .join("");
    $("#case-count").textContent = conditions.length;
    $("#basis-value").textContent =
      `${format(data.study.basis.wet_feed_kg, 0)} kg 湿进料`;
    $("#basis-duration").textContent =
      `${format(scaled(data.study.basis.duration_s, 1 / 3600), 0)} h 连续运行`;
    $("#dataset-note").textContent = data.study.source_note ?? "已导入结果分析";
    $("#schema-label").textContent = `数据结构 v${data.schema_version}`;
    $("#download").disabled = false;
    const saved = requestedWorkspace();
    restoreWorkspaceControls(saved);
    $("#inspector-temperature").disabled = false;
    $("#inspector-length").disabled = false;
    selectCase(
      data.cases.find((item) => item.id === saved.case) ??
        data.cases.find((item) => item.id === recentIds()[0]) ??
        data.cases.find(
          (item) =>
            item.condition_id === conditions[0].condition_id &&
            item.scenario === "STD",
        ) ??
        data.cases[0],
      titles[saved.view] ? saved.view : "overview",
      { historyMode: "replace" },
    );
  } catch (error) {
    $("#load-error").hidden = false;
    $("#load-error").textContent =
      `无法载入分析数据。${error.message}。请通过本地 HTTP 服务打开页面，并确认 data/study.json 可访问。`;
    $("#dataset-note").textContent = "数据加载失败";
    $("#case-select").innerHTML = "<option>数据暂不可用</option>";
    document.querySelectorAll("[data-scenario]").forEach((button) => {
      button.disabled = true;
    });
  }
}

function recentIds() {
  try {
    const ids = JSON.parse(localStorage.getItem("htl-recent-cases") || "[]");
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function rememberCase(id) {
  try {
    localStorage.setItem(
      "htl-recent-cases",
      JSON.stringify(
        [id, ...recentIds().filter((old) => old !== id)].slice(0, 5),
      ),
    );
  } catch {
    // The current selection remains usable when browser storage is unavailable.
  }
}

function renderOverview() {
  if (!state.data) return;
  const cases = state.data.cases;
  const current = currentCase();
  if (!current) return;
  const basis = state.data.study.basis;
  const basisLabel = `${format(basis.wet_feed_kg, 0)} kg 湿进料 / ${format(basis.duration_s / 3600, 0)} h`;
  $("#home-conditions").textContent = new Set(
    cases.map((item) => item.condition_id),
  ).size;
  $("#home-scenarios").textContent = cases.length;
  $("#home-basis").textContent = basisLabel;
  $("#home-current-condition").textContent = current.condition_id;
  $("#home-current-scenario").textContent =
    current.scenario === "HR" ? "HR · 热回收" : "STD · 标准加热";
  $("#home-current-meta").textContent =
    `${conditionLabel(current)} · ${format(current.inputs.pressure_pa / 1e6, 1)} MPa`;

  const kpis = [
    ["总等效电耗", scaled(current.outputs.electricity_j, 1 / 3.6e6), "kWh", basisLabel],
    ["单位产品碳足迹", current.lca.cf_kg_co2e_per_kg_target, "kg CO₂-eq/kg", "归一化至 1 kg 出口所含目标单体"],
    ["出口所含目标单体", current.outputs.target_monomer_kg, "kg", `焦炭代理 ${format(current.outputs.char_proxy_kg, 4)} kg`],
  ];
  $("#home-kpis").innerHTML = kpis.map(([label, value, unit, note], index) =>
    `<article class="overview-kpi overview-kpi-${index + 1}"><div class="overview-kpi-label">${escapeText(label)}<span>${escapeText(current.scenario)}</span></div><div class="overview-kpi-value">${format(value, 3)}<span class="overview-kpi-unit">${escapeText(unit)}</span></div><p class="overview-kpi-note">${escapeText(note)}</p></article>`,
  ).join("");

  const temperatures = [...new Set(cases.map(nominalTemperature))].sort((a, b) => a - b);
  const lengths = [...new Set(cases.map((item) => item.inputs.length_m))].sort((a, b) => a - b);
  const cfValues = cases.map((item) => item.lca.cf_kg_co2e_per_kg_target).filter(number);
  const minCF = Math.min(...cfValues);
  const maxCF = Math.max(...cfValues);
  $("#home-matrix-head").innerHTML = `<tr><th scope="col">温度 / 管长</th>${lengths.map((length) => `<th scope="col">${format(length, 0)} m</th>`).join("")}</tr>`;
  $("#home-matrix-body").innerHTML = temperatures.map((temperature) =>
    `<tr><th scope="row">${format(temperature, 0)} °C</th>${lengths.map((length) => {
      const item = cases.find((row) =>
        row.scenario === state.scenario && nominalTemperature(row) === temperature && row.inputs.length_m === length,
      );
      if (!item) return '<td><span class="overview-cell-empty">—</span></td>';
      const cf = item.lca.cf_kg_co2e_per_kg_target;
      const selected = item.id === current.id;
      const tone = number(cf) ? (cf - minCF) / (maxCF - minCF || 1) : 0;
      const description = `${item.condition_id}，${item.scenario}，碳足迹 ${format(cf, 3)} kg CO₂-eq/kg 出口所含目标单体`;
      return `<td><button type="button" class="overview-cell${selected ? " selected" : ""}" data-overview-case="${escapeText(item.id)}" style="--cell-tone:${tone.toFixed(4)}" aria-pressed="${selected}" aria-label="${escapeText(description)}" title="${escapeText(description)}"><span>${format(cf, 2)}</span><span class="overview-cell-check" aria-hidden="true">${selected ? "✓" : ""}</span></button></td>`;
    }).join("")}</tr>`,
  ).join("");
  $("#home-matrix-selection").textContent = `当前 ${current.condition_id} · ${current.scenario}`;
  $("#home-matrix-min").textContent = `低 ${format(minCF, 2)}`;
  $("#home-matrix-max").textContent = `${format(maxCF, 2)} 高`;

  const paired = pair().filter(Boolean);
  function pairChart(title, unit, getter) {
    const max = Math.max(...paired.map(getter).filter(number), 0);
    return `<div class="overview-pair-chart-heading"><h3>${escapeText(title)}</h3><span>${escapeText(unit)}</span></div>${paired.map((item) => {
      const value = getter(item);
      const width = number(value) && max > 0 ? Math.max(0, value) / max * 100 : 0;
      return `<div class="overview-pair-row"><span>${item.scenario}</span><span class="overview-pair-track" aria-hidden="true"><i class="overview-pair-fill ${item.scenario.toLowerCase()}" style="width:${width}%"></i></span><strong>${format(value, 3)}</strong></div>`;
    }).join("")}<div class="overview-pair-axis" aria-hidden="true"><span>0</span><span>${format(max, 1)}</span></div>`;
  }
  $("#home-energy-bars").innerHTML = pairChart("总等效电耗", "kWh", (item) => scaled(item.outputs.electricity_j, 1 / 3.6e6));
  $("#home-cf-bars").innerHTML = pairChart("单位产品碳足迹", "kg CO₂-eq/kg", (item) => item.lca.cf_kg_co2e_per_kg_target);
  const [std, hr] = pair();
  if (std && hr) {
    const energyReduction = (1 - hr.outputs.electricity_j / std.outputs.electricity_j) * 100;
    const cfReduction = (1 - hr.lca.cf_kg_co2e_per_kg_target / std.lca.cf_kg_co2e_per_kg_target) * 100;
    $("#home-pair-summary").innerHTML = `HR 相较 STD：电耗${energyReduction >= 0 ? "降低" : "增加"} <strong>${format(Math.abs(energyReduction), 1)}%</strong>，碳足迹${cfReduction >= 0 ? "降低" : "增加"} <strong>${format(Math.abs(cfReduction), 1)}%</strong>。`;
  } else {
    $("#home-pair-summary").textContent = "当前工况缺少配对方案。";
  }
  const recent = recentIds()
    .map((id) => cases.find((item) => item.id === id))
    .filter(Boolean);
  $("#recent-title").textContent = recent.length ? "最近查看" : "快速打开";
  const displayed = recent.length
    ? recent
    : cases.filter((item) => item.scenario === "STD").slice(0, 3);
  $("#recent-cases").innerHTML = displayed
    .map(
      (item) =>
        `<tr><td>${conditionLabel(item)}</td><td><span class="pill">${item.scenario}</span></td><td>✓ 已导入</td><td><button class="table-action" data-open-case="${escapeText(item.id)}">打开 →</button></td></tr>`,
    )
    .join("");
}

function renderWorkspace() {
  const item = currentCase();
  $("#current-context").textContent = item.id;
  const temperatures = [
    ...new Set(state.data.cases.map(nominalTemperature)),
  ].sort((a, b) => a - b);
  const lengths = [
    ...new Set(
      state.data.cases
        .filter((row) => nominalTemperature(row) === nominalTemperature(item))
        .map((row) => row.inputs.length_m),
    ),
  ].sort((a, b) => a - b);
  $("#inspector-temperature").innerHTML = temperatures
    .map((value) => `<option value="${value}">${value} °C</option>`)
    .join("");
  $("#inspector-temperature").value = nominalTemperature(item);
  $("#inspector-length").innerHTML = lengths
    .map((value) => `<option value="${value}">${value} m</option>`)
    .join("");
  $("#inspector-length").value = item.inputs.length_m;
  $("#inspector-actual").textContent =
    `${format(item.inputs.temperature_k)} K / ${format(item.inputs.temperature_k - 273.15)} °C`;
  $("#inspector-pressure").textContent =
    `${format(item.inputs.pressure_pa / 1e6, 0)} MPa`;
  $("#paired-body").innerHTML = pair()
    .filter(Boolean)
    .map(
      (row) =>
        `<tr><td><span class="pill">${row.scenario}</span></td><td>${format(row.outputs.electricity_j / 3.6e6)}</td><td>${format(row.lca.cf_kg_co2e_per_kg_target)}</td></tr>`,
    )
    .join("");
  const [std, hr] = pair();
  const energyChange =
    ((std.outputs.electricity_j - hr.outputs.electricity_j) /
      std.outputs.electricity_j) *
    100;
  const carbonChange =
    ((std.lca.cf_kg_co2e_per_kg_target - hr.lca.cf_kg_co2e_per_kg_target) /
      std.lca.cf_kg_co2e_per_kg_target) *
    100;
  $("#comparison-summary").innerHTML =
    `<p>相较 STD，HR 等效电耗${energyChange >= 0 ? "降低" : "增加"} <strong>${format(Math.abs(energyChange), 1)}%</strong>，碳足迹${carbonChange >= 0 ? "降低" : "增加"} <strong>${format(Math.abs(carbonChange), 1)}%</strong>。</p><p>基准：100 kg 湿进料 / 1 h；HR 产物沿用配对 STD 结果。</p>`;
  const names = {
    process: "过程与产物",
    energy: "设备能耗",
    inventory: "配对生命周期清单",
    monte_carlo: "蒙特卡洛统计",
  };
  $("#source-cards").innerHTML = state.data.sources
    .map(
      (source) =>
        `<article class="source-card"><h3>${escapeText(names[source.id] || source.id)}</h3><p>${escapeText(source.label)}</p><code>SHA256 ${escapeText(source.sha256)}</code></article>`,
    )
    .join("");
  renderOverview();
  renderPlant();
}

function renderPlant() {
  const item = currentCase();
  if (!item) return;
  const out = item.outputs,
    input = item.inputs;
  const kw = (value) => `${format(scaled(value, 0.001), 3)} kW`;
  const equipment = {
    feed: {
      name: "进料边界",
      tag: "FEED",
      rows: [
        ["湿进料流率", `${format(input.feed_kg_s * 3600, 1)} kg/h`],
        ["核算时段", "1 h"],
        ["总湿进料", "100 kg"],
      ],
      note: "三维进料容器用于说明系统边界；尺寸为示意。",
    },
    pump: {
      name: "高压泵",
      tag: "PUMP",
      rows: [
        ["出口压力设定", `${format(input.pressure_pa / 1e6, 1)} MPa`],
        ["模型轴功率", kw(out.pump_w)],
        ["LCA 清单泵电量", `${format(out.pump_inventory_j / 3.6e6, 3)} kWh`],
      ],
      note: "模型功率与清单电量分别保留原始精度。",
    },
    exchanger: {
      name: "热回收换热器",
      tag: "HEAT RECOVERY",
      rows: [
        ["当前方案", item.scenario === "HR" ? "启用热回收" : "标准加热 · 旁路"],
        ["HR 加热器负荷", kw(pair()[1]?.outputs.heater_w)],
        ["STD 加热器负荷", kw(pair()[0]?.outputs.heater_w)],
      ],
      note: "金色虚线表示出料与进料之间的热量回收关系。当前数据未独立导入换热器热负荷。",
    },
    heater: {
      name: "电加热器",
      tag: "HEATER",
      rows: [
        ["设备热负荷", kw(out.heater_w)],
        ["实际模型温度", `${format(input.temperature_k - 273.15)} °C`],
        [
          "加热方案",
          item.scenario === "HR" ? "热回收后补充加热" : "标准电加热",
        ],
      ],
      note: "设备热负荷来自当前方案的归档能耗数据。",
    },
    reactor: {
      name: "管式反应器",
      tag: "REACTOR",
      rows: [
        ["实际模型温度", `${format(input.temperature_k - 273.15)} °C`],
        ["反应器管长", `${format(input.length_m, 0)} m`],
        ["反应压力", `${format(input.pressure_pa / 1e6, 1)} MPa`],
        ["维持热负荷", kw(out.reactor_w)],
      ],
      note: "蛇形管为设备示意。HR 产物结果沿用配对 STD 反应出口。",
    },
    cooler: {
      name: "冷却器",
      tag: "COOLER",
      rows: [
        ["设备热负荷", kw(out.cooler_w)],
        ["符号约定", "负值表示移出热量"],
        ["方案", item.scenario],
      ],
      note: "保留原始热负荷符号，冷却需求单独记录。",
    },
    separator: {
      name: "相分离器",
      tag: "SEPARATOR",
      rows: [
        ["设备热负荷", kw(out.separator_w)],
        ["反应出口所含单体", `${format(out.target_monomer_kg, 3)} kg`],
      ],
      note: "单体指标按反应出口所含目标化合物统计，不表示分离后的产品纯度或回收率。",
    },
  };
  const device = equipment[state.equipment];
  $("#device-name").textContent = device.name;
  $("#device-kicker").textContent = device.tag;
  $("#device-tag").textContent = item.scenario;
  $("#device-values").innerHTML = detailRows(device.rows);
  $("#device-note").textContent = device.note;
  document.querySelectorAll("[data-equipment]").forEach((button) => {
    const active = button.dataset.equipment === state.equipment;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#plant-readings").innerHTML = [
    ["总等效电耗", out.electricity_j / 3.6e6, "kWh"],
    ["出口所含目标单体", out.target_monomer_kg, "kg"],
    ["单位产品碳足迹", item.lca.cf_kg_co2e_per_kg_target, "kg CO₂-eq/kg"],
  ]
    .map(
      ([name, value, unit]) =>
        `<div><small>${name}</small><strong>${format(value)}</strong><span>${unit}</span></div>`,
    )
    .join("");
  $("#plant-case-id").textContent = item.id;
  $("#plant-status-source").textContent =
    `来源 · 能耗表第 ${item.provenance.rows.energy} 行`;
  window.htlPlant.setScenario(item.scenario);
  window.htlPlant.select(state.equipment);
}

function selectEquipment(id) {
  if (!state.data || !equipmentIds.includes(id)) return;
  state.equipment = id;
  setResultTab("device");
  renderPlant();
}
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-equipment]");
  if (button) selectEquipment(button.dataset.equipment);
});
document.addEventListener("htl-equipment", (event) =>
  selectEquipment(event.detail),
);

function changeInspector() {
  if (!state.data) return;
  const temperature = Number($("#inspector-temperature").value);
  const length = Number($("#inspector-length").value);
  const rows = state.data.cases.filter(
    (item) =>
      nominalTemperature(item) === temperature &&
      item.scenario === state.scenario,
  );
  const item = rows.find((row) => row.inputs.length_m === length) || rows[0];
  if (item) selectCase(item);
}

function setResultTab(tab, persist = true) {
  if (!["device", "compare"].includes(tab)) return;
  state.resultTab = tab;
  document.querySelectorAll("[data-result-tab]").forEach((button) => {
    const active = button.dataset.resultTab === tab;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    $("#result-" + button.dataset.resultTab).hidden = !active;
  });
  if (persist) saveWorkspace("replace");
}
document
  .querySelectorAll("[data-result-tab]")
  .forEach((button, index, tabs) => {
    button.addEventListener("click", () =>
      setResultTab(button.dataset.resultTab),
    );
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
              tabs.length;
      setResultTab(tabs[next].dataset.resultTab);
      tabs[next].focus();
    });
  });
document.querySelectorAll("[data-weights]").forEach((button) =>
  button.addEventListener("click", () => {
    setWeights(button.dataset.weights.split(",").map(Number));
    renderScreening();
    saveWorkspace("replace");
  }),
);

function openDetail(kind) {
  if (!state.data) return;
  const item = currentCase();
  const out = item.outputs;
  const details = {
    inventory: {
      title: "能耗清单",
      rows: [
        ["加热器", `${format(out.heater_w / 1000, 3)} kW`],
        ["反应器维持热负荷", `${format(out.reactor_w / 1000, 3)} kW`],
        ["LCA 泵电量", `${format(out.pump_inventory_j / 3.6e6, 3)} kWh`],
        ["总等效电耗", `${format(out.electricity_j / 3.6e6, 3)} kWh`],
      ],
      note: "按 1 h / 100 kg 湿进料核算。冷却与闪蒸热负荷单独记录。",
    },
    carbon: {
      title: "碳足迹核算",
      rows: [
        ["100 kg 湿进料 GWP", `${format(item.lca.gwp_kg_co2e, 3)} kg CO₂-eq`],
        [
          "LCA 归一化目标单体质量",
          `${format(item.lca.reference_target_kg, 6)} kg`,
        ],
        [
          "确定性 CF",
          `${format(item.lca.cf_kg_co2e_per_kg_target, 3)} kg CO₂-eq/kg`,
        ],
        [
          "MC 95% 分位区间",
          item.lca.ci95_kg_co2e_per_kg_target
            .map((value) => format(value, 3))
            .join(" – "),
        ],
      ],
      note: "CF = GWP / LCA 归一化目标单体质量。区间来自背景清单蒙特卡洛抽样。",
    },
    condition: {
      title: conditionLabel(item) + " · " + item.scenario,
      rows: [
        ["工况 ID", item.id],
        ["实际温度", `${item.inputs.temperature_k} K`],
        ["进料流率", `${format(item.inputs.feed_kg_s * 3600)} kg/h`],
        ["停留时间", `${format(out.residence_time_s / 3600, 4)} h`],
        ["目标单体", `${format(out.target_monomer_kg, 6)} kg`],
        ["焦炭代理", `${format(out.char_proxy_kg, 6)} kg`],
      ],
      note: item.quality.note,
    },
  };
  const detail = details[kind];
  if (!detail) return;
  $("#dialog-title").textContent = detail.title;
  $("#dialog-content").innerHTML =
    `<dl class="detail-list">${detailRows(detail.rows)}</dl><p>${escapeText(detail.note)}</p>`;
  $("#detail-dialog").showModal();
}

$("#inspector-temperature").addEventListener("change", changeInspector);
$("#inspector-length").addEventListener("change", changeInspector);
document
  .querySelectorAll("[data-detail]")
  .forEach((button) =>
    button.addEventListener("click", () => openDetail(button.dataset.detail)),
  );
$("#close-detail").addEventListener("click", () => $("#detail-dialog").close());
$(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  switchView("overview");
});

window.analysisScreening = { paretoFront, rankCandidates };
switchView("overview");
initialize();
