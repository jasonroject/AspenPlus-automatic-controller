"use strict";
const q = (s) => document.querySelector(s);
const format = (v, n = 2) => Number.isFinite(v) ? v.toLocaleString("en-US", {maximumFractionDigits:n, minimumFractionDigits:n}) : "—";
const escapeHTML = (s) => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let analysis, grid;
const labels = {target_kg_h:"Target monomer mass",STD_electricity_kWh:"STD electricity",HR_electricity_kWh:"HR electricity",CF_STD:"STD carbon footprint",CF_HR:"HR carbon footprint"};
const key = (t,l) => `${Number(t).toFixed(2)}:${Number(l).toFixed(2)}`;
function card(label, value, unit, note) {
  return `<article class="overview-kpi"><div class="overview-kpi-label">${escapeHTML(label)}</div><div class="overview-kpi-value">${escapeHTML(value)}<span class="overview-kpi-unit">${escapeHTML(unit)}</span></div><p class="overview-kpi-note">${escapeHTML(note)}</p></article>`;
}
function showSection(name) {
  for (const button of document.querySelectorAll("[data-section]")) {
    const selected = button.dataset.section === name;
    button.setAttribute("aria-pressed", String(selected));
    q("#section-" + button.dataset.section).hidden = !selected;
  }
}
function selectedPoint() {
  if (!q("#prediction-form").reportValidity()) return null;
  const row = grid.get(key(q("#predict-temperature").value,q("#predict-length").value));
  q("#prediction-error").hidden = !!row;
  q("#prediction-error").textContent = row ? "" : "Choose a supported grid point within 310–350 °C and 5–20 m. No extrapolation is available.";
  return row;
}
function renderPrediction() {
  if (!analysis?.prediction_enabled) return;
  const row = selectedPoint();
  if (!row) { q("#prediction-result").innerHTML = ""; return; }
  const scenario = q("#predict-scenario").value;
  const condition = `${format(row.temperature_C,1)} °C / ${format(row.length_m,2)} m · ${scenario}`;
  q("#prediction-result").innerHTML = card("Equivalent electricity",format(row[scenario+"_electricity_kWh"],3),"kWh",condition)
    + card("Carbon footprint",format(row["CF_"+scenario],3),"kg CO₂-eq/kg", "Fixed-background climate calculation")
    + card("Outlet target monomers",format(row.target_kg_h,3),"kg / 100 kg feed", "Catechol + o-cresol; not isolated-product recovery");
}
function download(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
  const link = document.createElement("a"); link.href=url; link.download=name; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function renderRobustness() {
  if (!analysis?.robustness) { q("#robust-description").textContent="Robustness results are unavailable until validation passes."; return; }
  const r=analysis.robustness, scenario=q("#robust-scenario").value;
  q("#robust-description").textContent=`${r.samples.toLocaleString()} shared scenarios across ${r.candidate_count} candidates. ${r.candidate_scope}`;
  const rows=[...r.scenarios[scenario]];
  if(q("#robust-order").value==="nominal") rows.sort((a,b)=>a.nominal_rank-b.nominal_rank);
  const interval=(a,n=2)=>`${format(a[0],n)}–${format(a[2],n)}`;
  q("#robust-body").innerHTML=rows.slice(0,20).map(row=>`<tr><td>${format(row.temperature_C,0)} °C / ${format(row.length_m,0)} m</td><td>${row.nominal_rank}</td><td>${format(row.top1_fraction*100,1)}%<span class="frequency"><i style="width:${row.top1_fraction*100}%"></i></span></td><td>${format(row.top5_fraction*100,1)}%</td><td>${interval(row.rank_p05_p50_p95,0)}</td><td>${interval(row.intervals.target_kg_h,3)}</td><td>${interval(row.intervals[scenario+"_electricity_kWh"])}</td><td>${interval(row.intervals["CF_"+scenario])}</td><td><button class="table-action" data-inspect="${row.temperature_C},${row.length_m},${scenario}">Inspect →</button></td></tr>`).join("");
  const difference=Math.max(...rows.map(row=>Math.abs(row.first_half_top1-row.second_half_top1)))*100;
  q("#stability-note").textContent=`Sampling check: largest top-1 frequency difference between the first and second halves is ${format(difference,1)} percentage points. Frequencies depend on the stated scenario assumptions and equal weights; they are not probabilities of plant reliability.`;
}
q("#prediction-form").addEventListener("submit",e=>{e.preventDefault();renderPrediction();});
for(const input of document.querySelectorAll("#prediction-form input")) input.addEventListener("input",()=>{
  q("#prediction-result").innerHTML="";
  q("#prediction-error").hidden=false;
  q("#prediction-error").textContent="Inputs changed. Select Show prediction to refresh the results.";
});
q("#predict-scenario").addEventListener("change",renderPrediction);
for(const button of document.querySelectorAll("[data-section]")) button.addEventListener("click",()=>showSection(button.dataset.section));
q("#robust-scenario").addEventListener("change",renderRobustness);
q("#robust-order").addEventListener("change",renderRobustness);
q("#robust-body").addEventListener("click",e=>{
  const button=e.target.closest("[data-inspect]"); if(!button)return;
  const [t,l,s]=button.dataset.inspect.split(",");
  q("#predict-temperature").value=t;q("#predict-length").value=l;q("#predict-scenario").value=s;
  showSection("predict");renderPrediction();q("#prediction-form").scrollIntoView({block:"center"});
});
q("#download-analysis").addEventListener("click",()=>download("htl-pipeline-results.json",analysis));
q("#download-plan").addEventListener("click",()=>{
  const row=selectedPoint();if(!row)return;
  const t=row.temperature_C,l=row.length_m;
  const points=[{temperature_C:t,length_m:l},{temperature_C:t<=349?t+1:t-1,length_m:l},
                {temperature_C:t,length_m:l<=19.5?l+.5:l-.5}];
  download("htl-scan-plan.json",{version:1,model:"reference HTL HR model",units:{temperature_C:"actual degrees Celsius",length_m:"m"},points});
});
async function initialize() {
  try {
    const response=await fetch("data/pipeline.json");if(!response.ok)throw new Error(`HTTP ${response.status}`);
    analysis=await response.json();grid=new Map(analysis.grid.rows.map(r=>[key(r.temperature_C,r.length_m),r]));
    q("#pipeline-status").textContent=analysis.prediction_enabled?"Checked against Aspen simulations · Conditional climate accounting · Original archive preserved":"Validation is incomplete. Predictions are disabled; inspect the evidence below.";
    const fresh=analysis.fresh_runs.filter(r=>r.accepted).length;
    const hold=analysis.holdout_metrics.target_kg_h?.n||0;
    q("#evidence-stats").innerHTML=card("Archived native samples",String(analysis.native_reference_count),"conditions","Existing training, holdout and extremum evidence")+card("Fresh verification",`${fresh} / ${analysis.fresh_runs.length}`,"accepted","Not included in model fitting")+card("Reserved in-domain holdouts",String(hold),"conditions",`${grid.size.toLocaleString()} GP grid predictions`);
    q("#scan-body").innerHTML=analysis.fresh_runs.map(r=>`<tr><td>${format(r.temperature_C,2)}</td><td>${format(r.length_m,2)}</td><td>${r.accepted?"Numerical checks passed":escapeHTML(r.error||"Check failed")}${r.warnings.length?`<details><summary>Report warnings</summary>${r.warnings.map(escapeHTML).join("<br>")}</details>`:""}</td><td>${format(r.mass_residual_kg_h,6)}</td><td>${format(r.max_block_energy_residual_kW,6)}</td></tr>`).join("");
    q("#validation-description").textContent=`${hold} reserved points inside the displayed domain and ${fresh} fresh verification points. All were excluded from fitting.`;
    q("#validation-body").innerHTML=Object.entries(labels).map(([k,label])=>`<tr><td>${label}</td><td>${format(analysis.holdout_metrics[k]?.median_APE_pct,3)}%</td><td>${format(analysis.holdout_metrics[k]?.max_APE_pct,3)}%</td><td>${format(analysis.fresh_metrics[k]?.max_APE_pct,3)}%</td></tr>`).join("");
    q("#limitations").innerHTML=analysis.limitations.map(s=>`<li>${escapeHTML(s)}</li>`).join("");
    q("#failure-note").textContent=`${analysis.historical_failed_attempts.length} historical failed attempts are retained in the downloadable record, including retry status. Native model SHA-256: ${analysis.fresh_runs[0]?.source_sha256||"unavailable"}`;
    q("#predict-button").disabled=!analysis.prediction_enabled;q("#download-plan").disabled=!analysis.prediction_enabled;q("#download-analysis").disabled=false;
    renderPrediction();renderRobustness();if(!analysis.prediction_enabled)showSection("evidence");
  } catch(error) {
    q("#pipeline-error").hidden=false;q("#pipeline-error").textContent=`Analysis could not be loaded: ${error.message}`;
    q("#pipeline-status").textContent="No prediction is available. Reload after the analysis file is restored.";
  }
}
initialize();
