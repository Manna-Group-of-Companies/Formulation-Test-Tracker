// The printable test report (/report/:id): the document the lab sends back
// to Hi-Tech Company. Hi-Tech Company can open it once the lab has released
// the results; the lab can open it at any time to preview, and until
// release it is marked DRAFT. It prints on A4 without the toolbar.

import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router";
import { useSession } from "../context/session.jsx";
import { api } from "../lib/api.js";
import { fmtDate, specText, valueSummary, daysBetween, TEST_META, OUTCOME_TEXT, REACTOR_FIELDS, materialsTotal } from "../lib/format.js";
import "../styles/report.css";

function Verdict({ result }) {
  var label = { pass: "Pass", fail: "Fail", recorded: "Recorded" }[result] || "Pending";
  return <span className={"verdict " + (result || "pending")}>{label}</span>;
}

function Kv({ label, cls, children }) {
  return <div className="kv"><span className="k">{label}</span><span className={"v " + (cls || "")}>{children}</span></div>;
}

function Sheet({ data }) {
  var f = data.formulation;
  var released = f.status === "released";
  var days = daysBetween(f.submittedAt, f.releasedAt);
  var reactor = f.reactor || {};
  var hasReactor = REACTOR_FIELDS.some(function (r) { return reactor[r.key] != null; });
  return (
    <>
      <header className="rh">
        <div><div className="org">Manna Rubber Park</div><div className="org-sub">Laboratory · Test report</div></div>
        <div className="rh-meta">
          <Kv label="Report no." cls="mono">{f.reportNo || "Assigned on release"}</Kv>
          <Kv label="Revision">{f.revision ? String(f.revision) : "—"}</Kv>
          <Kv label="Issued">{released ? fmtDate(f.releasedAt) : "Not issued"}</Kv>
        </div>
      </header>

      {!released && <div className="draft">Draft — not yet released to Hi‑Tech Company</div>}

      <section className="grid">
        <Kv label="Client">Hi‑Tech Company</Kv>
        <Kv label="Sent in by">{(f.submittedByName || "Unknown") + ", " + fmtDate(f.submittedAt)}</Kv>
        <Kv label="Formulation">{f.name}</Kv>
        <Kv label="Formulation / batch code" cls="mono">{f.code}</Kv>
        <Kv label="Priority">{f.priority === "urgent" ? "Urgent" : "Normal"}</Kv>
        <Kv label="Turnaround">{days != null ? days + (days === 1 ? " day" : " days") : "—"}</Kv>
      </section>

      {(f.materials || []).length > 0 && (
        <section>
          <h3>Raw materials (% of charge)</h3>
          <ul className="recipe-list">
            {f.materials.map(function (m, i) { return <li key={i}><span>{m.name}</span><span className="mono">{m.percent != null ? m.percent + " %" : "—"}</span></li>; })}
            <li className="recipe-total"><span>Total</span><span className="mono">{materialsTotal(f.materials)} %</span></li>
          </ul>
        </section>
      )}
      {hasReactor && (
        <section>
          <h3>Reactor conditions</h3>
          <div className="grid">
            {REACTOR_FIELDS.map(function (r) { return <Kv key={r.key} label={r.label} cls="mono">{reactor[r.key] != null ? reactor[r.key] + " " + r.unit : "—"}</Kv>; })}
          </div>
        </section>
      )}
      {f.description && <section><h3>Notes</h3><p>{f.description}</p></section>}

      <section>
        <h3>Results</h3>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Test</th><th>Specimen / lot</th><th>Measured</th><th>Specification</th><th>Verdict</th><th>Tested</th></tr></thead>
            <tbody>
              {(f.requestedTests || []).map(function (type) {
                var r = data.results.find(function (x) { return x.testType === type; });
                // Class + data-label let phones show each test as a labelled block.
                return (
                  <tr key={type}>
                    <td className="r-test"><b>{TEST_META[type].label}</b>{r && r.notes && <div className="note">{r.notes}</div>}</td>
                    <td className="r-specimen mono" data-label="Specimen / lot">{(r && r.specimenId) || "—"}</td>
                    <td className="r-measured" data-label="Measured">{r ? valueSummary(r) : "Not recorded"}</td>
                    <td className="r-spec" data-label="Specification">{specText(f.specs, type)}</td>
                    <td className="r-verdict"><Verdict result={r && r.result} /></td>
                    <td className="r-tested" data-label="Tested">{r ? <>{fmtDate(r.testedAt)}<div className="note">{r.testedByName || ""}</div></> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="outcome">
        <h3>Overall outcome</h3>
        <div className="outcome-row"><Verdict result={f.outcome} /><p>{f.outcome ? OUTCOME_TEXT[f.outcome] : "Not every requested test has been recorded yet."}</p></div>
      </section>

      {f.labRemarks && <section><h3>Lab remarks</h3><p className="remarks">{f.labRemarks}</p></section>}

      <section className="sign grid">
        <Kv label="Released by">{released ? <>{f.releasedByName || "Unknown"}<div className="note">Manna Rubber Park Laboratory</div></> : "—"}</Kv>
        <Kv label="Release date">{released ? fmtDate(f.releasedAt) : "—"}</Kv>
      </section>

      <p className="fine">Results relate only to the samples tested. Pass/fail is judged against the acceptance limits Hi‑Tech Company supplied with the formulation; a test without limits is recorded only. Generated by the Formulation Test Tracker.</p>
    </>
  );
}

export default function Report() {
  var { id } = useParams();
  var { user, ready } = useSession();
  var location = useLocation();
  var [data, setData] = useState(null);
  var [error, setError] = useState("");

  useEffect(function () {
    if (!user) return;
    api.report(id).then(function (d) {
      setData(d);
      document.title = (d.formulation.reportNo ? d.formulation.reportNo + " · " : "") + d.formulation.name + " — Test report";
    }, function (err) { if (!err.signedOut) setError(err.message || "Could not load the report."); });
  }, [id, user]);

  if (ready && !user) return <Navigate to={"/login?next=" + encodeURIComponent(location.pathname)} replace />;

  return (
    <div className="report-root">
      <div className="toolbar no-print">
        <Link to="/" className="tb-link">← Back to the tracker</Link>
        <button className="tb-btn" disabled={!data} onClick={function () { window.print(); }}>Print / save as PDF</button>
      </div>
      <article className="sheet">
        {error ? <p className="error">{error} <Link to="/">Go to the tracker</Link></p>
          : data ? <Sheet data={data} /> : <p className="loading">Loading report…</p>}
      </article>
    </div>
  );
}
