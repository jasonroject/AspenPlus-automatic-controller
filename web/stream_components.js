/* Shared renderer: all components stay visible, including zero and missing data. */
(function (root) {
  "use strict";
  const fields = ["composition_kg_h", "composition_kmol_h", "mass_fraction", "mole_fraction"];
  const escape = value => String(value).replace(/[&<>"']/g, char => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  })[char]);
  const value = number => number == null ? "—" : escape(number);
  function rows(data, ids) {
    return ids.map(id => `<tr><td>${escape(id)}</td>${fields.map(field =>
      `<td>${value(data[field]?.[id])}</td>`).join("")}</tr>`).join("");
  }
  function table(data, ids) {
    return `<table><thead><tr><th>组分</th><th>质量流量 (kg/h)</th><th>摩尔流量 (kmol/h)</th><th>质量分率</th><th>摩尔分率</th></tr></thead><tbody>${rows(data, ids)}</tbody></table>`;
  }
  function renderStreamComponents(streams) {
    return Object.entries(streams || {}).map(([name, data]) => {
      const ids = [...new Set([...(data.component_ids || []), ...fields.flatMap(field => Object.keys(data[field] || {}))])];
      if (!ids.length) return `<p>${escape(name)}：无组分输出。</p>`;
      const subs = Object.entries(data.substreams || {}).map(([subname, sub]) =>
        `<details class="raw-result"><summary>子物流 ${escape(subname)}</summary>${table(sub, sub.component_ids || [])}</details>`).join("");
      return `<details class="raw-result"><summary>${escape(name)} · ${ids.length} 个组分</summary><p>物流合计；0 为零含量，— 为未返回数据。</p>${table(data, ids)}${subs}</details>`;
    }).join("");
  }
  if (typeof module !== "undefined" && module.exports) module.exports = {renderStreamComponents};
  else root.renderStreamComponents = renderStreamComponents;
})(globalThis);
