// The board: tiles, a column per stage, and the results sent back. Both
// sides see the same board. Clicking a card or a released result opens it
// in the detail panel, which has each side's controls.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Page } from "../components/Layout.jsx";
import { Badge, Tiles } from "../components/bits.jsx";
import FormulationDetail from "../components/FormulationDetail.jsx";
import { useData, resultsFor } from "../context/data.jsx";
import { useSession } from "../context/session.jsx";
import { fmtDate, reportPath, daysBetween, TEST_META, STATUSES, STATUS_LABEL } from "../lib/format.js";

function boardTiles(all) {
  var open = all.filter(function (f) { return f.status !== "released"; });
  var released = all.filter(function (f) { return f.status === "released"; });
  var turnarounds = released.map(function (f) { return daysBetween(f.submittedAt, f.releasedAt); }).filter(function (d) { return d != null; });
  var avg = turnarounds.length ? Math.round(10 * turnarounds.reduce(function (a, b) { return a + b; }, 0) / turnarounds.length) / 10 : null;
  return [
    { label: "In the pipeline", value: open.length, sub: all.length + " sent in total" },
    { label: "Urgent & open", value: open.filter(function (f) { return f.priority === "urgent"; }).length, sub: "flagged by Hi‑Tech Company" },
    { label: "Awaiting release", value: all.filter(function (f) { return f.status === "review"; }).length, sub: "tested, report not yet sent" },
    { label: "Avg. turnaround", value: avg == null ? "—" : avg + "d", sub: "sent in → results released" },
    { label: "Results sent back", value: released.length, sub: "test reports issued" }
  ];
}

function Chips({ f, results }) {
  var rs = resultsFor(results, f.id);
  return (f.requestedTests || []).map(function (t) {
    var r = rs.find(function (x) { return x.testType === t; });
    var cls = "", mark = "";
    if (r) { cls = r.result === "fail" ? "fail" : "done"; mark = r.result === "fail" ? " ✗" : " ✓"; }
    else if ((f.testsDone || []).indexOf(t) >= 0) { cls = "logged"; mark = " ✓"; } // tested; grade not released yet
    return <span key={t} className={"chip " + cls}>{TEST_META[t].chip}{mark}</span>;
  });
}

export default function Board() {
  var { formulations, results, loaded, error } = useData();
  var { user } = useSession();
  var [openId, setOpenId] = useState(null);
  var [outcome, setOutcome] = useState("");
  var detailRef = useRef(null);
  var opened = formulations.find(function (f) { return f.id === openId; });

  useEffect(function () { document.title = "Formulation Test Tracker"; }, []);
  // A formulation that went away (withdrawn) closes its panel.
  useEffect(function () { if (openId && loaded && !opened) setOpenId(null); }, [openId, loaded, opened]);

  function open(id) {
    setOpenId(id);
    setTimeout(function () {
      if (detailRef.current) detailRef.current.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    });
  }

  var released = formulations.filter(function (f) { return f.status === "released"; });
  var archive = released.slice()
    .sort(function (a, b) { return new Date(b.releasedAt || 0) - new Date(a.releasedAt || 0); })
    .filter(function (f) { return !outcome || f.outcome === outcome; });

  return (
    <Page>
      {error && <div className="card"><div className="empty">{error.message}</div></div>}
      <Tiles tiles={boardTiles(formulations)} />

      <div className="card">
        <div className="card-head">
          <h2>Formulation board</h2>
          {user.role === "company" && <Link className="btn primary small" to="/add">+ Add formulation</Link>}
        </div>
        <div className="board-hint">Scroll sideways to see all five stages →</div>
        <div className="board">
          {STATUSES.map(function (s) {
            var items = formulations.filter(function (f) { return f.status === s; })
              .sort(function (a, b) { return new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0); });
            return (
              <div className="col" key={s}>
                <div className="col-head"><h3>{STATUS_LABEL[s]}</h3><span className="col-count">{items.length}</span></div>
                {items.length ? items.map(function (f) {
                  var done = (f.testsDone || []).length, total = (f.requestedTests || []).length;
                  return (
                    <div className="fcard" key={f.id} role="button" tabIndex={0} onClick={function () { open(f.id); }}
                      onKeyDown={function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(f.id); } }}>
                      <div className="fcard-top">
                        <div><div className="fcard-name">{f.name}</div><div className="fcard-code mono">{f.code}</div></div>
                        {f.priority === "urgent" && <span className="urgent-flag">Urgent</span>}
                      </div>
                      {f.status === "on_hold" && f.holdReason && <div className="hold-note">{f.holdReason}</div>}
                      <div className="chips"><Chips f={f} results={results} /></div>
                      <div className="fcard-meta">
                        <span>{fmtDate(f.submittedAt)}</span>
                        {f.status === "released" ? <span className="mono">{f.reportNo}</span> : <span>{done}/{total} tested</span>}
                      </div>
                    </div>
                  );
                }) : <div className="col-empty">{loaded ? "Nothing here" : "Loading…"}</div>}
              </div>
            );
          })}
        </div>
      </div>

      <div ref={detailRef}>
        {opened && <FormulationDetail key={opened.id} f={opened} onClose={function () { setOpenId(null); }} onWithdrawn={function () { setOpenId(null); }} />}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Results sent back</h2>
          <div className="filters">
            <select value={outcome} onChange={function (e) { setOutcome(e.target.value); }} aria-label="Outcome">
              <option value="">Any outcome</option>
              <option value="pass">All tests passed</option>
              <option value="fail">One or more failed</option>
              <option value="recorded">Recorded only (no spec)</option>
            </select>
          </div>
        </div>
        <div className="table-scroll">
          <table className="archive-table">
            <thead><tr><th>Report no.</th><th>Formulation</th><th>Code</th><th>Outcome</th><th>Sent in</th><th>Released</th><th>Turnaround</th><th></th></tr></thead>
            <tbody>
              {archive.map(function (f) {
                var days = daysBetween(f.submittedAt, f.releasedAt);
                return (
                  <tr className="archive-row" key={f.id} onClick={function (e) { if (!e.target.closest("a")) open(f.id); }}>
                    <td className="a-report mono" data-label="Report no.">{f.reportNo}</td>
                    <td className="a-name"><b>{f.name}</b></td>
                    <td className="a-code mono" data-label="Code">{f.code}</td>
                    <td className="a-outcome"><Badge result={f.outcome} /></td>
                    <td className="a-sent" data-label="Sent in">{fmtDate(f.submittedAt)}</td>
                    <td className="a-released" data-label="Released">{fmtDate(f.releasedAt)}</td>
                    <td className="a-turn mono" data-label="Turnaround">{days != null ? days + "d" : "—"}</td>
                    <td className="a-link"><a href={reportPath(f)} target="_blank" rel="noopener">Report</a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!archive.length && (
          <div className="empty">
            {released.length ? <div>No released results match this filter.</div>
              : <><div className="big">No results sent back yet</div><div>Once the lab releases a formulation's results, its test report appears here.</div></>}
          </div>
        )}
      </div>
    </Page>
  );
}
