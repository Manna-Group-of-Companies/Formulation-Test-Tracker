// ---------- Test Result History page ----------
//
// Every formulation Hi-Tech Company has sent, newest first, each with its
// full record: what was sent and when, every requested test with the
// measured value, the spec it was judged against and whether it passed or
// failed, the overall outcome, the lab's remarks and the test report.
// Hi-Tech Company sees values and grades once the lab releases them (the
// server holds them back until then); before that a test shows as tested or
// pending. The lab sees every result as soon as it is recorded, with a link
// to conduct the tests still open. The page refreshes itself on any change.

import { fetchAll } from "./api.js";
import { state, resultsForFormulation } from "./state.js";
import { connectEvents } from "./live.js";
import { toast } from "./toast.js";
import { startPage } from "./page.js";
import { esc, fmtDate, badge, specText, valueSummary, testUrl, tilesHtml, TEST_META, STATUS_LABEL, daysBetween } from "./format.js";

var search = document.getElementById("h-search");
var outcomeSel = document.getElementById("h-outcome");
var testSel = document.getElementById("h-test");
Object.keys(TEST_META).forEach(function (t) {
  var o = document.createElement("option");
  o.value = t; o.textContent = TEST_META[t].label;
  testSel.appendChild(o);
});

function isReleased(f) { return f.status === "released"; }
function isLab() { return !!state.user && state.user.role === "lab"; }

// The outcome filter's value for a formulation: its overall result once
// released, otherwise "awaiting".
function outcomeKey(f) { return isReleased(f) ? f.outcome : "awaiting"; }

function renderTiles() {
  var all = state.formulations;
  var released = all.filter(isReleased);
  var count = function (o) { return released.filter(function (f) { return f.outcome === o; }).length; };
  var lab = isLab();
  document.getElementById("h-tiles").innerHTML = tilesHtml([
    lab ? { label: "Formulations received", value: all.length, sub: "from Hi‑Tech Company" }
        : { label: "Formulations sent", value: all.length, sub: "to the Manna lab" },
    lab ? { label: "Results released", value: released.length, sub: "test reports sent back" }
        : { label: "Results received", value: released.length, sub: "test reports released" },
    { label: "All tests passed", value: count("pass"), sub: lab ? "of the results released" : "of the results received" },
    { label: "One or more failed", value: count("fail"), sub: lab ? "of the results released" : "of the results received" },
    lab ? { label: "Not released yet", value: all.length - released.length, sub: "still in the lab" }
        : { label: "Awaiting results", value: all.length - released.length, sub: "still with the lab" }
  ]);
}

function kv(label, value) {
  return '<div><span class="k">' + label + "</span><span>" + value + "</span></div>";
}

// One table cell. The class and label let narrow screens stack the cells
// as labelled blocks instead of a wide table (see .history-table in the CSS).
function cell(cls, label, html) {
  return '<td class="' + cls + '" data-label="' + label + '">' + html + "</td>";
}

function testRow(f, type, rs) {
  var r = rs.find(function (x) { return x.testType === type; });
  var test = cell("c-test", "Test", "<b>" + TEST_META[type].label + "</b>");
  var spec = cell("c-spec", "Specification", esc(specText(f.specs, type)));
  if (!r) {
    var tested = (f.testsDone || []).indexOf(type) >= 0;
    return '<tr class="pending-row">' + test + cell("c-specimen", "Specimen / lot", "—") + cell("c-measured", "Measured", "—") + spec +
      cell("c-result", "Result", '<span class="status-pill">' + (tested ? "Tested · awaiting release" : "Not tested yet") + "</span>") +
      cell("c-tested", "Tested", "—") + cell("c-notes", "Notes", "") + "</tr>";
  }
  return "<tr>" + test + cell("c-specimen mono", "Specimen / lot", esc(r.specimenId || "—")) + cell("c-measured", "Measured", esc(valueSummary(r))) + spec +
    cell("c-result", "Result", badge(r.result)) +
    cell("c-tested", "Tested", esc(fmtDate(r.testedAt)) + '<span class="note">' + esc(r.testedByName || "") + "</span>") +
    cell("c-notes", "Notes", esc(r.notes || "")) + "</tr>";
}

function historyCard(f, testFilter) {
  var released = isReleased(f);
  var rs = resultsForFormulation(f.id);
  var days = daysBetween(f.submittedAt, f.releasedAt);
  var tests = (f.requestedTests || []).filter(function (t) { return !testFilter || t === testFilter; });

  var status = released
    ? '<div class="overall"><span class="k">Overall</span>' + badge(f.outcome) + "</div>"
    : '<span class="status-pill ' + esc(f.status) + '">' + esc(STATUS_LABEL[f.status] || f.status) + "</span>";

  var html = '<article class="card hcard" data-id="' + esc(f.id) + '">' +
    '<div class="hcard-head"><div><div class="hcard-title">' + esc(f.name) + ' <span class="hint mono">' + esc(f.code) + "</span>" +
    (f.priority === "urgent" ? ' <span class="urgent-flag">Urgent</span>' : "") + "</div>" +
    (f.description ? '<div class="spec-line">' + esc(f.description) + "</div>" : "") + "</div>" + status + "</div>";

  html += '<div class="hcard-meta">' +
    kv("Report no.", f.reportNo ? '<span class="mono">' + esc(f.reportNo) + "</span>" + (f.revision > 1 ? " · Rev " + f.revision : "") : "—") +
    kv("Sent in", esc(fmtDate(f.submittedAt)) + '<span class="note">by ' + esc(f.submittedByName || "Unknown") + "</span>") +
    kv("Results released", released ? esc(fmtDate(f.releasedAt)) + '<span class="note">by ' + esc(f.releasedByName || "Unknown") + "</span>" : "—") +
    kv("Turnaround", released && days != null ? days + (days === 1 ? " day" : " days") : "—") +
    "</div>";

  if (f.status === "on_hold" && f.holdReason) html += '<div class="hold-banner"><b>On hold:</b> ' + esc(f.holdReason) + "</div>";

  html += '<div class="table-scroll"><table class="history-table"><thead><tr><th>Test</th><th>Specimen / lot</th><th>Measured</th><th>Specification</th><th>Result</th><th>Tested</th><th>Notes</th></tr></thead><tbody>' +
    tests.map(function (t) { return testRow(f, t, rs); }).join("") + "</tbody></table></div>";

  if (released && f.labRemarks) html += '<div class="remarks"><span class="k">Lab remarks</span><span class="remarks-text">' + esc(f.labRemarks) + "</span></div>";
  if (released) html += '<div class="action-row"><a class="btn small" href="report.html?id=' + encodeURIComponent(f.id) + '" target="_blank" rel="noopener">Open test report</a></div>';
  else if (isLab()) html += '<div class="action-row"><a class="btn primary small" href="' + testUrl(f) + '">' + (f.status === "review" ? "Review &amp; release" : "Conduct test") + " →</a></div>";

  return html + "</article>";
}

function render() {
  renderTiles();
  var q = search.value.trim().toLowerCase();
  var oc = outcomeSel.value, test = testSel.value;
  var all = state.formulations.slice().sort(function (a, b) { return new Date(b.submittedAt) - new Date(a.submittedAt); });
  var shown = all.filter(function (f) {
    if (oc && outcomeKey(f) !== oc) return false;
    if (test && (f.requestedTests || []).indexOf(test) < 0) return false;
    if (q && ![f.name, f.code, f.reportNo, f.description].some(function (s) { return s && s.toLowerCase().indexOf(q) >= 0; })) return false;
    return true;
  });

  document.getElementById("h-count").textContent = "Showing " + shown.length + " of " + all.length + (all.length === 1 ? " formulation" : " formulations");
  document.getElementById("h-list").innerHTML = shown.map(function (f) { return historyCard(f, test); }).join("");
  document.getElementById("h-empty").hidden = shown.length > 0;
  document.getElementById("h-empty-text").innerHTML = all.length
    ? "<div>No formulations match these filters.</div>"
    : '<div class="big">Nothing sent yet</div><div>Formulations you send appear here with their test results. <a href="add.html">Add a formulation</a></div>';
}

function loadAll() { return fetchAll().then(render); }

[search, outcomeSel, testSel].forEach(function (el) { el.addEventListener("input", render); });

startPage("history.html").then(function (user) {
  if (user.role === "lab") {
    document.querySelector(".page-head p").textContent = "Every formulation Hi‑Tech Company has sent, with each test result the lab has recorded. Results show here as soon as they're saved; Hi‑Tech Company sees them once you release them.";
    outcomeSel.querySelector('option[value="awaiting"]').textContent = "Not released yet";
  }
  return loadAll().then(function () { connectEvents(loadAll); });
}).catch(function () {
  toast("Could not reach the server — is it running?");
});
