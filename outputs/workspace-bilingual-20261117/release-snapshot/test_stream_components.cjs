/* Verify component rendering without a browser or external packages. */
const assert = require("node:assert/strict");
const {renderStreamComponents} = require("./web/stream_components.js");
const html = renderStreamComponents({"S<1>": {
  component_ids:["ZERO", "TRACE", "MISSING", "<script>"],
  composition_kg_h:{ZERO:0, TRACE:1e-14, MISSING:null, "<script>":2},
  composition_kmol_h:{ZERO:0, TRACE:3e-16},
  substreams:{CISOLID:{component_ids:["CARBON"], composition_kg_h:{CARBON:2}}}
}, QEN:{component_data_status:"no_component_output"}});
assert(html.includes("S&lt;1&gt;"));
assert(html.includes("ZERO</td><td>0</td>"));
assert(html.includes("TRACE</td><td>1e-14</td>"));
assert(html.includes("MISSING</td><td>—</td>"));
assert(html.includes("&lt;script&gt;"));
assert(!html.includes("<script>"));
assert(html.includes("子物流 CISOLID"));
assert(html.includes("QEN：无组分输出"));
assert.equal(renderStreamComponents({}), "");
console.log("PASS: all components, zero/trace/missing, substreams and HTML escaping");
