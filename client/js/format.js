// ---------- helpers: formatting and display text ----------

export function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch (e) { return iso; }
}
export function esc(s) {
  return (s == null ? "" : String(s)).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
export function num(v) { v = (v || "").toString().trim(); return v === "" ? null : Number(v); }

// One entry per test (or process step) the lab can record.
//   label: full name; chip: short enough for a board card; unit: of the
//   graded value; value: key of the graded value in a result's values;
//   min/max: keys of the acceptance limits in a formulation's specs;
//   valueLabel: label of the graded value's field; second: an optional
//   extra field recorded with it (number, text or select); defaultOn:
//   ticked by default on Add Formulation.
export var TEST_META = {
  tensile: { label: "Tensile strength", chip: "Tensile", unit: "MPa", value: "tensileStrength", min: "tensileMin", max: "tensileMax", valueLabel: "Tensile strength",
    second: { key: "elongation", label: "Elongation (%)", type: "number", summary: function (x) { return x + "% elongation"; } }, defaultOn: true },
  hardness: { label: "Hardness", chip: "Hardness", unit: "", value: "hardnessValue", min: "hardnessMin", max: "hardnessMax", valueLabel: "Hardness value",
    scaleSpec: "hardnessScale", second: { key: "scale", label: "Scale", type: "select", options: ["Shore A", "Shore D", "IRHD"] }, defaultOn: true },
  specific_gravity: { label: "Specific gravity", chip: "Sp. gravity", unit: "", value: "sgValue", min: "sgMin", max: "sgMax", valueLabel: "Specific gravity",
    second: { key: "method", label: "Method", type: "text", summary: function (x) { return "(" + x + ")"; } } },
  rheo_ts2: { label: "Rheometer TS2 (scorch)", chip: "TS2", unit: "min", value: "ts2", min: "ts2Min", max: "ts2Max", valueLabel: "TS2",
    second: { key: "temperature", label: "Test temperature (°C)", type: "number", summary: function (x) { return "at " + x + " °C"; } } },
  rheo_tc90: { label: "Rheometer TC90 (cure)", chip: "TC90", unit: "min", value: "tc90", min: "tc90Min", max: "tc90Max", valueLabel: "TC90",
    second: { key: "temperature", label: "Test temperature (°C)", type: "number", summary: function (x) { return "at " + x + " °C"; } } },
  mooney: { label: "Mooney viscosity", chip: "Mooney", unit: "MU", value: "mooneyValue", min: "mooneyMin", max: "mooneyMax", valueLabel: "Mooney viscosity",
    second: { key: "condition", label: "Condition (e.g. ML(1+4) 100 °C)", type: "text", summary: function (x) { return "(" + x + ")"; } } },
  ash: { label: "Ash content", chip: "Ash", unit: "%", value: "ashValue", min: "ashMin", max: "ashMax", valueLabel: "Ash content" },
  acetone: { label: "Acetone extraction", chip: "Acetone", unit: "%", value: "acetoneValue", min: "acetoneMin", max: "acetoneMax", valueLabel: "Acetone extract" },
  carbon_black: { label: "Carbon black content", chip: "Carbon black", unit: "%", value: "cbValue", min: "cbMin", max: "cbMax", valueLabel: "Carbon black" },
  mixing: { label: "Mixing", chip: "Mixing", unit: "°C", value: "dumpTemp", min: "mixingMin", max: "mixingMax", valueLabel: "Dump temperature",
    second: { key: "mixTime", label: "Mixing time (min)", type: "number", summary: function (x) { return x + " min mixing"; } } },
  moulding: { label: "Moulding", chip: "Moulding", unit: "°C", value: "cureTemp", min: "mouldingMin", max: "mouldingMax", valueLabel: "Cure temperature",
    second: { key: "cureTime", label: "Cure time (min)", type: "number", summary: function (x) { return x + " min cure"; } } }
};
export var TEST_TYPES = Object.keys(TEST_META);

export var ROLE_LABEL = { company: "Hi‑Tech Company", lab: "Manna Lab" };

// "10–20 MPa", or "≥ 10 MPa" / "≤ 20 MPa" when only one limit was given.
function limitText(min, max, unit) {
  if (min == null && max == null) return "No spec";
  var u = unit ? " " + unit : "";
  if (min != null && max != null) return min + "–" + max + u;
  return (min != null ? "≥ " + min : "≤ " + max) + u;
}

export function specText(specs, type) {
  var m = TEST_META[type];
  if (!specs || !m) return "No spec";
  var unit = m.scaleSpec ? (specs[m.scaleSpec] || "") : m.unit;
  return limitText(specs[m.min], specs[m.max], unit);
}

export function valueSummary(r) {
  var m = TEST_META[r.testType];
  if (!m) return "";
  var v = r.values || {};
  var s = String(v[m.value]) + (m.unit ? " " + m.unit : "");
  if (m.second && v[m.second.key] != null && v[m.second.key] !== "") {
    var x = v[m.second.key];
    s += m.second.summary ? " · " + m.second.summary(x) : " " + x;
  }
  return s;
}

export function badge(result) {
  if (result === "pass") return '<span class="badge pass">Pass</span>';
  if (result === "fail") return '<span class="badge fail">Fail</span>';
  if (result === "recorded") return '<span class="badge rec">Recorded</span>';
  return '<span class="badge rec">—</span>';
}

export var OUTCOME_TEXT = {
  pass: "Every requested test is within the acceptance limits.",
  fail: "One or more tests are outside the acceptance limits.",
  recorded: "No test failed; at least one had no acceptance limits, so it is recorded only."
};

// Board column order. "review" = every test recorded, lab checking before release.
export var STATUSES = ["submitted", "in_testing", "on_hold", "review", "released"];
export var STATUS_LABEL = { submitted: "Submitted", in_testing: "In testing", on_hold: "On hold", review: "Lab review", released: "Results sent" };

export function reportUrl(f) { return "report.html?id=" + encodeURIComponent(f.id); }
export function testUrl(f) { return "test.html?id=" + encodeURIComponent(f.id); }

// The row of summary numbers at the top of the board and the history page.
export function tilesHtml(tiles) {
  return tiles.map(function (t) {
    return '<div class="tile"><div class="label">' + esc(t.label) + '</div><div class="value mono">' + esc(t.value) + '</div><div class="sub">' + esc(t.sub) + "</div></div>";
  }).join("");
}

export function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
}
