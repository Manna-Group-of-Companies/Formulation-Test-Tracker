// One formulation in full, with the controls the signed-in side may use:
//  - Hi-Tech Company sees progress, can withdraw a formulation the lab
//    hasn't started, and sees values and pass/fail once they are released.
//  - The lab starts testing, puts it on hold (saying what it needs),
//    records a result per requested test, and releases the results, which
//    issues a numbered test report.
// Used as the board's detail panel and as the lab's Conduct Test page.
// The database decides what each side may do; this only offers it.

import { useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api.js";
import { useToast } from "../context/toast.jsx";
import { useData, resultsFor } from "../context/data.jsx";
import { useSession } from "../context/session.jsx";
import { fmtDate, num, specText, valueSummary, reportPath, daysBetween, TEST_META, STATUS_LABEL } from "../lib/format.js";
import { Badge, Recipe } from "./bits.jsx";

// The four steps a formulation goes through; "on hold" pauses it on one of them.
var STEPS = ["submitted", "in_testing", "review", "released"];

var ACTION_DONE = {
  start: "Testing started",
  hold: "Put on hold — Hi‑Tech Company can see why",
  resume: "Testing resumed",
  release: "Results sent back to Hi‑Tech Company",
  reopen: "Reopened — results withdrawn until you release them again"
};

function Stepper({ f }) {
  var at = STEPS.indexOf(f.status);
  if (f.status === "on_hold") {
    var done = (f.testsDone || []).length;
    at = done === (f.requestedTests || []).length ? 2 : done ? 1 : 0;
  }
  return (
    <ol className="stepper">
      {STEPS.map(function (s, i) {
        var cls = i < at ? "done" : i === at ? (f.status === "on_hold" ? "current held" : "current") : "";
        return <li key={s} className={cls}>{STATUS_LABEL[s]}</li>;
      })}
    </ol>
  );
}

function ResultLine({ r }) {
  return (
    <>
      <div className="spec-line" style={{ marginTop: 4 }}>
        {valueSummary(r)} · {r.specimenId || "no specimen id"} · {r.testedByName || "Unknown"} · {fmtDate(r.testedAt)}
      </div>
      {r.notes && <div className="spec-line">Note: {r.notes}</div>}
    </>
  );
}

function today() { return new Date().toISOString().slice(0, 10); }

// The lab's form for one test's result: specimen, date, the graded value,
// the optional second field, notes. Editing starts from the saved result.
function ResultForm({ f, type, existing, onDone, onCancel }) {
  var toast = useToast();
  var m = TEST_META[type], sec = m.second;
  var v = existing ? existing.values || {} : {};
  var [specimen, setSpecimen] = useState(existing ? existing.specimenId || "" : "");
  var [date, setDate] = useState(existing && existing.testedAt ? String(existing.testedAt).slice(0, 10) : today());
  var [v1, setV1] = useState(v[m.value] != null ? String(v[m.value]) : "");
  var [v2, setV2] = useState(sec ? (v[sec.key] != null ? String(v[sec.key]) : sec.type === "select" ? sec.options[0] : "") : "");
  var [notes, setNotes] = useState(existing ? existing.notes || "" : "");
  var [busy, setBusy] = useState(false);

  function submit(e) {
    e.preventDefault();
    var values = {};
    values[m.value] = num(v1);
    if (sec) values[sec.key] = sec.type === "number" ? num(v2) : v2.trim();
    setBusy(true);
    api.recordResult({
      formulationId: f.id,
      testType: type,
      specimenId: specimen.trim(),
      values: values,
      notes: notes.trim(),
      testedAt: date ? new Date(date + "T12:00:00").toISOString() : new Date().toISOString()
    }).then(function (saved) {
      toast("Result saved · " + (saved.result === "pass" ? "Pass" : saved.result === "fail" ? "Fail" : "Recorded"));
      onDone();
    }, function (err) {
      toast(err.message || "Could not save — try again");
    }).finally(function () { setBusy(false); });
  }

  return (
    <form style={{ marginTop: 6 }} onSubmit={submit} data-result-type={type}>
      <div className="grid2">
        <div className="field"><label>Specimen / lot ID</label><input className="rf-specimen" value={specimen} onChange={function (e) { setSpecimen(e.target.value); }} /></div>
        <div className="field"><label>Test date</label><input type="date" className="rf-date" value={date} onChange={function (e) { setDate(e.target.value); }} /></div>
      </div>
      <div className="grid2" style={{ marginTop: 8 }}>
        <div className="field">
          <label>{m.valueLabel + (m.unit ? " (" + m.unit + ")" : "")}</label>
          <input required type="number" step="any" className="rf-v1" value={v1} onChange={function (e) { setV1(e.target.value); }} />
        </div>
        {sec && (
          <div className="field">
            <label>{sec.label}</label>
            {sec.type === "select"
              ? <select className="rf-v2" value={v2} onChange={function (e) { setV2(e.target.value); }}>{sec.options.map(function (o) { return <option key={o}>{o}</option>; })}</select>
              : <input className="rf-v2" type={sec.type === "number" ? "number" : "text"} step="any" value={v2} onChange={function (e) { setV2(e.target.value); }} />}
          </div>
        )}
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label>Notes (optional, shown on the report)</label>
        <input className="rf-notes" value={notes} onChange={function (e) { setNotes(e.target.value); }} />
      </div>
      <div className="form-actions">
        {existing && <button type="button" className="btn ghost small" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn primary small" disabled={busy}>Save {m.label.toLowerCase()}</button>
      </div>
    </form>
  );
}

function LabResults({ f, rs, editingType, setEditingType, reload }) {
  var locked = f.status === "released";
  return (
    <>
      {(f.requestedTests || []).map(function (type) {
        var existing = rs.find(function (r) { return r.testType === type; });
        var showSaved = existing && (editingType !== type || locked);
        return (
          <div className="test-block" key={type}>
            <div className="test-head"><b>{TEST_META[type].label}</b>{existing ? <Badge result={existing.result} /> : <span className="spec-line">Not recorded</span>}</div>
            <div className="spec-line">Spec: {specText(f.specs, type)}</div>
            {showSaved && <ResultLine r={existing} />}
            {showSaved && !locked && <button className="btn ghost small" style={{ marginTop: 6 }} onClick={function () { setEditingType(type); }}>Edit</button>}
            {!showSaved && !locked && (
              <ResultForm key={type + (editingType === type ? ":edit" : "")} f={f} type={type} existing={editingType === type ? existing : null}
                onDone={function () { setEditingType(null); reload(); }} onCancel={function () { setEditingType(null); }} />
            )}
          </div>
        );
      })}
      {locked && <div className="spec-line">These results have been sent back. Reopen the formulation to correct them.</div>}
    </>
  );
}

function CompanyResults({ f, rs }) {
  if (f.status === "released") {
    return (f.requestedTests || []).map(function (type) {
      var r = rs.find(function (x) { return x.testType === type; });
      return (
        <div className="test-block" key={type}>
          <div className="test-head"><b>{TEST_META[type].label}</b>{r ? <Badge result={r.result} /> : <span className="spec-line">Not recorded</span>}</div>
          <div className="spec-line">Spec: {specText(f.specs, type)}</div>
          {r && <ResultLine r={r} />}
        </div>
      );
    });
  }
  var done = f.testsDone || [];
  return (
    <>
      <ul className="test-progress">
        {(f.requestedTests || []).map(function (type) {
          var isDone = done.indexOf(type) >= 0;
          return <li key={type}><span>{TEST_META[type].label}</span><span className={isDone ? "tp-done" : "tp-pending"}>{isDone ? "Tested" : "Pending"}</span></li>;
        })}
      </ul>
      <div className="spec-line" style={{ marginTop: 8 }}>Measured values and pass/fail appear here once the lab releases the results.</div>
    </>
  );
}

function ReleasedSummary({ f }) {
  var days = daysBetween(f.submittedAt, f.releasedAt);
  return (
    <div className="section">
      <h4>Test report</h4>
      <div className="report-summary">
        <div><span className="k">Report no.</span><span className="mono">{f.reportNo}{f.revision > 1 ? " · Rev " + f.revision : ""}</span></div>
        <div><span className="k">Overall outcome</span><span><Badge result={f.outcome} /></span></div>
        <div><span className="k">Released</span><span>{fmtDate(f.releasedAt)} by {f.releasedByName || "Unknown"}</span></div>
        <div><span className="k">Turnaround</span><span className="mono">{days != null ? days + "d" : "—"}</span></div>
      </div>
      {f.labRemarks && <div className="remarks"><span className="k">Lab remarks</span><span className="remarks-text">{f.labRemarks}</span></div>}
      <div className="action-row"><a className="btn primary small" href={reportPath(f)} target="_blank" rel="noopener">Open test report</a></div>
    </div>
  );
}

// back: { to, label } shows a link (e.g. back to the queue) instead of Close.
export default function FormulationDetail({ f, onClose, back, onWithdrawn }) {
  var { user } = useSession();
  var { results, reload } = useData();
  var toast = useToast();
  var lab = user.role === "lab";
  var rs = resultsFor(results, f.id);
  var [editingType, setEditingType] = useState(null);
  var [holdOpen, setHoldOpen] = useState(false);
  var [holdReason, setHoldReason] = useState("");
  var [remarks, setRemarks] = useState(f.labRemarks || "");
  var [busy, setBusy] = useState(null);

  function run(action, body) {
    setBusy(action);
    api.labAction(f.id, action, body).then(function () {
      if (action === "hold") { setHoldOpen(false); setHoldReason(""); }
      toast(ACTION_DONE[action]);
      return reload();
    }, function (err) {
      toast(err.message || "Could not update — try again");
    }).finally(function () { setBusy(null); });
  }

  function withdraw() {
    if (!confirm("Withdraw “" + f.name + "”? The lab will no longer see it.")) return;
    setBusy("withdraw");
    api.withdraw(f.id).then(function () {
      toast("Formulation withdrawn");
      if (onWithdrawn) onWithdrawn();
      return reload();
    }, function (err) {
      toast(err.message || "Could not withdraw — try again");
    }).finally(function () { setBusy(null); });
  }

  var labButtons = [];
  if (lab) {
    if (f.status === "submitted") labButtons.push(<button key="start" className="btn small primary" disabled={!!busy} onClick={function () { run("start"); }}>Start testing</button>);
    if (["submitted", "in_testing", "review"].indexOf(f.status) >= 0 && !holdOpen) labButtons.push(<button key="hold" className="btn small" onClick={function () { setHoldOpen(true); }}>Put on hold</button>);
    if (f.status === "on_hold") labButtons.push(<button key="resume" className="btn small primary" disabled={!!busy} onClick={function () { run("resume"); }}>Resume testing</button>);
    if (f.status === "released") labButtons.push(<button key="reopen" className="btn small" disabled={!!busy} onClick={function () {
      if (confirm("Reopening takes these results back from Hi‑Tech Company until you release them again. Continue?")) run("reopen");
    }}>Reopen to correct results</button>);
  }

  return (
    <div className="card" id="formulation-detail">
      <div className="card-head">
        <h2>{f.name} <span className="hint mono">{f.code}</span></h2>
        <div className="head-right">
          {f.priority === "urgent" && <span className="urgent-flag">Urgent</span>}
          {back ? <Link className="btn ghost small" to={back.to}>{back.label}</Link> : <button className="btn ghost small" onClick={onClose}>Close</button>}
        </div>
      </div>
      <div className="spec-line">Sent {fmtDate(f.submittedAt)}{f.submittedByName ? " by " + f.submittedByName : ""}</div>
      <Recipe f={f} />

      <div className="section">
        <h4>Progress</h4>
        <Stepper f={f} />
        {f.status === "on_hold" && <div className="hold-banner"><b>On hold:</b> {f.holdReason || "no reason given"}</div>}
        {labButtons.length > 0 && <div className="action-row">{labButtons}</div>}
        {lab && holdOpen && (
          <form className="inline-form" onSubmit={function (e) { e.preventDefault(); run("hold", { reason: holdReason.trim() }); }}>
            <div className="field">
              <label>What does the lab need from Hi‑Tech Company?</label>
              <input required autoFocus value={holdReason} onChange={function (e) { setHoldReason(e.target.value); }} placeholder="e.g. Cooking time missing from the reactor conditions" />
            </div>
            <div className="form-actions">
              <button type="button" className="btn ghost small" onClick={function () { setHoldOpen(false); }}>Cancel</button>
              <button type="submit" className="btn primary small" disabled={!!busy}>Put on hold</button>
            </div>
          </form>
        )}
        {!lab && f.status === "submitted" && !(f.testsDone || []).length && (
          <div className="action-row">
            <button className="btn small danger" disabled={!!busy} onClick={withdraw}>Withdraw formulation</button>
            <span className="spec-line">Possible until the lab starts testing.</span>
          </div>
        )}
      </div>

      <div className="section">
        <h4>{lab ? "Record results" : "Results"}</h4>
        {lab
          ? <LabResults f={f} rs={rs} editingType={editingType} setEditingType={setEditingType} reload={reload} />
          : <CompanyResults f={f} rs={rs} />}
      </div>

      {lab && f.status === "review" && (
        <div className="section">
          <h4>Send results back</h4>
          <div className="spec-line">Every requested test is recorded. Overall outcome: <Badge result={f.outcome} /></div>
          <form style={{ marginTop: 10 }} onSubmit={function (e) { e.preventDefault(); run("release", { remarks: remarks.trim() }); }}>
            <div className="field">
              <label>Remarks for Hi‑Tech Company (optional, printed on the report)</label>
              <textarea value={remarks} onChange={function (e) { setRemarks(e.target.value); }} placeholder="e.g. Hardness above the limit — consider adjusting the RA 480 dose" />
            </div>
            <div className="form-actions">
              <a className="btn ghost small" href={reportPath(f)} target="_blank" rel="noopener">Preview report</a>
              <button type="submit" className="btn primary small" disabled={!!busy}>Release results to Hi‑Tech Company</button>
            </div>
          </form>
        </div>
      )}
      {f.status === "released" && <ReleasedSummary f={f} />}
    </div>
  );
}
