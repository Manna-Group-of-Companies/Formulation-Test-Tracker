// ---------- formulation detail: progress, lab actions, result entry, release ----------
//
// One formulation in full, with the controls the signed-in side may use:
//  - Hi-Tech Company sees progress, can withdraw a formulation the lab
//    hasn't started, and sees values and pass/fail once they are released.
//  - The lab starts testing, puts it on hold (saying what it needs),
//    records a result per requested test, and releases the results, which
//    issues a numbered test report (report.html).
// Used as the board's detail panel and as the lab's Conduct Test page
// (test.html); setupDetail() says where it draws and how to reload data.

import { state, resultsForFormulation } from "../state.js";
import { api } from "../api.js";
import { toast } from "../toast.js";
import { esc, num, fmtDate, badge, valueSummary, specText, reportUrl, TEST_META, STATUS_LABEL, daysBetween } from "../format.js";

var openDetailId = null;
var editingType = null;
var holdFormOpen = false;

// box: element to draw into. refresh(): reload data and re-render.
// backHref/backLabel: show a link (e.g. back to the queue) instead of Close.
// onMissing(): the formulation is gone (withdrawn) — say so.
var ctx = { box: null, refresh: null, backHref: null, backLabel: null, onMissing: null };

export function setupDetail(opts) { Object.assign(ctx, opts); }

// The four steps a formulation goes through; "on hold" pauses it on one of them.
var STEPS = ["submitted", "in_testing", "review", "released"];

var ACTION_DONE = {
  start: "Testing started",
  hold: "Put on hold — Hi‑Tech Company can see why",
  resume: "Testing resumed",
  release: "Results sent back to Hi‑Tech Company",
  reopen: "Reopened — results withdrawn until you release them again"
};

function isLab() { return !!state.user && state.user.role === "lab"; }

// Hi-Tech Company's notes on what's in the formulation — what the lab tests from.
export function compositionHtml(f) {
  return '<div class="composition"><span class="k">Composition / description</span><p>' + esc(f.description) + "</p></div>";
}

function headControl() {
  return ctx.backHref
    ? '<a class="btn ghost small" href="' + ctx.backHref + '">' + ctx.backLabel + "</a>"
    : '<button class="btn ghost small" data-close>Close</button>';
}

// A refresh — often triggered by the other side — re-renders the detail
// panel; carry over anything half-typed into its forms so it isn't lost.
function keepTyping(rerender) {
  var box = ctx.box;
  var kept = {};
  box.querySelectorAll("[data-keep]").forEach(function (el) { kept[el.dataset.keep] = el.value; });
  var active = document.activeElement;
  var focused = active && box.contains(active) ? active.dataset.keep : null;
  rerender();
  box.querySelectorAll("[data-keep]").forEach(function (el) {
    if (Object.prototype.hasOwnProperty.call(kept, el.dataset.keep)) el.value = kept[el.dataset.keep];
  });
  if (focused) { var el = box.querySelector('[data-keep="' + focused + '"]'); if (el) el.focus(); }
}

function stepperHtml(f) {
  var at = STEPS.indexOf(f.status);
  if (f.status === "on_hold") {
    var done = (f.testsDone || []).length;
    at = done === (f.requestedTests || []).length ? 2 : done ? 1 : 0;
  }
  return '<ol class="stepper">' + STEPS.map(function (s, i) {
    var cls = i < at ? "done" : i === at ? (f.status === "on_hold" ? "current held" : "current") : "";
    return '<li class="' + cls + '">' + STATUS_LABEL[s] + "</li>";
  }).join("") + "</ol>";
}

function actionBtn(action, label, cls) {
  return '<button class="btn small ' + cls + '" data-action="' + action + '">' + label + "</button>";
}

function labActionsHtml(f) {
  var btns = [];
  if (f.status === "submitted") btns.push(actionBtn("start", "Start testing", "primary"));
  if (["submitted", "in_testing", "review"].indexOf(f.status) >= 0 && !holdFormOpen) btns.push('<button class="btn small" data-open-hold>Put on hold</button>');
  if (f.status === "on_hold") btns.push(actionBtn("resume", "Resume testing", "primary"));
  if (f.status === "released") btns.push(actionBtn("reopen", "Reopen to correct results", ""));
  var html = btns.length ? '<div class="action-row">' + btns.join("") + "</div>" : "";
  if (holdFormOpen) {
    html += '<form class="inline-form" data-hold-form><div class="field"><label>What does the lab need from Hi‑Tech Company?</label>' +
      '<input required data-keep="hold-reason" placeholder="e.g. Cure temperature missing from the composition notes"></div>' +
      '<div class="form-actions"><button type="button" class="btn ghost small" data-cancel-hold>Cancel</button><button type="submit" class="btn primary small">Put on hold</button></div></form>';
  }
  return html;
}

function companyActionsHtml(f) {
  if (f.status === "submitted" && !(f.testsDone || []).length) {
    return '<div class="action-row"><button class="btn small danger" data-withdraw>Withdraw formulation</button><span class="spec-line">Possible until the lab starts testing.</span></div>';
  }
  return "";
}

function resultLine(r) {
  return '<div class="spec-line" style="margin-top:4px">' + esc(valueSummary(r)) + " · " + esc(r.specimenId || "no specimen id") + " · " +
    esc(r.testedByName || "Unknown") + " · " + esc(fmtDate(r.testedAt)) + "</div>" +
    (r.notes ? '<div class="spec-line">Note: ' + esc(r.notes) + "</div>" : "");
}

function resultFormHtml(type, existing) {
  var v = existing ? existing.values : {};
  var k = function (field) { return ' data-keep="' + type + "." + field + '"'; };
  var common = '<div class="grid2"><div class="field"><label>Specimen / lot ID</label><input value="' + esc(existing ? existing.specimenId || "" : "") + '" class="rf-specimen"' + k("specimen") + "></div>" +
    '<div class="field"><label>Test date</label><input type="date" class="rf-date"' + k("date") + ' value="' + new Date().toISOString().slice(0, 10) + '"></div></div>';
  var m = TEST_META[type], sec = m.second;
  var fields = '<div class="grid2" style="margin-top:8px"><div class="field"><label>' + esc(m.valueLabel + (m.unit ? " (" + m.unit + ")" : "")) + '</label><input required type="number" step="any" class="rf-v1"' + k("v1") + ' value="' + (v[m.value] != null ? v[m.value] : "") + '"></div>';
  if (sec) {
    var cur = v[sec.key];
    if (sec.type === "select") {
      fields += '<div class="field"><label>' + esc(sec.label) + '</label><select class="rf-v2"' + k("v2") + ">" + sec.options.map(function (o) { return "<option" + (cur === o ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") + "</select></div>";
    } else {
      fields += '<div class="field"><label>' + esc(sec.label) + '</label><input' + (sec.type === "number" ? ' type="number" step="any"' : "") + ' class="rf-v2"' + k("v2") + ' value="' + esc(cur != null ? cur : "") + '"></div>';
    }
  }
  fields += "</div>";
  var notes = '<div class="field" style="margin-top:8px"><label>Notes (optional, shown on the report)</label><input class="rf-notes"' + k("notes") + ' value="' + esc(existing ? existing.notes || "" : "") + '"></div>';
  var cancel = existing ? '<button type="button" class="btn ghost small" data-cancel-edit>Cancel</button>' : "";
  return '<form data-result-type="' + type + '" style="margin-top:6px">' + common + fields + notes + '<div class="form-actions">' + cancel + '<button type="submit" class="btn primary small">Save ' + TEST_META[type].label.toLowerCase() + "</button></div></form>";
}

function labResultsHtml(f) {
  var rs = resultsForFormulation(f.id);
  var locked = f.status === "released";
  var html = (f.requestedTests || []).map(function (type) {
    var existing = rs.find(function (r) { return r.testType === type; });
    var h = '<div class="test-block"><div class="test-head"><b>' + TEST_META[type].label + "</b>" + (existing ? badge(existing.result) : '<span class="spec-line">Not recorded</span>') + "</div>";
    h += '<div class="spec-line">Spec: ' + esc(specText(f.specs, type)) + "</div>";
    if (existing && (editingType !== type || locked)) {
      h += resultLine(existing);
      if (!locked) h += '<button class="btn ghost small" data-edit-result="' + type + '" style="margin-top:6px">Edit</button>';
    } else if (!locked) {
      h += resultFormHtml(type, editingType === type ? existing : null);
    }
    return h + "</div>";
  }).join("");
  if (locked) html += '<div class="spec-line">These results have been sent back. Reopen the formulation to correct them.</div>';
  return html;
}

function companyResultsHtml(f) {
  if (f.status === "released") {
    var rs = resultsForFormulation(f.id);
    return (f.requestedTests || []).map(function (type) {
      var r = rs.find(function (x) { return x.testType === type; });
      return '<div class="test-block"><div class="test-head"><b>' + TEST_META[type].label + "</b>" + (r ? badge(r.result) : '<span class="spec-line">Not recorded</span>') + "</div>" +
        '<div class="spec-line">Spec: ' + esc(specText(f.specs, type)) + "</div>" + (r ? resultLine(r) : "") + "</div>";
    }).join("");
  }
  var done = f.testsDone || [];
  return '<ul class="test-progress">' + (f.requestedTests || []).map(function (type) {
    var isDone = done.indexOf(type) >= 0;
    return "<li><span>" + TEST_META[type].label + '</span><span class="' + (isDone ? "tp-done" : "tp-pending") + '">' + (isDone ? "Tested" : "Pending") + "</span></li>";
  }).join("") + "</ul>" +
    '<div class="spec-line" style="margin-top:8px">Measured values and pass/fail appear here once the lab releases the results.</div>';
}

function releaseFormHtml(f) {
  return '<div class="section"><h4>Send results back</h4>' +
    '<div class="spec-line">Every requested test is recorded. Overall outcome: ' + badge(f.outcome) + "</div>" +
    '<form data-release-form style="margin-top:10px"><div class="field"><label>Remarks for Hi‑Tech Company (optional, printed on the report)</label>' +
    '<textarea data-keep="release-remarks" placeholder="e.g. Hardness above the limit — consider reducing filler loading">' + esc(f.labRemarks || "") + "</textarea></div>" +
    '<div class="form-actions"><a class="btn ghost small" href="' + reportUrl(f) + '" target="_blank" rel="noopener">Preview report</a>' +
    '<button type="submit" class="btn primary small">Release results to Hi‑Tech Company</button></div></form></div>';
}

function releasedHtml(f) {
  var days = daysBetween(f.submittedAt, f.releasedAt);
  return '<div class="section"><h4>Test report</h4><div class="report-summary">' +
    '<div><span class="k">Report no.</span><span class="mono">' + esc(f.reportNo) + (f.revision > 1 ? " · Rev " + f.revision : "") + "</span></div>" +
    '<div><span class="k">Overall outcome</span><span>' + badge(f.outcome) + "</span></div>" +
    '<div><span class="k">Released</span><span>' + esc(fmtDate(f.releasedAt)) + " by " + esc(f.releasedByName || "Unknown") + "</span></div>" +
    '<div><span class="k">Turnaround</span><span class="mono">' + (days != null ? days + "d" : "—") + "</span></div></div>" +
    (f.labRemarks ? '<div class="remarks"><span class="k">Lab remarks</span><span class="remarks-text">' + esc(f.labRemarks) + "</span></div>" : "") +
    '<div class="action-row"><a class="btn primary small" href="' + reportUrl(f) + '" target="_blank" rel="noopener">Open test report</a></div></div>';
}

function renderDetail(id) {
  var f = state.formulations.find(function (x) { return x.id === id; });
  var box = ctx.box;
  if (!f) { closeDetail(); if (ctx.onMissing) ctx.onMissing(); return; }
  openDetailId = id;
  var lab = isLab();

  var html = '<div class="card-head"><h2>' + esc(f.name) + ' <span class="hint mono">' + esc(f.code) + "</span></h2>";
  html += '<div class="head-right">' + (f.priority === "urgent" ? '<span class="urgent-flag">Urgent</span>' : "") + headControl() + "</div></div>";
  html += '<div class="spec-line">Sent ' + esc(fmtDate(f.submittedAt)) + (f.submittedByName ? " by " + esc(f.submittedByName) : "") + "</div>";
  if (f.description) html += compositionHtml(f);

  html += '<div class="section"><h4>Progress</h4>' + stepperHtml(f);
  if (f.status === "on_hold") html += '<div class="hold-banner"><b>On hold:</b> ' + esc(f.holdReason || "no reason given") + "</div>";
  html += (lab ? labActionsHtml(f) : companyActionsHtml(f)) + "</div>";

  html += '<div class="section"><h4>' + (lab ? "Record results" : "Results") + "</h4>" + (lab ? labResultsHtml(f) : companyResultsHtml(f)) + "</div>";

  if (lab && f.status === "review") html += releaseFormHtml(f);
  if (f.status === "released") html += releasedHtml(f);

  box.innerHTML = html;
  box.style.display = "block";
  wireDetail(f, box);
}

function wireDetail(f, box) {
  var closeBtn = box.querySelector("[data-close]");
  if (closeBtn) closeBtn.onclick = closeDetail;
  box.querySelectorAll("[data-action]").forEach(function (btn) {
    btn.onclick = function () {
      if (btn.dataset.action === "reopen" && !confirm("Reopening takes these results back from Hi‑Tech Company until you release them again. Continue?")) return;
      runAction(f, btn.dataset.action, {}, btn);
    };
  });
  var openHold = box.querySelector("[data-open-hold]");
  if (openHold) openHold.onclick = function () {
    holdFormOpen = true;
    renderDetail(f.id);
    box.querySelector("[data-hold-form] input").focus();
  };
  var holdForm = box.querySelector("[data-hold-form]");
  if (holdForm) {
    holdForm.querySelector("[data-cancel-hold]").onclick = function () { holdFormOpen = false; renderDetail(f.id); };
    holdForm.onsubmit = function (e) {
      e.preventDefault();
      runAction(f, "hold", { reason: holdForm.querySelector("input").value.trim() }, holdForm.querySelector("button[type=submit]"));
    };
  }
  var releaseForm = box.querySelector("[data-release-form]");
  if (releaseForm) releaseForm.onsubmit = function (e) {
    e.preventDefault();
    runAction(f, "release", { remarks: releaseForm.querySelector("textarea").value.trim() }, releaseForm.querySelector("button[type=submit]"));
  };
  var withdrawBtn = box.querySelector("[data-withdraw]");
  if (withdrawBtn) withdrawBtn.onclick = function () { withdraw(f, withdrawBtn); };
  box.querySelectorAll("[data-edit-result]").forEach(function (btn) {
    btn.onclick = function () { editingType = btn.dataset.editResult; renderDetail(f.id); };
  });
  box.querySelectorAll("form[data-result-type]").forEach(function (form) {
    form.onsubmit = function (e) { e.preventDefault(); saveResult(f, form.dataset.resultType, form); };
  });
  box.querySelectorAll("[data-cancel-edit]").forEach(function (btn) {
    btn.onclick = function () { editingType = null; renderDetail(f.id); };
  });
}

// Show a formulation fresh (no edit or hold form open). scroll: bring the panel into view.
export function openDetail(id, scroll) {
  editingType = null;
  holdFormOpen = false;
  renderDetail(id);
  if (scroll) ctx.box.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

// Re-render the open formulation after new data arrived.
export function refreshDetail() {
  if (openDetailId) keepTyping(function () { renderDetail(openDetailId); });
}

export function closeDetail() {
  var box = ctx.box;
  box.style.display = "none";
  box.innerHTML = "";
  openDetailId = null;
  editingType = null;
  holdFormOpen = false;
}

function runAction(f, action, body, btn) {
  btn.disabled = true;
  api("/formulations/" + f.id + "/" + action, { method: "POST", body: JSON.stringify(body) }).then(function () {
    if (action === "hold") holdFormOpen = false;
    toast(ACTION_DONE[action]);
    return ctx.refresh();
  }).catch(function (err) {
    toast(err.message || "Could not update — try again");
    btn.disabled = false;
  });
}

function withdraw(f, btn) {
  if (!confirm("Withdraw “" + f.name + "”? The lab will no longer see it.")) return;
  btn.disabled = true;
  api("/formulations/" + f.id, { method: "DELETE" }).then(function () {
    toast("Formulation withdrawn");
    closeDetail();
    return ctx.refresh();
  }).catch(function (err) {
    toast(err.message || "Could not withdraw — try again");
    btn.disabled = false;
  });
}

function saveResult(f, type, form) {
  var dateVal = form.querySelector(".rf-date").value;
  var v1 = num(form.querySelector(".rf-v1").value);
  var v2el = form.querySelector(".rf-v2");
  var m = TEST_META[type], values = {};
  values[m.value] = v1;
  if (m.second && v2el) values[m.second.key] = m.second.type === "number" ? num(v2el.value) : v2el.value.trim();

  var data = {
    formulationId: f.id,
    testType: type,
    specimenId: form.querySelector(".rf-specimen").value.trim(),
    values: values,
    notes: form.querySelector(".rf-notes").value.trim(),
    testedAt: dateVal ? new Date(dateVal + "T12:00:00").toISOString() : new Date().toISOString()
  };
  var submitBtn = form.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  api("/results", { method: "POST", body: JSON.stringify(data) }).then(function (created) {
    editingType = null;
    toast("Result saved · " + (created.result === "pass" ? "Pass" : created.result === "fail" ? "Fail" : "Recorded"));
    return ctx.refresh();
  }).catch(function (err) {
    toast(err.message || "Could not save — try again");
  }).finally(function () { submitBtn.disabled = false; });
}
