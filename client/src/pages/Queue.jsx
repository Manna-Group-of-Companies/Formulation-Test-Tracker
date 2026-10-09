// The lab assistants' work list: every formulation Hi-Tech Company has sent
// whose results haven't been released yet, grouped by what needs doing
// next, urgent ones first and then the longest waiting. Each entry shows
// what an assistant needs at the bench — the reactor recipe and each
// requested test with its limits and whether it's done — and opens the
// Conduct Test page.

import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Page } from "../components/Layout.jsx";
import { Badge, EmptyCard, Recipe, Tiles } from "../components/bits.jsx";
import { useData, resultsFor } from "../context/data.jsx";
import { useSession } from "../context/session.jsx";
import { fmtDate, specText, testPath, daysBetween, TEST_META } from "../lib/format.js";

var SECTIONS = [
  { status: "submitted", title: "To start", hint: "Sent by Hi‑Tech Company, not started yet" },
  { status: "in_testing", title: "In testing", hint: "Some tests recorded" },
  { status: "review", title: "Ready to release", hint: "Every test recorded — check, then send the results back" },
  { status: "on_hold", title: "On hold", hint: "Waiting on Hi‑Tech Company" }
];

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

function QueueItem({ f, results }) {
  var rs = resultsFor(results, f.id);
  return (
    <article className="card qcard">
      <div className="hcard-head">
        <div>
          <div className="hcard-title">{f.name} <span className="hint mono">{f.code}</span>{f.priority === "urgent" && <> <span className="urgent-flag">Urgent</span></>}</div>
          <div className="spec-line">Sent {fmtDate(f.submittedAt)} by {f.submittedByName || "Unknown"} · {waitingText(f)}</div>
        </div>
        <Link className="btn primary small" to={testPath(f)}>{f.status === "review" ? "Review & release" : "Conduct test"} →</Link>
      </div>
      {f.status === "on_hold" && <div className="hold-banner"><b>On hold:</b> {f.holdReason || "no reason given"}</div>}
      <Recipe f={f} />
      <ul className="qtests">
        {(f.requestedTests || []).map(function (t) {
          var r = rs.find(function (x) { return x.testType === t; });
          return (
            <li key={t}>
              <span className="qt-name">{TEST_META[t].label}</span>
              <span className="qt-spec">{specText(f.specs, t)}</span>
              {r ? <Badge result={r.result} /> : <span className="status-pill">To do</span>}
            </li>
          );
        })}
      </ul>
    </article>
  );
}

export default function Queue() {
  var { user } = useSession();
  var { formulations, results, loaded } = useData();
  var [q, setQ] = useState("");
  var [stage, setStage] = useState("");
  var [urgentOnly, setUrgentOnly] = useState(false);

  useEffect(function () { document.title = "Test Queue — Formulation Test Tracker"; }, []);

  if (user.role !== "lab") {
    return <Page><EmptyCard title="Manna lab only">The test queue is for the lab's assistants. <Link to="/history">See your test results</Link></EmptyCard></Page>;
  }

  var open = formulations.filter(isOpen);
  var n = function (s) { return open.filter(function (f) { return f.status === s; }).length; };
  var query = q.trim().toLowerCase();
  var shown = open.filter(function (f) {
    if (stage && f.status !== stage) return false;
    if (urgentOnly && f.priority !== "urgent") return false;
    var haystack = [f.name, f.code, f.description].concat((f.materials || []).map(function (m) { return m.name; }));
    if (query && !haystack.some(function (s) { return s && s.toLowerCase().indexOf(query) >= 0; })) return false;
    return true;
  });

  return (
    <Page>
      <div className="page-head">
        <h1>Test Queue</h1>
        <p>Formulations Hi‑Tech Company has sent for testing, urgent first and then the longest waiting. Open one to conduct its tests, record the results and send them back.</p>
      </div>
      <div className="page-stack">
        <Tiles tiles={[
          { label: "To start", value: n("submitted"), sub: "new from Hi‑Tech Company" },
          { label: "In testing", value: n("in_testing"), sub: "some tests recorded" },
          { label: "Ready to release", value: n("review"), sub: "all tests recorded" },
          { label: "On hold", value: n("on_hold"), sub: "waiting on Hi‑Tech Company" },
          { label: "Urgent", value: open.filter(function (f) { return f.priority === "urgent"; }).length, sub: "open and flagged urgent" }
        ]} />

        <div className="card">
          <div className="filter-bar">
            <input type="search" value={q} onChange={function (e) { setQ(e.target.value); }} placeholder="Search name, code or raw material" aria-label="Search" />
            <select value={stage} onChange={function (e) { setStage(e.target.value); }} aria-label="Stage">
              <option value="">All open work</option>
              <option value="submitted">To start</option>
              <option value="in_testing">In testing</option>
              <option value="review">Ready to release</option>
              <option value="on_hold">On hold</option>
            </select>
            <label className="check-item"><input type="checkbox" checked={urgentOnly} onChange={function (e) { setUrgentOnly(e.target.checked); }} /> Urgent only</label>
            <span className="spec-line">{shown.length} of {open.length} open</span>
          </div>
        </div>

        <div id="q-sections">
          {SECTIONS.map(function (s) {
            var items = shown.filter(function (f) { return f.status === s.status; }).sort(queueOrder);
            if (!items.length) return null;
            return (
              <section className="qsection" key={s.status}>
                <div className="qsection-head"><h2>{s.title} <span className="col-count">{items.length}</span></h2><span className="spec-line">{s.hint}</span></div>
                {items.map(function (f) { return <QueueItem key={f.id} f={f} results={results} />; })}
              </section>
            );
          })}
        </div>
        {loaded && !shown.length && (
          open.length ? <EmptyCard>Nothing matches these filters.</EmptyCard>
            : <EmptyCard title="Queue is clear">Nothing is waiting from Hi‑Tech Company. New formulations appear here as soon as they are sent.</EmptyCard>
        )}
      </div>
    </Page>
  );
}
