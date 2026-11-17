"use strict";

const $ = (selector) => document.querySelector(selector);
const number = (value) => typeof value === "number" && Number.isFinite(value);
const format = (value, digits = 2) =>
  number(value)
    ? value.toLocaleString("en-US", {
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
  points: [],
};
const titles = {
  overview: ["Overview", "Process Analysis Workspace", "From energy integration to environmental assessment and condition selection"],
  sources: [
    "Data Sources",
    "Sources & Accounting Conventions",
    "Trace source files, paired conditions and accounting units.",
  ],
  cases: [
    "Case Data",
    "Explore Conditions & Paired Scenarios",
    "Explore archived process and life cycle results on a common accounting basis.",
  ],
  process: [
    "Process & Equipment",
    "Process & Equipment",
    "Connect STD / HR energy integration to inventory, carbon footprint and case screening.",
  ],
  lca: [
    "Life Cycle Assessment",
    "Trace the Carbon Footprint",
    "Connect foreground inventories, global warming potential and target monomer mass to compare STD and HR.",
  ],
  screening: [
    "Case Screening",
    "Balance Yield, Char & Carbon Footprint",
    "Identify three-objective Pareto candidates, then compare normalized utility under your preferences.",
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
        ? `<div class="uncertainty-range" aria-label="${scenario} 95% percentile interval ${format(ci[0])} to ${format(ci[1])}"><i style="left:${ci[0] / max * 100}%;width:${(ci[1] - ci[0]) / max * 100}%"></i>${number(item?.lca?.mc_mean_cf) ? `<b style="left:${item.lca.mc_mean_cf / max * 100}%" title="Monte Carlo mean ${format(item.lca.mc_mean_cf, 3)}"></b>` : ""}</div>`
        : "";
      const uncertainty = interval
        ? `<p class="bar-interval">MC mean ${format(item?.lca?.mc_mean_cf)} · 95% percentile interval ${Array.isArray(ci) && ci.length === 2 && ci.every(number) ? `${format(ci[0])}–${format(ci[1])}` : "—"}</p>`
        : "";
      return `<div class="bar-row"><div class="bar-header"><span>${scenario} <small>${index ? "Heat recovery" : "Standard heating"}</small></span><strong>${format(value)}</strong></div><div class="bar-track"><div class="bar-fill ${index ? "hr" : ""}" style="width:${width}%"></div></div>${range}${uncertainty}</div>`;
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
    `Temperature ${format(nominalTemperature(item), 0)} °C · actual ${format(number(input.temperature_k) ? input.temperature_k - 273.15 : null)} °C`;
  $("#selected-heading").textContent = conditionLabel(item);
  $("#scenario-pill").textContent =
    state.scenario === "STD" ? "STD · Standard heating" : "HR · Heat recovery";
  $("#process-metrics").innerHTML =
    metric("Outlet Target Monomers", out.target_monomer_kg, "kg", "Common wet-feed basis") +
    metric("Char proxy", out.char_proxy_kg, "kg", "Elemental carbon mass proxy", 4) +
    metric(
      "Equivalent Electricity",
      scaled(out.electricity_j, 1 / 3.6e6),
      "kWh",
      "Heating and inventory pump demand",
    ) +
    metric(
      "Product Carbon Footprint",
      lca.cf_kg_co2e_per_kg_target,
      "kg CO₂-eq/kg",
      "target monomers in the outlet",
    );
  renderBars("#energy-bars", (row) =>
    scaled(row.outputs.electricity_j, 1 / 3.6e6),
  );
  $("#energy-note").textContent =
    `Inventory pump electricity ${format(scaled(out.pump_inventory_j, 1 / 3.6e6), 3)} kWh. Total electricity includes heating and inventory pump demand over the accounting period.`;
  $("#process-detail").innerHTML = detailRows([
    [
      "Actual temperature",
      `${format(number(input.temperature_k) ? input.temperature_k - 273.15 : null)} °C / ${format(input.temperature_k)} K`,
    ],
    [
      "Pressure / feed flow",
      `${format(scaled(input.pressure_pa, 1e-6), 1)} MPa / ${format(scaled(input.feed_kg_s, 3600), 1)} kg/h`,
    ],
    ["Heater duty", `${format(scaled(out.heater_w, 0.001), 3)} kW`],
    ["Reactor holding duty", `${format(scaled(out.reactor_w, 0.001), 3)} kW`],
    ["Pump power", `${format(scaled(out.pump_w, 0.001), 3)} kW`],
    ["Cooler duty", `${format(scaled(out.cooler_w, 0.001), 3)} kW`],
    ["Separator duty", `${format(scaled(out.separator_w, 0.001), 3)} kW`],
  ]);
  const provenance = item.provenance ?? {};
  const source = state.data.sources?.find(
    (row) => row.id === provenance.source_id,
  );
  const rowText = provenance.rows
    ? Object.entries(provenance.rows)
        .map(([key, row]) => `${key} row ${row}`)
        .join(" · ")
    : `Row ${provenance.source_row ?? "—"}`;
  $("#source-label").textContent =
    `${source?.label ?? provenance.source_id ?? "Source pending"} · ${rowText}`;
  $("#quality-note").textContent =
    `Archived manuscript calculations. HR product results use the corresponding STD reactor outlet. Data status: ${item.quality?.status ?? "—"}.`;
  $("#lca-metrics").innerHTML =
    metric(
      "GWP within Accounting Basis",
      lca.gwp_kg_co2e,
      "kg CO₂-eq",
      "100 kg wet-feed accounting basis",
    ) +
    metric(
      "Deterministic Carbon Footprint",
      lca.cf_kg_co2e_per_kg_target,
      "kg CO₂-eq/kg",
      "Normalized by target monomer mass",
    ) +
    metric("Monte Carlo mean", lca.mc_mean_cf, "kg CO₂-eq/kg", "Background inventory uncertainty") +
    metric(
      "Monte Carlo Samples",
      lca.iterations,
      "samples",
      "95% interval: 2.5th–97.5th percentiles",
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
      "System boundary",
      lca.boundary === "cradle-to-gate"
        ? "Cradle-to-gate"
        : (lca.boundary ?? "—"),
    ],
    ["Impact assessment method", lca.method ?? "—"],
    ["Process accounting basis", `${format(state.data.study.basis.wet_feed_kg, 0)} kg wet feed`],
    ["Carbon footprint normalization", "1 kg target monomers in the outlet"],
    [
      "Accounting period",
      `${format(scaled(state.data.study.basis.duration_s, 1 / 3600), 1)} h`,
    ],
    ["LCA reference mass", `${format(lca.reference_target_kg, 6)} kg`],
    ["Uncertainty scope", "Imported Monte Carlo statistics for the background inventory"],
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
    `${new Set(state.data.cases.map((item) => item.condition_id)).size} conditions · ${state.data.cases.length} scenarios · Shown ${rows.length} scenarios`;
  $("#cases-body").innerHTML =
    rows
      .map(
        (item) =>
          `<tr class="${item.id === currentCase()?.id ? "selected-row" : ""}"><td>${escapeText(item.condition_id)}</td><td><span class="pill">${escapeText(item.scenario)}</span></td><td>${format(nominalTemperature(item), 0)}</td><td>${format(item.inputs.length_m, 0)}</td><td>${format(item.outputs.target_monomer_kg, 3)}</td><td>${format(item.outputs.char_proxy_kg, 4)}</td><td>${format(scaled(item.outputs.electricity_j, 1 / 3.6e6))}</td><td>${format(item.lca.cf_kg_co2e_per_kg_target)}</td><td><button class="table-action" data-open-case="${escapeText(item.id)}" aria-label="View ${escapeText(item.id)}">View →</button></td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="9" class="empty">No conditions match your filters</td></tr>';
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
      ? "Weights are normalized by their sum. Utility ranges use all complete STD conditions."
      : "Set at least one weight above zero.";
  const ranked = rankCandidates(state.data.cases, weights);
  $("#winner").innerHTML = ranked.length
    ? `Highest Score under Current Preferences<strong>${escapeText(conditionLabel(ranked[0].item))}</strong><span>Score ${format(ranked[0].score, 3)}</span><button class="button primary" data-open-case="${escapeText(ranked[0].item.id)}">Open recommended condition →</button>`
    : "Awaiting valid conditions and weights";
  $("#ranking-body").innerHTML =
    ranked
      .map(({ item, score }, index) => {
        const hr = state.data.cases.find(
          (other) =>
            other.condition_id === item.condition_id && other.scenario === "HR",
        );
        return `<tr><td>${index + 1}</td><td><button class="table-action" data-open-case="${escapeText(item.id)}">${escapeText(conditionLabel(item))}</button></td><td>${format(item.outputs.target_monomer_kg, 3)}</td><td>${format(item.outputs.char_proxy_kg, 4)}</td><td>${format(item.lca.cf_kg_co2e_per_kg_target)}</td><td>${format(hr?.lca?.cf_kg_co2e_per_kg_target)}</td><td>${format(score, 3)}</td></tr>`;
      })
      .join("") || '<tr><td colspan="7" class="empty">No conditions available for ranking</td></tr>';
  const stdCount = state.data.cases.filter(
    (item) => item.scenario === "STD",
  ).length;
  $("#pareto-note").textContent =
    `${rows.length} complete STD conditions include ${front.length} three-objective Pareto candidates. Maximize target monomer mass while minimizing char proxy and carbon footprint.${rows.length < stdCount ? ` ${stdCount - rows.length} conditions are excluded because required metrics are missing.` : ""}`;
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
  context.font = '500 14px "Inter", "Segoe UI", sans-serif';
  context.fillStyle = "#555555";
  state.points = [];
  if (!rows.length) {
    context.fillText("No complete conditions", 30, 40);
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
  context.fillText("Target monomer mass / kg", left, 14);
  for (let tick = 0; tick <= 4; tick++) {
    const y = top + ((bottom - top) * tick) / 4;
    context.strokeStyle = "#e4e4e4";
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
  context.fillText("Carbon footprint / kg CO₂-eq·kg⁻¹", (left + right) / 2, height - 4);
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
      context.fillStyle = pareto ? "#202020" : "#aaaaaa";
      context.fill();
      if (item.condition_id === state.condition) {
        context.beginPath();
        context.arc(x, y, 9, 0, Math.PI * 2);
        context.strokeStyle = "#111111";
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
      JSON.parse(localStorage.getItem("htl-en-workspace-state") || "{}") || {}
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
function saveWorkspace(mode = "push") {
  if (!state.data) return;
  const saved = {
    view: state.view,
    case: currentCase().id,
    weights: ["yield", "char", "cf"].map((key) =>
      Number($("#weight-" + key).value),
    ),
  };
  try {
    localStorage.setItem("htl-en-workspace-state", JSON.stringify(saved));
  } catch {
    /* Browsing still works without local persistence. */
  }
  const hash =
    "#" +
    new URLSearchParams({
      view: saved.view,
      case: saved.case,
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
  setWeights(saved.weights);
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
$("#temperature-filter").addEventListener("change", renderCases);
$("#scenario-filter").addEventListener("change", renderCases);
$("#case-search").addEventListener("input", renderCases);
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
  tooltip.textContent = `${conditionLabel(point.item)}\nMonomers ${format(point.item.outputs.target_monomer_kg, 3)} kg\nChar proxy ${format(point.item.outputs.char_proxy_kg, 4)} kg\nCF ${format(point.item.lca.cf_kg_co2e_per_kg_target)}`;
  tooltip.style.left = Math.max(0, Math.min(x + 12, bounds.width - tooltip.offsetWidth)) + "px";
  tooltip.style.top = Math.max(0, Math.min(y - tooltip.offsetHeight - 12, bounds.height - tooltip.offsetHeight)) + "px";
});
$("#pareto-chart").addEventListener("mouseleave", () => {
  $("#chart-tooltip").hidden = true;
});
window.addEventListener("resize", () => {
  if (state.data && state.view === "screening") renderScreening();
});
document.fonts.ready.then(() => {
  if (state.data && state.view === "screening") renderScreening();
  if (state.data && state.view === "process") window.htlPlant?.resize();
});

async function initialize() {
  try {
    const response = await fetch("./data/study.json");
    if (!response.ok)
      throw new Error(`Data request failed (HTTP ${response.status})`);
    const data = await response.json();
    if (!Array.isArray(data.cases) || !data.cases.length || !data.study?.basis)
      throw new Error("The data file lacks conditions or an accounting basis");
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
      `${format(data.study.basis.wet_feed_kg, 0)} kg wet feed`;
    $("#basis-duration").textContent =
      `${format(scaled(data.study.basis.duration_s, 1 / 3600), 0)} h continuous operation`;
    $("#dataset-note").textContent = "Revised-manuscript archive. Energy demands use the LCA inventory after energy-unit correction.";
    $("#schema-label").textContent = `Data schema v${data.schema_version}`;
    $("#download").disabled = false;
    const saved = requestedWorkspace();
    setWeights(saved.weights);
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
      `Unable to load analysis data. ${error.message}. Open this page through a local HTTP server and ensure data/study.json is accessible.`;
    $("#dataset-note").textContent = "Data loading failed";
    $("#case-select").innerHTML = "<option>Data unavailable</option>";
    document.querySelectorAll("[data-scenario]").forEach((button) => {
      button.disabled = true;
    });
  }
}

function recentIds() {
  try {
    const ids = JSON.parse(localStorage.getItem("htl-en-recent-cases") || "[]");
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function rememberCase(id) {
  try {
    localStorage.setItem(
      "htl-en-recent-cases",
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
  const basisLabel = `${format(basis.wet_feed_kg, 0)} kg wet feed / ${format(basis.duration_s / 3600, 0)} h`;
  $("#home-conditions").textContent = new Set(
    cases.map((item) => item.condition_id),
  ).size;
  $("#home-scenarios").textContent = cases.length;
  $("#home-basis").textContent = basisLabel;
  $("#home-current-condition").textContent = current.condition_id;
  $("#home-current-scenario").textContent =
    current.scenario === "HR" ? "HR · Heat recovery" : "STD · Standard heating";
  $("#home-current-meta").textContent =
    `${conditionLabel(current)} · ${format(current.inputs.pressure_pa / 1e6, 1)} MPa`;

  const kpis = [
    ["Equivalent Electricity", scaled(current.outputs.electricity_j, 1 / 3.6e6), "kWh", basisLabel],
    ["Product Carbon Footprint", current.lca.cf_kg_co2e_per_kg_target, "kg CO₂-eq/kg", "Normalized to 1 kg of target monomers in the outlet"],
    ["Outlet Target Monomers", current.outputs.target_monomer_kg, "kg", `Char proxy ${format(current.outputs.char_proxy_kg, 4)} kg`],
  ];
  $("#home-kpis").innerHTML = kpis.map(([label, value, unit, note], index) =>
    `<article class="overview-kpi overview-kpi-${index + 1}"><div class="overview-kpi-label">${escapeText(label)}<span>${escapeText(current.scenario)}</span></div><div class="overview-kpi-value">${format(value, 3)}<span class="overview-kpi-unit">${escapeText(unit)}</span></div><p class="overview-kpi-note">${escapeText(note)}</p></article>`,
  ).join("");

  const temperatures = [...new Set(cases.map(nominalTemperature))].sort((a, b) => a - b);
  const lengths = [...new Set(cases.map((item) => item.inputs.length_m))].sort((a, b) => a - b);
  const cfValues = cases.map((item) => item.lca.cf_kg_co2e_per_kg_target).filter(number);
  const minCF = Math.min(...cfValues);
  const maxCF = Math.max(...cfValues);
  $("#home-matrix-head").innerHTML = `<tr><th scope="col">Temperature / length</th>${lengths.map((length) => `<th scope="col">${format(length, 0)} m</th>`).join("")}</tr>`;
  $("#home-matrix-body").innerHTML = temperatures.map((temperature) =>
    `<tr><th scope="row">${format(temperature, 0)} °C</th>${lengths.map((length) => {
      const item = cases.find((row) =>
        row.scenario === state.scenario && nominalTemperature(row) === temperature && row.inputs.length_m === length,
      );
      if (!item) return '<td><span class="overview-cell-empty">—</span></td>';
      const cf = item.lca.cf_kg_co2e_per_kg_target;
      const selected = item.id === current.id;
      const tone = number(cf) ? (cf - minCF) / (maxCF - minCF || 1) : 0;
      const description = `${item.condition_id}, ${item.scenario}, Carbon footprint ${format(cf, 3)} kg CO₂-eq/kg target monomers in the outlet`;
      return `<td><button type="button" class="overview-cell${selected ? " selected" : ""}" data-overview-case="${escapeText(item.id)}" style="--cell-tone:${tone.toFixed(4)}" aria-pressed="${selected}" aria-label="${escapeText(description)}" title="${escapeText(description)}"><span>${format(cf, 2)}</span><span class="overview-cell-check" aria-hidden="true">${selected ? "✓" : ""}</span></button></td>`;
    }).join("")}</tr>`,
  ).join("");
  $("#home-matrix-selection").textContent = `Selected ${current.condition_id} · ${current.scenario}`;
  $("#home-matrix-min").textContent = `Low ${format(minCF, 2)}`;
  $("#home-matrix-max").textContent = `${format(maxCF, 2)} High`;

  const paired = pair().filter(Boolean);
  function pairChart(title, unit, getter) {
    const max = Math.max(...paired.map(getter).filter(number), 0);
    return `<div class="overview-pair-chart-heading"><h3>${escapeText(title)}</h3><span>${escapeText(unit)}</span></div>${paired.map((item) => {
      const value = getter(item);
      const width = number(value) && max > 0 ? Math.max(0, value) / max * 100 : 0;
      return `<div class="overview-pair-row"><span>${item.scenario}</span><span class="overview-pair-track" aria-hidden="true"><i class="overview-pair-fill ${item.scenario.toLowerCase()}" style="width:${width}%"></i></span><strong>${format(value, 3)}</strong></div>`;
    }).join("")}<div class="overview-pair-axis" aria-hidden="true"><span>0</span><span>${format(max, 1)}</span></div>`;
  }
  $("#home-energy-bars").innerHTML = pairChart("Equivalent Electricity", "kWh", (item) => scaled(item.outputs.electricity_j, 1 / 3.6e6));
  $("#home-cf-bars").innerHTML = pairChart("Product Carbon Footprint", "kg CO₂-eq/kg", (item) => item.lca.cf_kg_co2e_per_kg_target);
  const [std, hr] = pair();
  if (std && hr) {
    const energyReduction = (1 - hr.outputs.electricity_j / std.outputs.electricity_j) * 100;
    const cfReduction = (1 - hr.lca.cf_kg_co2e_per_kg_target / std.lca.cf_kg_co2e_per_kg_target) * 100;
    $("#home-pair-summary").innerHTML = `HR versus STD: electricity ${energyReduction >= 0 ? "reduced by" : "increased by"} <strong>${format(Math.abs(energyReduction), 1)}%</strong>, carbon footprint ${cfReduction >= 0 ? "reduced by" : "increased by"} <strong>${format(Math.abs(cfReduction), 1)}%</strong>.`;
  } else {
    $("#home-pair-summary").textContent = "The current condition has no paired scenario.";
  }
  const recent = recentIds()
    .map((id) => cases.find((item) => item.id === id))
    .filter(Boolean);
  $("#recent-title").textContent = recent.length ? "Recently Viewed" : "Quick Access";
  const displayed = recent.length
    ? recent
    : cases.filter((item) => item.scenario === "STD").slice(0, 3);
  $("#recent-cases").innerHTML = displayed
    .map(
      (item) =>
        `<tr><td>${conditionLabel(item)}</td><td><span class="pill">${item.scenario}</span></td><td>✓ Imported</td><td><button class="table-action" data-open-case="${escapeText(item.id)}">Open →</button></td></tr>`,
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
    `<p>Compared with STD, HR equivalent electricity is ${energyChange >= 0 ? "reduced by" : "increased by"} <strong>${format(Math.abs(energyChange), 1)}%</strong>, carbon footprint ${carbonChange >= 0 ? "reduced by" : "increased by"} <strong>${format(Math.abs(carbonChange), 1)}%</strong>.</p><p>Basis: 100 kg wet feed / 1 h; HR uses the paired STD product results.</p>`;
  const names = {
    process: "Process & Products",
    energy: "Equipment Energy",
    inventory: "Paired Life Cycle Inventory",
    monte_carlo: "Monte Carlo Statistics",
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
      name: "Feed Boundary",
      tag: "FEED",
      rows: [
        ["Wet-feed flow", `${format(input.feed_kg_s * 3600, 1)} kg/h`],
        ["Accounting period", "1 h"],
        ["Total wet feed", "100 kg"],
      ],
      note: "The 3D feed vessel illustrates the system boundary; its dimensions are schematic.",
    },
    pump: {
      name: "High-pressure Pump",
      tag: "PUMP",
      rows: [
        ["Outlet pressure setting", `${format(input.pressure_pa / 1e6, 1)} MPa`],
        ["Model shaft power", kw(out.pump_w)],
        ["LCA inventory pump electricity", `${format(out.pump_inventory_j / 3.6e6, 3)} kWh`],
      ],
      note: "Model power and inventory electricity retain their original precision.",
    },
    exchanger: {
      name: "Heat Exchanger",
      tag: "HEAT RECOVERY",
      rows: [
        ["Current scenario", item.scenario === "HR" ? "Heat recovery enabled" : "Standard heating · Bypass"],
        ["HR heater duty", kw(pair()[1]?.outputs.heater_w)],
        ["STD heater duty", kw(pair()[0]?.outputs.heater_w)],
      ],
      note: "The dashed line indicates heat recovery between outlet and inlet streams. Independent exchanger duty has not been imported.",
    },
    heater: {
      name: "Electric Heater",
      tag: "HEATER",
      rows: [
        ["Thermal duty", kw(out.heater_w)],
        ["Actual model temperature", `${format(input.temperature_k - 273.15)} °C`],
        [
          "Heating scenario",
          item.scenario === "HR" ? "Supplementary heating after heat recovery" : "Standard electric heating",
        ],
      ],
      note: "Equipment duty comes from the archived energy data for this scenario.",
    },
    reactor: {
      name: "Tubular Reactor",
      tag: "REACTOR",
      rows: [
        ["Actual model temperature", `${format(input.temperature_k - 273.15)} °C`],
        ["Reactor length", `${format(input.length_m, 0)} m`],
        ["Reaction pressure", `${format(input.pressure_pa / 1e6, 1)} MPa`],
        ["Holding duty", kw(out.reactor_w)],
      ],
      note: "The serpentine tube is schematic. HR product results use the paired STD reactor outlet.",
    },
    cooler: {
      name: "Cooler",
      tag: "COOLER",
      rows: [
        ["Thermal duty", kw(out.cooler_w)],
        ["Sign convention", "Negative values denote heat removal"],
        ["Scenario", item.scenario],
      ],
      note: "Original duty signs are retained; cooling demand is recorded separately.",
    },
    separator: {
      name: "Phase Separator",
      tag: "SEPARATOR",
      rows: [
        ["Thermal duty", kw(out.separator_w)],
        ["Target monomers at reactor outlet", `${format(out.target_monomer_kg, 3)} kg`],
      ],
      note: "Monomer metrics refer to target compounds in the reactor outlet, not isolated-product purity or recovery.",
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
    ["Equivalent Electricity", out.electricity_j / 3.6e6, "kWh"],
    ["Outlet Target Monomers", out.target_monomer_kg, "kg"],
    ["Product Carbon Footprint", item.lca.cf_kg_co2e_per_kg_target, "kg CO₂-eq/kg"],
  ]
    .map(
      ([name, value, unit]) =>
        `<div><small>${name}</small><strong>${format(value)}</strong><span>${unit}</span></div>`,
    )
    .join("");
  $("#plant-case-id").textContent = item.id;
  $("#plant-status-source").textContent =
    `Source · Energy table row ${item.provenance.rows.energy}`;
  window.htlPlant.setScenario(item.scenario);
  window.htlPlant.select(state.equipment);
}

function selectEquipment(id) {
  if (!state.data) return;
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

function setResultTab(tab) {
  document.querySelectorAll("[data-result-tab]").forEach((button) => {
    const active = button.dataset.resultTab === tab;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    $("#result-" + button.dataset.resultTab).hidden = !active;
  });
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
      title: "Energy Inventory",
      rows: [
        ["Heater", `${format(out.heater_w / 1000, 3)} kW`],
        ["Reactor holding duty", `${format(out.reactor_w / 1000, 3)} kW`],
        ["LCA pump electricity", `${format(out.pump_inventory_j / 3.6e6, 3)} kWh`],
        ["Equivalent Electricity", `${format(out.electricity_j / 3.6e6, 3)} kWh`],
      ],
      note: "Accounting basis: 1 h / 100 kg wet feed. Cooling and flash duties are recorded separately.",
    },
    carbon: {
      title: "Carbon Footprint Accounting",
      rows: [
        ["GWP for 100 kg wet feed", `${format(item.lca.gwp_kg_co2e, 3)} kg CO₂-eq`],
        [
          "LCA reference monomer mass",
          `${format(item.lca.reference_target_kg, 6)} kg`,
        ],
        [
          "Deterministic CF",
          `${format(item.lca.cf_kg_co2e_per_kg_target, 3)} kg CO₂-eq/kg`,
        ],
        [
          "MC 95% percentile interval",
          item.lca.ci95_kg_co2e_per_kg_target
            .map((value) => format(value, 3))
            .join(" – "),
        ],
      ],
      note: "CF = GWP / LCA reference monomer mass. Intervals come from Monte Carlo sampling of the background inventory.",
    },
    condition: {
      title: conditionLabel(item) + " · " + item.scenario,
      rows: [
        ["Case ID", item.id],
        ["Actual temperature", `${item.inputs.temperature_k} K`],
        ["Feed flow", `${format(item.inputs.feed_kg_s * 3600)} kg/h`],
        ["Residence time", `${format(out.residence_time_s / 3600, 4)} h`],
        ["Target monomers", `${format(out.target_monomer_kg, 6)} kg`],
        ["Char proxy", `${format(out.char_proxy_kg, 6)} kg`],
      ],
      note: 'Archived manuscript calculations. HR product results use the corresponding STD reactor outlet.',
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
