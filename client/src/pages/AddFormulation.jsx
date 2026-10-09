// What Hi-Tech Company fills in to send a formulation to the Manna lab: what
// it is, the reactor recipe (raw materials as % of the charge, reactor
// conditions), which tests to run, and optional acceptance limits for each
// test. The lab's results are graded pass/fail against those limits.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Page } from "../components/Layout.jsx";
import { EmptyCard } from "../components/bits.jsx";
import { useSession } from "../context/session.jsx";
import { useData } from "../context/data.jsx";
import { api } from "../lib/api.js";
import { num, TEST_META, TEST_TYPES, MATERIAL_DEFAULTS, REACTOR_FIELDS, materialsTotal } from "../lib/format.js";

var nextRowId = 1;
function newRow(name) { return { id: nextRowId++, name: name || "", percent: "" }; }
function defaultRows() { return MATERIAL_DEFAULTS.map(newRow); }

function defaultTests() {
  var t = {};
  TEST_TYPES.forEach(function (type) { t[type] = { on: !!TEST_META[type].defaultOn, min: "", max: "", scale: "" }; });
  return t;
}

function emptyForm() {
  return { name: "", code: "", priority: "normal", description: "", rows: defaultRows(), reactor: {}, tests: defaultTests() };
}

// Rows with neither a name nor a percentage are left out, and so are the
// standard materials left without a percentage.
function readMaterials(rows) {
  return rows.map(function (r) { return { name: r.name.trim(), percent: num(r.percent) }; })
    .filter(function (m) { return m.name || m.percent != null; })
    .filter(function (m) { return m.percent != null || MATERIAL_DEFAULTS.indexOf(m.name) < 0; });
}

function materialsProblem(list) {
  for (var i = 0; i < list.length; i++) {
    if (!list[i].name) return "Give a name for the material at " + list[i].percent + " %.";
    if (list[i].percent == null) return "Enter the percentage for " + list[i].name + ", or remove it.";
    if (list[i].percent < 0) return list[i].name + ": the percentage can't be negative.";
  }
  if (materialsTotal(list) > 100) return "The raw materials add up to more than 100 %.";
  return "";
}

export default function AddFormulation() {
  var { user } = useSession();
  var { reload } = useData();
  var [form, setForm] = useState(emptyForm);
  var [error, setError] = useState("");
  var [busy, setBusy] = useState(false);
  var [sent, setSent] = useState(null);
  var nameRef = useRef(null);

  useEffect(function () { document.title = "Add Formulation — Formulation Test Tracker"; }, []);
  useEffect(function () { if (!sent && nameRef.current) nameRef.current.focus(); }, [sent]);

  if (user.role !== "company") {
    return <Page narrow><EmptyCard title="Hi‑Tech Company only">Formulations are sent in by Hi‑Tech Company. <Link to="/">Back to the board</Link></EmptyCard></Page>;
  }

  function set(key, value) { setForm(function (f) { return Object.assign({}, f, { [key]: value }); }); }
  function setRow(id, key, value) {
    set("rows", form.rows.map(function (r) { return r.id === id ? Object.assign({}, r, { [key]: value }) : r; }));
  }
  function setTest(type, key, value) {
    set("tests", Object.assign({}, form.tests, { [type]: Object.assign({}, form.tests[type], { [key]: value }) }));
  }

  var materials = readMaterials(form.rows);
  var total = materialsTotal(materials);

  function submit(e) {
    e.preventDefault();
    setError("");
    var requested = [], specs = {};
    TEST_TYPES.forEach(function (type) {
      var t = form.tests[type], m = TEST_META[type];
      if (!t.on) return;
      requested.push(type);
      specs[m.min] = num(t.min);
      specs[m.max] = num(t.max);
      if (m.scaleSpec) specs[m.scaleSpec] = t.scale || null;
    });
    if (!requested.length) { setError("Choose at least one test."); return; }
    var problem = materialsProblem(materials);
    if (!problem) {
      for (var i = 0; i < requested.length; i++) {
        var m = TEST_META[requested[i]], lo = specs[m.min], hi = specs[m.max];
        if (lo != null && hi != null && lo > hi) { problem = m.label + ": the minimum is higher than the maximum."; break; }
      }
    }
    if (problem) { setError(problem); return; }

    var reactor = {};
    REACTOR_FIELDS.forEach(function (r) { reactor[r.key] = num(form.reactor[r.key]); });
    setBusy(true);
    api.submit({
      name: form.name.trim(), code: form.code.trim(), description: form.description.trim(), priority: form.priority,
      requestedTests: requested, specs: specs, materials: materials, reactor: reactor
    }).then(function (f) {
      setSent(f);
      window.scrollTo(0, 0);
      reload();
    }, function (err) {
      setError(err.message || "Could not send — try again");
    }).finally(function () { setBusy(false); });
  }

  if (sent) {
    return (
      <Page narrow>
        <div className="page-head"><h1>Add Formulation</h1></div>
        <div className="card done-card">
          <div className="done-mark">✓</div>
          <h2>Sent to the Manna lab</h2>
          <p className="spec-line"><b>{sent.name}</b> <span className="mono">{sent.code}</span> is in the lab's Submitted column. Follow its progress on the board; the results appear under Test Result History once the lab releases them.</p>
          <div className="action-row">
            <button className="btn primary" onClick={function () { setForm(emptyForm()); setSent(null); }}>Add another formulation</button>
            <Link className="btn" to="/">Go to the board</Link>
            <Link className="btn" to="/history">Test Result History</Link>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page narrow>
      <div className="page-head">
        <h1>Add Formulation</h1>
        <p>Send a formulation to the Manna Rubber Park lab for testing. It appears on the lab's board straight away.</p>
      </div>

      <form className="card" id="add-form" onSubmit={submit}>
        <section className="form-section">
          <h2>Formulation</h2>
          <div className="grid2">
            <div className="field"><label htmlFor="af-name">Formulation name</label>
              <input ref={nameRef} required id="af-name" placeholder="e.g. Whole Tyre Reclaim – Trial 3" value={form.name} onChange={function (e) { set("name", e.target.value); }} /></div>
            <div className="field"><label htmlFor="af-code">Formulation / batch code</label>
              <input required id="af-code" placeholder="e.g. HTC-R-0301" value={form.code} onChange={function (e) { set("code", e.target.value); }} /></div>
          </div>
          <div className="field" style={{ marginTop: 12 }}><label>Priority</label>
            <div className="check-row">
              {["normal", "urgent"].map(function (p) {
                return <label className="check-item" key={p}><input type="radio" name="af-priority" value={p} checked={form.priority === p} onChange={function () { set("priority", p); }} /> {p === "normal" ? "Normal" : "Urgent"}</label>;
              })}
            </div>
          </div>
        </section>

        <section className="form-section">
          <h2>Raw materials</h2>
          <p className="spec-line">Each material as a percentage of the reactor charge. Leave a row empty to skip it.</p>
          <div className="field material-rows">
            {form.rows.map(function (r) {
              return (
                <div className="material-row" key={r.id}>
                  <input className="mr-name" aria-label="Material" placeholder="Material" value={r.name} onChange={function (e) { setRow(r.id, "name", e.target.value); }} />
                  <div className="mr-pct">
                    <input className="mr-percent" type="number" step="any" min="0" max="100" aria-label={"Percent " + (r.name || "")} placeholder="0"
                      value={r.percent} onChange={function (e) { setRow(r.id, "percent", e.target.value); }} />
                    <span>%</span>
                  </div>
                  <button type="button" className="btn ghost small mr-remove" aria-label={"Remove " + (r.name || "material")}
                    onClick={function () { set("rows", form.rows.filter(function (x) { return x.id !== r.id; })); }}>✕</button>
                </div>
              );
            })}
          </div>
          <div className="material-foot">
            <button type="button" className="btn ghost small" onClick={function () { set("rows", form.rows.concat([newRow("")])); }}>+ Add material</button>
            {materials.length > 0 && (
              <span className={"material-total" + (total === 100 ? "" : " off")} aria-live="polite">
                Total {total} %{total === 100 ? " ✓" : " — should add up to 100 %"}
              </span>
            )}
          </div>
        </section>

        <section className="form-section">
          <h2>Reactor conditions</h2>
          <div className="grid2">
            {REACTOR_FIELDS.map(function (r) {
              return (
                <div className="field" key={r.key}>
                  <label htmlFor={"af-r-" + r.key}>{r.label} ({r.unit})</label>
                  <input id={"af-r-" + r.key} type="number" step="any" value={form.reactor[r.key] || ""}
                    onChange={function (e) { set("reactor", Object.assign({}, form.reactor, { [r.key]: e.target.value })); }} />
                </div>
              );
            })}
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="af-desc">Notes for the lab (optional)</label>
            <textarea id="af-desc" rows={3} placeholder="Anything else the lab should know" value={form.description} onChange={function (e) { set("description", e.target.value); }} />
          </div>
        </section>

        <section className="form-section">
          <h2>Tests and acceptance limits</h2>
          <p className="spec-line">Choose the tests you need. Limits are optional; without them the lab records the value but doesn't grade it pass or fail.</p>
          {TEST_TYPES.map(function (type) {
            var m = TEST_META[type], t = form.tests[type], u = m.unit ? " (" + m.unit + ")" : "";
            return (
              <div className={"test-option" + (t.on ? "" : " off")} key={type}>
                <label className="check-item"><input type="checkbox" id={"af-t-" + type} checked={t.on} onChange={function (e) { setTest(type, "on", e.target.checked); }} /> {m.label}</label>
                <div className={(m.scaleSpec ? "grid3" : "grid2") + " limits"}>
                  {m.scaleSpec && (
                    <div className="field"><label htmlFor={"af-" + type + "-scale"}>Scale</label>
                      <select id={"af-" + type + "-scale"} disabled={!t.on} value={t.scale} onChange={function (e) { setTest(type, "scale", e.target.value); }}>
                        <option value="">—</option>
                        {m.second.options.map(function (o) { return <option key={o}>{o}</option>; })}
                      </select></div>
                  )}
                  <div className="field"><label htmlFor={"af-" + type + "-min"}>Minimum{u}</label>
                    <input id={"af-" + type + "-min"} type="number" step="any" disabled={!t.on} value={t.min} onChange={function (e) { setTest(type, "min", e.target.value); }} /></div>
                  <div className="field"><label htmlFor={"af-" + type + "-max"}>Maximum{u}</label>
                    <input id={"af-" + type + "-max"} type="number" step="any" disabled={!t.on} value={t.max} onChange={function (e) { setTest(type, "max", e.target.value); }} /></div>
                </div>
              </div>
            );
          })}
        </section>

        <div className="form-error" role="alert">{error}</div>
        <div className="form-actions">
          <Link className="btn ghost" to="/">Cancel</Link>
          <button type="submit" className="btn primary" disabled={busy}>Send to Manna lab</button>
        </div>
      </form>
    </Page>
  );
}
