// ---------- Add Formulation page (Hi-Tech Company) ----------
//
// What Hi-Tech Company fills in to send a formulation to the Manna lab: what
// it is, which tests to run, and optional acceptance limits for each test.
// The lab's results are graded pass/fail against those limits.

import { api } from "./api.js";
import { esc, num, TEST_META, TEST_TYPES } from "./format.js";
import { toast } from "./toast.js";
import { startPage } from "./page.js";

var form = document.getElementById("add-form");
var done = document.getElementById("add-done");
var error = document.getElementById("af-error");

function val(id) { return document.getElementById(id).value.trim(); }
function ticked(id) { return document.getElementById(id).checked; }

// Limits only apply to the tests that are ticked.
function syncTestOptions() {
  form.querySelectorAll(".test-option").forEach(function (opt) {
    var on = opt.querySelector("input[type=checkbox]").checked;
    opt.classList.toggle("off", !on);
    opt.querySelectorAll(".limits input, .limits select").forEach(function (el) { el.disabled = !on; });
  });
}

// One block per test in TEST_META: a tick box, then min/max limit fields
// (plus the hardness scale). Field ids are af-<type>-min, af-<type>-max.
function testOptionsHtml() {
  return TEST_TYPES.map(function (type) {
    var m = TEST_META[type], u = m.unit ? " (" + m.unit + ")" : "";
    var scale = m.scaleSpec ? '<div class="field"><label for="af-' + type + '-scale">Scale</label><select id="af-' + type + '-scale"><option value="">—</option>' +
      m.second.options.map(function (o) { return "<option>" + esc(o) + "</option>"; }).join("") + "</select></div>" : "";
    return '<div class="test-option"><label class="check-item"><input type="checkbox" id="af-t-' + type + '"' + (m.defaultOn ? " checked" : "") + "> " + esc(m.label) + "</label>" +
      '<div class="' + (scale ? "grid3" : "grid2") + ' limits">' + scale +
      '<div class="field"><label for="af-' + type + '-min">Minimum' + esc(u) + '</label><input id="af-' + type + '-min" type="number" step="any"></div>' +
      '<div class="field"><label for="af-' + type + '-max">Maximum' + esc(u) + '</label><input id="af-' + type + '-max" type="number" step="any"></div></div></div>';
  }).join("");
}
document.getElementById("af-tests").innerHTML = testOptionsHtml();

function readForm() {
  var tests = [], specs = {};
  TEST_TYPES.forEach(function (type) {
    if (!ticked("af-t-" + type)) return;
    var m = TEST_META[type];
    tests.push(type);
    specs[m.min] = num(val("af-" + type + "-min"));
    specs[m.max] = num(val("af-" + type + "-max"));
    if (m.scaleSpec) specs[m.scaleSpec] = val("af-" + type + "-scale") || null;
  });
  return {
    name: val("af-name"),
    code: val("af-code"),
    description: val("af-desc"),
    priority: form.querySelector("input[name=af-priority]:checked").value,
    requestedTests: tests,
    specs: specs
  };
}

function limitsProblem(specs) {
  for (var i = 0; i < TEST_TYPES.length; i++) {
    var m = TEST_META[TEST_TYPES[i]];
    var min = specs[m.min], max = specs[m.max];
    if (min != null && max != null && min > max) return m.label + ": the minimum is higher than the maximum.";
  }
  return "";
}

form.querySelectorAll(".test-option input[type=checkbox]").forEach(function (cb) {
  cb.addEventListener("change", syncTestOptions);
});

form.addEventListener("submit", function (e) {
  e.preventDefault();
  var data = readForm();
  error.textContent = "";
  if (!data.requestedTests.length) { error.textContent = "Choose at least one test."; return; }
  var problem = limitsProblem(data.specs);
  if (problem) { error.textContent = problem; return; }

  var btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  api("/formulations", { method: "POST", body: JSON.stringify(data) }).then(function (f) {
    document.getElementById("done-text").innerHTML = "<b>" + esc(f.name) + '</b> <span class="mono">' + esc(f.code) + "</span> is in the lab's Submitted column. " +
      "Follow its progress on the board; the results appear under Test Result History once the lab releases them.";
    form.hidden = true;
    done.hidden = false;
    window.scrollTo(0, 0);
  }).catch(function (err) {
    error.textContent = err.message || "Could not send — try again";
  }).finally(function () { btn.disabled = false; });
});

document.getElementById("btn-add-another").addEventListener("click", function () {
  form.reset();
  syncTestOptions();
  done.hidden = true;
  form.hidden = false;
  document.getElementById("af-name").focus();
});

startPage("add.html").then(function (user) {
  if (user.role !== "company") { document.getElementById("not-company").hidden = false; return; }
  form.hidden = false;
  syncTestOptions();
  document.getElementById("af-name").focus();
}).catch(function () {
  toast("Could not reach the server — is it running?");
});
