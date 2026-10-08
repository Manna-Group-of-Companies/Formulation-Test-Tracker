// ---------- Test Queue page (Manna lab) ----------
//
// The lab assistants' work list: every formulation Hi-Tech Company has sent
// whose results haven't been released yet, grouped by what needs doing
// next, urgent ones first and then the longest waiting. Each entry shows
// what an assistant needs at the bench — the composition notes and each
// requested test with its limits and whether it's done — and opens the
// Conduct Test page (test.html). The list refreshes itself on any change.

import { fetchAll } from "./api.js";
import { state, resultsForFormulation } from "./state.js";
import { connectEvents } from "./live.js";
import { toast } from "./toast.js";
import { startPage } from "./page.js";
import { compositionHtml } from "./views/detail.js";
import { esc, fmtDate, badge, specText, testUrl, tilesHtml, TEST_META, daysBetween } from "./format.js";

var SECTIONS = [
  { status: "submitted", title: "To start", hint: "Sent by Hi‑Tech Company, not started yet" },
  { status: "in_testing", title: "In testing", hint: "Some tests recorded" },
  { status: "review", title: "Ready to release", hint: "Every test recorded — check, then send the results back" },
  { status: "on_hold", title: "On hold", hint: "Waiting on Hi‑Tech Company" }
];

var search = document.getElementById("q-search");
var stageSel = document.getElementById("q-status");
var urgentOnly = document.getElementById("q-urgent");

function isOpen(f) { return f.status !== "released"; }

// Urgent first, then whatever has waited longest.
function queueOrder(a, b) {
  var ua = a.priority === "urgent" ? 0 : 1, ub = b.priority === "urgent" ? 0 : 1;
  return ua - ub || new Date(a.submittedAt) - new Date(b.submittedAt);
}

function waitingText(f) {
  var d = daysBetween(f.submittedAt, new Date().toISOString());
  return d === 0 ? "sent today" : "waiting " + d + (d === 1 ? " day" : " days");
}

function renderTiles() {
  var open = state.formulations.filter(isOpen);
  var n = function (s) { return open.filter(function (f) { return f.status === s; }).length; };
  document.getElementById("q-tiles").innerHTML = tilesHtml([
    { label: "To start", value: n("submitted"), sub: "new from Hi‑Tech Company" },
    { label: "In testing", value: n("in_testing"), sub: "some tests recorded" },
    { label: "Ready to release", value: n("review"), sub: "all tests recorded" },
    { label: "On hold", value: n("on_hold"), sub: "waiting on Hi‑Tech Company" },
    { label: "Urgent", value: open.filter(function (f) { return f.priority === "urgent"; }).length, sub: "open and flagged urgent" }
  ]);
}

function itemHtml(f) {
  var rs = resultsForFormulation(f.id);
  var tests = (f.requestedTests || []).map(function (t) {
    var r = rs.find(function (x) { return x.testType === t; });
    return '<li><span class="qt-name">' + TEST_META[t].label + '</span><span class="qt-spec">' + esc(specText(f.specs, t)) + "</span>" +
      (r ? badge(r.result) : '<span class="status-pill">To do</span>') + "</li>";
  }).join("");
  var action = f.status === "review" ? "Review &amp; release" : "Conduct test";
  return '<article class="card qcard" data-id="' + esc(f.id) + '">' +
    '<div class="hcard-head"><div><div class="hcard-title">' + esc(f.name) + ' <span class="hint mono">' + esc(f.code) + "</span>" +
    (f.priority === "urgent" ? ' <span class="urgent-flag">Urgent</span>' : "") + "</div>" +
    '<div class="spec-line">Sent ' + esc(fmtDate(f.submittedAt)) + " by " + esc(f.submittedByName || "Unknown") + " · " + waitingText(f) + "</div></div>" +
    '<a class="btn primary small" href="' + testUrl(f) + '">' + action + " →</a></div>" +
    (f.status === "on_hold" ? '<div class="hold-banner"><b>On hold:</b> ' + esc(f.holdReason || "no reason given") + "</div>" : "") +
    (f.description ? compositionHtml(f) : "") +
    '<ul class="qtests">' + tests + "</ul></article>";
}

function render() {
  renderTiles();
  var q = search.value.trim().toLowerCase();
  var stage = stageSel.value;
  var open = state.formulations.filter(isOpen);
  var shown = open.filter(function (f) {
    if (stage && f.status !== stage) return false;
    if (urgentOnly.checked && f.priority !== "urgent") return false;
    if (q && ![f.name, f.code, f.description].some(function (s) { return s && s.toLowerCase().indexOf(q) >= 0; })) return false;
    return true;
  });

  document.getElementById("q-sections").innerHTML = SECTIONS.map(function (s) {
    var items = shown.filter(function (f) { return f.status === s.status; }).sort(queueOrder);
    if (!items.length) return "";
    return '<section class="qsection"><div class="qsection-head"><h2>' + s.title + ' <span class="col-count">' + items.length + "</span></h2>" +
      '<span class="spec-line">' + s.hint + "</span></div>" + items.map(itemHtml).join("") + "</section>";
  }).join("");

  document.getElementById("q-count").textContent = shown.length + " of " + open.length + " open";
  document.getElementById("q-empty").hidden = shown.length > 0;
  document.getElementById("q-empty-text").innerHTML = open.length
    ? "<div>Nothing matches these filters.</div>"
    : '<div class="big">Queue is clear</div><div>Nothing is waiting from Hi‑Tech Company. New formulations appear here as soon as they are sent.</div>';
}

function loadAll() { return fetchAll().then(render); }

[search, stageSel, urgentOnly].forEach(function (el) { el.addEventListener("input", render); });

startPage("queue.html").then(function (user) {
  if (user.role !== "lab") { document.getElementById("not-lab").hidden = false; return; }
  document.getElementById("q-body").hidden = false;
  return loadAll().then(function () { connectEvents(loadAll); });
}).catch(function () {
  toast("Could not reach the server — is it running?");
});
