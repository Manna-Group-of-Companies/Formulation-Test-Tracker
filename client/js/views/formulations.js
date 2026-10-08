// ---------- the board: tiles, status columns, results sent back ----------
//
// Both sides see the same board. Clicking a card or a released result opens
// it in the detail panel (views/detail.js), which has each side's controls.
// The server enforces who may do what and computes grades and the overall
// outcome; the board only reflects that state.

import { state, resultsForFormulation } from "../state.js";
import { fetchAll } from "../api.js";
import { esc, fmtDate, badge, reportUrl, tilesHtml, TEST_META, STATUSES, STATUS_LABEL, daysBetween } from "../format.js";
import { setupDetail, openDetail, refreshDetail } from "./detail.js";

function refresh() { return fetchAll().then(render); }

export function render() {
  renderTiles();
  renderBoard();
  renderArchive();
  refreshDetail();
}

function renderTiles() {
  var all = state.formulations;
  var open = all.filter(function (f) { return f.status !== "released"; });
  var released = all.filter(function (f) { return f.status === "released"; });
  var turnarounds = released.map(function (f) { return daysBetween(f.submittedAt, f.releasedAt); }).filter(function (d) { return d != null; });
  var avgTurnaround = turnarounds.length ? Math.round(10 * turnarounds.reduce(function (a, b) { return a + b; }, 0) / turnarounds.length) / 10 : null;
  var tiles = [
    { label: "In the pipeline", value: open.length, sub: all.length + " sent in total" },
    { label: "Urgent & open", value: open.filter(function (f) { return f.priority === "urgent"; }).length, sub: "flagged by Hi‑Tech Company" },
    { label: "Awaiting release", value: all.filter(function (f) { return f.status === "review"; }).length, sub: "tested, report not yet sent" },
    { label: "Avg. turnaround", value: avgTurnaround == null ? "—" : avgTurnaround + "d", sub: "sent in → results released" },
    { label: "Results sent back", value: released.length, sub: "test reports issued" }
  ];
  document.getElementById("tiles").innerHTML = tilesHtml(tiles);
}

function chipsFor(f) {
  var rs = resultsForFormulation(f.id);
  return (f.requestedTests || []).map(function (t) {
    var r = rs.find(function (x) { return x.testType === t; });
    var cls = "", mark = "";
    if (r) { cls = r.result === "fail" ? "fail" : "done"; mark = r.result === "fail" ? " ✗" : " ✓"; }
    else if ((f.testsDone || []).indexOf(t) >= 0) { cls = "logged"; mark = " ✓"; } // tested; grade not released yet
    return '<span class="chip ' + cls + '">' + TEST_META[t].chip + mark + "</span>";
  }).join("");
}

function renderBoard() {
  var board = document.getElementById("board");
  board.innerHTML = STATUSES.map(function (s) {
    var items = state.formulations.filter(function (f) { return f.status === s; })
      .sort(function (a, b) { return new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0); });
    var cards = items.map(function (f) {
      var done = (f.testsDone || []).length, total = (f.requestedTests || []).length;
      return '<div class="fcard" data-id="' + f.id + '">' +
        '<div class="fcard-top"><div><div class="fcard-name">' + esc(f.name) + '</div><div class="fcard-code mono">' + esc(f.code) + "</div></div>" +
        (f.priority === "urgent" ? '<span class="urgent-flag">Urgent</span>' : "") + "</div>" +
        (f.status === "on_hold" && f.holdReason ? '<div class="hold-note">' + esc(f.holdReason) + "</div>" : "") +
        '<div class="chips">' + chipsFor(f) + "</div>" +
        '<div class="fcard-meta"><span>' + esc(fmtDate(f.submittedAt)) + "</span>" +
        (f.status === "released" ? '<span class="mono">' + esc(f.reportNo) + "</span>" : "<span>" + done + "/" + total + " tested</span>") +
        "</div></div>";
    }).join("");
    return '<div class="col"><div class="col-head"><h3>' + STATUS_LABEL[s] + '</h3><span class="col-count">' + items.length + "</span></div>" +
      (items.length ? cards : '<div class="col-empty">Nothing here</div>') + "</div>";
  }).join("");
}

function renderArchive() {
  var rf = document.getElementById("archive-filter-result").value;
  var released = state.formulations.filter(function (f) { return f.status === "released"; });
  var rows = released
    .sort(function (a, b) { return new Date(b.releasedAt || 0) - new Date(a.releasedAt || 0); })
    .filter(function (f) { return !rf || f.outcome === rf; });
  var empty = document.getElementById("archive-empty");
  empty.style.display = rows.length ? "none" : "block";
  empty.innerHTML = released.length
    ? '<div>No released results match this filter.</div>'
    : '<div class="big">No results sent back yet</div><div>Once the lab releases a formulation\'s results, its test report appears here.</div>';
  document.getElementById("archive-body").innerHTML = rows.map(function (f) {
    var days = daysBetween(f.submittedAt, f.releasedAt);
    // Class + data-label let phones show each row as a labelled block.
    return '<tr class="archive-row" data-id="' + f.id + '">' +
      '<td class="a-report mono" data-label="Report no.">' + esc(f.reportNo) + "</td>" +
      '<td class="a-name"><b>' + esc(f.name) + "</b></td>" +
      '<td class="a-code mono" data-label="Code">' + esc(f.code) + "</td>" +
      '<td class="a-outcome">' + badge(f.outcome) + "</td>" +
      '<td class="a-sent" data-label="Sent in">' + esc(fmtDate(f.submittedAt)) + "</td>" +
      '<td class="a-released" data-label="Released">' + esc(fmtDate(f.releasedAt)) + "</td>" +
      '<td class="a-turn mono" data-label="Turnaround">' + (days != null ? days + "d" : "—") + "</td>" +
      '<td class="a-link"><a href="' + reportUrl(f) + '" target="_blank" rel="noopener">Report</a></td></tr>';
  }).join("");
}

// ---------- wiring ----------

export function init() {
  setupDetail({ box: document.getElementById("formulation-detail"), refresh: refresh });
  document.getElementById("board").addEventListener("click", function (e) {
    var card = e.target.closest(".fcard"); if (card) openDetail(card.dataset.id, true);
  });
  document.getElementById("archive-body").addEventListener("click", function (e) {
    if (e.target.closest("a")) return; // the Report link opens in its own tab
    var row = e.target.closest(".archive-row"); if (row) openDetail(row.dataset.id, true);
  });
  document.getElementById("archive-filter-result").addEventListener("change", renderArchive);
}
