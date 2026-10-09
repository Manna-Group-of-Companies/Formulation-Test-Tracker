// Every formulation Hi-Tech Company has sent, newest first, each with its
// full record: what was sent and when, every requested test with the
// measured value, the spec it was judged against and whether it passed or
// failed, the overall outcome, the lab's remarks and the test report.
// Hi-Tech Company sees values and grades once the lab releases them (the
// database holds them back until then); before that a test shows as tested
// or pending. The lab sees every result as soon as it is recorded.

import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Page } from "../components/Layout.jsx";
import { Badge, EmptyCard, Tiles } from "../components/bits.jsx";
import { useData, resultsFor } from "../context/data.jsx";
import { useSession } from "../context/session.jsx";
import { fmtDate, specText, valueSummary, testPath, reportPath, daysBetween, TEST_META, STATUS_LABEL } from "../lib/format.js";

function isReleased(f) { return f.status === "released"; }
// The outcome filter's value: the overall result once released, otherwise "awaiting".
function outcomeKey(f) { return isReleased(f) ? f.outcome : "awaiting"; }

function Kv({ label, children }) {
  return <div><span className="k">{label}</span><span>{children}</span></div>;
}

// One table cell. The class and label let narrow screens stack the cells
// as labelled blocks instead of a wide table (see .history-table in the CSS).
function Cell({ cls, label, children }) {
  return <td className={cls} data-label={label}>{children}</td>;
}

function TestRow({ f, type, rs }) {
  var r = rs.find(function (x) { return x.testType === type; });
  var test = <Cell cls="c-test" label="Test"><b>{TEST_META[type].label}</b></Cell>;
  var spec = <Cell cls="c-spec" label="Specification">{specText(f.specs, type)}</Cell>;
  if (!r) {
    var tested = (f.testsDone || []).indexOf(type) >= 0;
    return (
      <tr className="pending-row">
        {test}<Cell cls="c-specimen" label="Specimen / lot">—</Cell><Cell cls="c-measured" label="Measured">—</Cell>{spec}
        <Cell cls="c-result" label="Result"><span className="status-pill">{tested ? "Tested · awaiting release" : "Not tested yet"}</span></Cell>
        <Cell cls="c-tested" label="Tested">—</Cell><Cell cls="c-notes" label="Notes"></Cell>
      </tr>
    );
  }
  return (
    <tr>
      {test}<Cell cls="c-specimen mono" label="Specimen / lot">{r.specimenId || "—"}</Cell><Cell cls="c-measured" label="Measured">{valueSummary(r)}</Cell>{spec}
      <Cell cls="c-result" label="Result"><Badge result={r.result} /></Cell>
      <Cell cls="c-tested" label="Tested">{fmtDate(r.testedAt)}<span className="note">{r.testedByName || ""}</span></Cell>
      <Cell cls="c-notes" label="Notes">{r.notes || ""}</Cell>
    </tr>
  );
}

function HistoryCard({ f, results, testFilter, lab }) {
  var released = isReleased(f);
  var rs = resultsFor(results, f.id);
  var days = daysBetween(f.submittedAt, f.releasedAt);
  var tests = (f.requestedTests || []).filter(function (t) { return !testFilter || t === testFilter; });
  return (
    <article className="card hcard">
      <div className="hcard-head">
        <div>
          <div className="hcard-title">{f.name} <span className="hint mono">{f.code}</span>{f.priority === "urgent" && <> <span className="urgent-flag">Urgent</span></>}</div>
          {f.description && <div className="spec-line">{f.description}</div>}
        </div>
        {released
          ? <div className="overall"><span className="k">Overall</span><Badge result={f.outcome} /></div>
          : <span className={"status-pill " + f.status}>{STATUS_LABEL[f.status] || f.status}</span>}
      </div>
      <div className="hcard-meta">
        <Kv label="Report no.">{f.reportNo ? <><span className="mono">{f.reportNo}</span>{f.revision > 1 ? " · Rev " + f.revision : ""}</> : "—"}</Kv>
        <Kv label="Sent in">{fmtDate(f.submittedAt)}<span className="note">by {f.submittedByName || "Unknown"}</span></Kv>
        <Kv label="Results released">{released ? <>{fmtDate(f.releasedAt)}<span className="note">by {f.releasedByName || "Unknown"}</span></> : "—"}</Kv>
        <Kv label="Turnaround">{released && days != null ? days + (days === 1 ? " day" : " days") : "—"}</Kv>
      </div>
      {f.status === "on_hold" && f.holdReason && <div className="hold-banner"><b>On hold:</b> {f.holdReason}</div>}
      <div className="table-scroll">
        <table className="history-table">
          <thead><tr><th>Test</th><th>Specimen / lot</th><th>Measured</th><th>Specification</th><th>Result</th><th>Tested</th><th>Notes</th></tr></thead>
          <tbody>{tests.map(function (t) { return <TestRow key={t} f={f} type={t} rs={rs} />; })}</tbody>
        </table>
      </div>
      {released && f.labRemarks && <div className="remarks"><span className="k">Lab remarks</span><span className="remarks-text">{f.labRemarks}</span></div>}
      {released && <div className="action-row"><a className="btn small" href={reportPath(f)} target="_blank" rel="noopener">Open test report</a></div>}
      {!released && lab && <div className="action-row"><Link className="btn primary small" to={testPath(f)}>{f.status === "review" ? "Review & release" : "Conduct test"} →</Link></div>}
    </article>
  );
}

export default function History() {
  var { user } = useSession();
  var { formulations, results, loaded } = useData();
  var [q, setQ] = useState("");
  var [oc, setOc] = useState("");
  var [test, setTest] = useState("");
  var lab = user.role === "lab";

  useEffect(function () { document.title = "Test Result History — Formulation Test Tracker"; }, []);

  var all = formulations.slice().sort(function (a, b) { return new Date(b.submittedAt) - new Date(a.submittedAt); });
  var released = all.filter(isReleased);
  var count = function (o) { return released.filter(function (f) { return f.outcome === o; }).length; };
  var query = q.trim().toLowerCase();
  var shown = all.filter(function (f) {
    if (oc && outcomeKey(f) !== oc) return false;
    if (test && (f.requestedTests || []).indexOf(test) < 0) return false;
    if (query && ![f.name, f.code, f.reportNo, f.description].some(function (s) { return s && s.toLowerCase().indexOf(query) >= 0; })) return false;
    return true;
  });

  return (
    <Page>
      <div className="page-head">
        <h1>Test Result History</h1>
        <p>{lab
          ? "Every formulation Hi‑Tech Company has sent, with each test result the lab has recorded. Results show here as soon as they're saved; Hi‑Tech Company sees them once you release them."
          : "Every formulation sent to the Manna lab, with the result of each test. Measured values and pass/fail appear once the lab releases them."}</p>
      </div>

      <Tiles tiles={[
        lab ? { label: "Formulations received", value: all.length, sub: "from Hi‑Tech Company" } : { label: "Formulations sent", value: all.length, sub: "to the Manna lab" },
        lab ? { label: "Results released", value: released.length, sub: "test reports sent back" } : { label: "Results received", value: released.length, sub: "test reports released" },
        { label: "All tests passed", value: count("pass"), sub: lab ? "of the results released" : "of the results received" },
        { label: "One or more failed", value: count("fail"), sub: lab ? "of the results released" : "of the results received" },
        lab ? { label: "Not released yet", value: all.length - released.length, sub: "still in the lab" } : { label: "Awaiting results", value: all.length - released.length, sub: "still with the lab" }
      ]} />

      <div className="card">
        <div className="filter-bar">
          <input type="search" value={q} onChange={function (e) { setQ(e.target.value); }} placeholder="Search name, code or report no." aria-label="Search" />
          <select value={oc} onChange={function (e) { setOc(e.target.value); }} aria-label="Outcome">
            <option value="">Any outcome</option>
            <option value="pass">All tests passed</option>
            <option value="fail">One or more failed</option>
            <option value="recorded">Recorded only (no spec)</option>
            <option value="awaiting">{lab ? "Not released yet" : "Awaiting results"}</option>
          </select>
          <select value={test} onChange={function (e) { setTest(e.target.value); }} aria-label="Test">
            <option value="">All tests</option>
            {Object.keys(TEST_META).map(function (t) { return <option key={t} value={t}>{TEST_META[t].label}</option>; })}
          </select>
          <span className="spec-line">Showing {shown.length} of {all.length}{all.length === 1 ? " formulation" : " formulations"}</span>
        </div>
      </div>

      <div className="history-list">
        {shown.map(function (f) { return <HistoryCard key={f.id} f={f} results={results} testFilter={test} lab={lab} />; })}
      </div>
      {loaded && !shown.length && (
        all.length ? <EmptyCard>No formulations match these filters.</EmptyCard>
          : <EmptyCard title="Nothing sent yet">Formulations you send appear here with their test results.{!lab && <> <Link to="/add">Add a formulation</Link></>}</EmptyCard>
      )}
    </Page>
  );
}
