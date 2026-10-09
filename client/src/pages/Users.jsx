// Everyone who can sign in, by side. An administrator adds people with a
// name, side and PIN, gives someone a new PIN, makes or unmakes
// administrators, and removes accounts. A new PIN signs that person out of
// their other browsers. The changes go through the ftt-admin-users Edge
// Function, which holds the key that manages Supabase Auth accounts.

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Page } from "../components/Layout.jsx";
import { EmptyCard } from "../components/bits.jsx";
import { useSession } from "../context/session.jsx";
import { useToast } from "../context/toast.jsx";
import { api, adminUsers } from "../lib/api.js";
import { PIN_PATTERN, randomPin } from "../lib/auth.js";
import { fmtDate } from "../lib/format.js";

var SIDES = [
  { role: "company", title: "Hi‑Tech Company" },
  { role: "lab", title: "Manna Rubber Park Lab" }
];

function digits(v) { return v.replace(/\D/g, ""); }

function PinField({ id, value, onChange, autoFocus }) {
  return (
    <div className="code-wrap">
      <input id={id} className="mono" inputMode="numeric" maxLength={8} autoComplete="off" placeholder="4–8 digits" autoFocus={autoFocus}
        value={value} onChange={function (e) { onChange(digits(e.target.value)); }} />
      <button type="button" className="btn ghost small code-toggle" onClick={function () { onChange(randomPin()); }}>New</button>
    </div>
  );
}

function UserRow({ u, me, reload, resetting, setResetting }) {
  var toast = useToast();
  var navigate = useNavigate();
  var { refresh } = useSession();
  var [pin, setPin] = useState("");
  var [error, setError] = useState("");
  var isMe = u.id === me.id;

  function toggleAdmin() {
    adminUsers("update", { id: u.id, admin: !u.admin }).then(function (nu) {
      toast(nu.admin ? nu.name + " is now an administrator" : nu.name + " is no longer an administrator");
      if (isMe && !nu.admin) { refresh(); navigate("/"); return; }
      return reload();
    }, function (err) { toast(err.message || "Could not change that"); });
  }

  function remove() {
    if (!confirm("Remove " + u.name + "? They won't be able to sign in any more. What they sent or recorded stays.")) return;
    adminUsers("delete", { id: u.id }).then(function () {
      toast("Removed " + u.name);
      return reload();
    }, function (err) { toast(err.message || "Could not remove " + u.name); });
  }

  function savePin(e) {
    e.preventDefault();
    if (!PIN_PATTERN.test(pin)) { setError("A PIN is 4 to 8 digits."); return; }
    adminUsers("update", { id: u.id, pin: pin }).then(function () {
      setResetting(null);
      toast("New PIN saved for " + u.name + " — " + pin);
      return reload();
    }, function (err) { setError(err.message || "Could not save the PIN"); });
  }

  return (
    <li className="user-row">
      <div className="user-main">
        <b>{u.name}</b>{isMe && <> <span className="hint">(you)</span></>}
        {u.admin && <> <span className="status-pill review">Administrator</span></>}
        <div className="spec-line">Added {fmtDate(u.createdAt)}</div>
      </div>
      <div className="user-actions">
        <button type="button" className="btn small" onClick={function () { setPin(""); setError(""); setResetting(resetting === u.id ? null : u.id); }}>Change PIN</button>
        <button type="button" className="btn small" onClick={toggleAdmin}>{u.admin ? "Remove admin" : "Make admin"}</button>
        {!isMe && <button type="button" className="btn small danger" onClick={remove}>Remove</button>}
      </div>
      {resetting === u.id && (
        <form className="inline-form user-pin-form" noValidate onSubmit={savePin}>
          <div className="field">
            <label htmlFor={"pin-" + u.id}>New PIN for {u.name}</label>
            <PinField id={"pin-" + u.id} value={pin} onChange={setPin} autoFocus />
          </div>
          <div className="form-error" role="alert">{error}</div>
          <div className="form-actions">
            <button type="button" className="btn ghost" onClick={function () { setResetting(null); }}>Cancel</button>
            <button type="submit" className="btn primary">Save PIN</button>
          </div>
        </form>
      )}
    </li>
  );
}

export default function Users() {
  var { user } = useSession();
  var toast = useToast();
  var [users, setUsers] = useState(null);
  var [resetting, setResetting] = useState(null);
  var [form, setForm] = useState({ name: "", role: "company", pin: "", admin: false });
  var [error, setError] = useState("");
  var [busy, setBusy] = useState(false);

  var reload = useCallback(function () {
    return api.listUsers().then(setUsers, function (err) { toast(err.message || "Could not load the accounts"); });
  }, [toast]);

  useEffect(function () { document.title = "Users — Formulation Test Tracker"; }, []);
  useEffect(function () { if (user.admin) reload(); }, [user.admin, reload]);

  if (!user.admin) {
    return <Page narrow><EmptyCard title="Administrators only">Ask an administrator to add people or change a PIN. <Link to="/">Back to the board</Link></EmptyCard></Page>;
  }

  function set(key, value) { setForm(function (f) { return Object.assign({}, f, { [key]: value }); }); }

  function add(e) {
    e.preventDefault();
    setError("");
    var data = { name: form.name.trim(), role: form.role, pin: form.pin.trim(), admin: form.admin };
    if (!data.name) { setError("Enter the person's name."); return; }
    if (!PIN_PATTERN.test(data.pin)) { setError("Give them a PIN of 4 to 8 digits, or press New."); return; }
    setBusy(true);
    adminUsers("create", data).then(function (u) {
      toast("Added " + u.name + " — PIN " + data.pin);
      setForm({ name: "", role: form.role, pin: "", admin: false });
      return reload();
    }, function (err) {
      setError(err.message || "Could not add — try again");
    }).finally(function () { setBusy(false); });
  }

  return (
    <Page narrow>
      <div className="page-head">
        <h1>Users</h1>
        <p>Everyone who can sign in. Each person signs in with their name and PIN, and their side decides what they can do.</p>
      </div>

      <form className="card" noValidate onSubmit={add}>
        <section className="form-section">
          <h2>Add a person</h2>
          <div className="grid2">
            <div className="field"><label htmlFor="u-name">Name</label>
              <input id="u-name" autoComplete="off" spellCheck="false" placeholder="e.g. R. Menon" value={form.name} onChange={function (e) { set("name", e.target.value); }} /></div>
            <div className="field"><label htmlFor="u-role">Side</label>
              <select id="u-role" value={form.role} onChange={function (e) { set("role", e.target.value); }}>
                <option value="company">Hi‑Tech Company</option>
                <option value="lab">Manna Rubber Park Lab</option>
              </select></div>
            <div className="field"><label htmlFor="u-pin">PIN</label><PinField id="u-pin" value={form.pin} onChange={function (v) { set("pin", v); }} /></div>
            <div className="field"><label>&nbsp;</label>
              <label className="check-item"><input type="checkbox" checked={form.admin} onChange={function (e) { set("admin", e.target.checked); }} /> Administrator</label></div>
          </div>
        </section>
        <div className="form-error" role="alert">{error}</div>
        <div className="form-actions"><button type="submit" className="btn primary" disabled={busy}>Add person</button></div>
      </form>

      {SIDES.map(function (s) {
        var mine = (users || []).filter(function (u) { return u.role === s.role; });
        return (
          <div className="card" key={s.role}>
            <div className="card-head"><h2>{s.title}</h2><span className="hint">{users ? mine.length + (mine.length === 1 ? " person" : " people") : "Loading…"}</span></div>
            {mine.length
              ? <ul className="user-list">{mine.map(function (u) { return <UserRow key={u.id} u={u} me={user} reload={reload} resetting={resetting} setResetting={setResetting} />; })}</ul>
              : users && <div className="empty">Nobody yet — add someone above.</div>}
          </div>
        );
      })}
    </Page>
  );
}
