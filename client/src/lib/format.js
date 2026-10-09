// Formatting and display text shared by the pages, and the definitions of
// the tests and of the reactor recipe.

export function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch (e) { return iso; }
}

// A form field's text as a number, or null when it's empty.
export function num(v) { v = (v || "").toString().trim(); return v === "" ? null : Number(v); }

// One entry per test (or process step) the lab can record. Keep the keys
// in step with tracker_private.tests() in the database migration.
//   label: full name; chip: short enough for a board card; unit: of the
//   graded value; value: key of the graded value in a result's values;
//   min/max: keys of the acceptance limits in a formulation's specs;
//   valueLabel: label of the graded value's field; second: an optional
//   extra field recorded with it (number, text or select); defaultOn:
//   ticked by default on Add Formulation; legacy: no longer offered for
//   new formulations, kept so older ones still show and can be finished.
export var TEST_META = {
  rheo_tc90: { label: "Cure time (TC90)", chip: "Cure", unit: "min", value: "tc90", min: "tc90Min", max: "tc90Max", valueLabel: "Cure time",
    second: { key: "temperature", label: "Test temperature (°C)", type: "number", summary: function (x) { return "at " + x + " °C"; } }, defaultOn: true },
  rheo_ts2: { label: "Scorch time (TS2)", chip: "Scorch", unit: "min", value: "ts2", min: "ts2Min", max: "ts2Max", valueLabel: "Scorch time",
    second: { key: "temperature", label: "Test temperature (°C)", type: "number", summary: function (x) { return "at " + x + " °C"; } }, defaultOn: true },
  specific_gravity: { label: "Specific gravity after moulding", chip: "SG", unit: "", value: "sgValue", min: "sgMin", max: "sgMax", valueLabel: "Specific gravity",
    second: { key: "method", label: "Method", type: "text", summary: function (x) { return "(" + x + ")"; } }, defaultOn: true },
  hardness: { label: "Hardness", chip: "Hardness", unit: "", value: "hardnessValue", min: "hardnessMin", max: "hardnessMax", valueLabel: "Hardness value",
    scaleSpec: "hardnessScale", second: { key: "scale", label: "Scale", type: "select", options: ["Shore A", "Shore D", "IRHD"] }, defaultOn: true },
  tensile: { label: "Tensile strength", chip: "Tensile", unit: "MPa", value: "tensileStrength", min: "tensileMin", max: "tensileMax", valueLabel: "Tensile strength", defaultOn: true },
  elongation: { label: "Elongation at break", chip: "Elongation", unit: "%", value: "elongationValue", min: "elongationMin", max: "elongationMax", valueLabel: "Elongation", defaultOn: true },
  mooney: { legacy: true, label: "Mooney viscosity", chip: "Mooney", unit: "MU", value: "mooneyValue", min: "mooneyMin", max: "mooneyMax", valueLabel: "Mooney viscosity",
    second: { key: "condition", label: "Condition (e.g. ML(1+4) 100 °C)", type: "text", summary: function (x) { return "(" + x + ")"; } } },
  ash: { legacy: true, label: "Ash content", chip: "Ash", unit: "%", value: "ashValue", min: "ashMin", max: "ashMax", valueLabel: "Ash content" },
  acetone: { legacy: true, label: "Acetone extraction", chip: "Acetone", unit: "%", value: "acetoneValue", min: "acetoneMin", max: "acetoneMax", valueLabel: "Acetone extract" },
  carbon_black: { legacy: true, label: "Carbon black content", chip: "Carbon black", unit: "%", value: "cbValue", min: "cbMin", max: "cbMax", valueLabel: "Carbon black" },
  mixing: { legacy: true, label: "Mixing", chip: "Mixing", unit: "°C", value: "dumpTemp", min: "mixingMin", max: "mixingMax", valueLabel: "Dump temperature",
    second: { key: "mixTime", label: "Mixing time (min)", type: "number", summary: function (x) { return x + " min mixing"; } } },
  moulding: { legacy: true, label: "Moulding", chip: "Moulding", unit: "°C", value: "cureTemp", min: "mouldingMin", max: "mouldingMax", valueLabel: "Cure temperature",
    second: { key: "cureTime", label: "Cure time (min)", type: "number", summary: function (x) { return x + " min cure"; } } }
};
// The tests Hi-Tech Company can choose for a new formulation.
export var TEST_TYPES = Object.keys(TEST_META).filter(function (t) { return !TEST_META[t].legacy; });

// The reactor recipe Hi-Tech Company sends with a formulation: raw
// materials as a share of the charge, and the reactor conditions.
export var MATERIAL_DEFAULTS = ["Crumb", "RA 480", "Process Oil", "Pine Tar", "Water"];
export var REACTOR_FIELDS = [
  { key: "temperature", label: "Temperature", unit: "°C" },
  { key: "cookingTime", label: "Cooking time", unit: "min" },
  { key: "pressure", label: "Pressure", unit: "kg/cm²" },
  { key: "airReleaseTime", label: "Air releasing time", unit: "min" }
];

export function materialsTotal(materials) {
  // Rounded so 0.1 + 0.2 shows as 0.3.
  return Math.round((materials || []).reduce(function (s, m) { return s + (m.percent || 0); }, 0) * 1000) / 1000;
}

export function hasReactor(f) {
  return REACTOR_FIELDS.some(function (r) { return f.reactor && f.reactor[r.key] != null; });
}

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

export var OUTCOME_TEXT = {
  pass: "Every requested test is within the acceptance limits.",
  fail: "One or more tests are outside the acceptance limits.",
  recorded: "No test failed; at least one had no acceptance limits, so it is recorded only."
};

// Board column order. "review" = every test recorded, lab checking before release.
export var STATUSES = ["submitted", "in_testing", "on_hold", "review", "released"];
export var STATUS_LABEL = { submitted: "Submitted", in_testing: "In testing", on_hold: "On hold", review: "Lab review", released: "Results sent" };

export function reportPath(f) { return "/report/" + encodeURIComponent(f.id); }
export function testPath(f) { return "/test/" + encodeURIComponent(f.id); }

export function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
}
