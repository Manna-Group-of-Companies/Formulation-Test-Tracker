// Everyone signs in here with their own name and PIN. Accounts are made by
// an administrator on the Users page, and each belongs to one side (Hi-Tech
// Company or the Manna lab), so nobody picks a side here. Other pages send
// people here with ?next=<path> and get them back afterwards.

import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { useSession } from "../context/session.jsx";
import { signIn, PIN_PATTERN } from "../lib/auth.js";

// Where each side lands when they didn't ask for a particular page.
var HOME = { company: "/", lab: "/queue" };

function destination(next, role) {
  // Only our own pages may be returned to.
  return next && /^\/(?!\/)/.test(next) && !next.startsWith("/login") ? next : HOME[role];
}

// The name (never the PIN) is remembered for next time, in this browser only.
function remembered() {
  try { return (JSON.parse(localStorage.getItem("ftt-login")) || {}).name || ""; } catch (e) { return ""; }
}
function remember(name) {
  try { localStorage.setItem("ftt-login", JSON.stringify({ name: name })); } catch (e) { /* private window */ }
}

export default function Login() {
  var { user, ready, refresh } = useSession();
  var [params] = useSearchParams();
  var navigate = useNavigate();
  var [name, setName] = useState(remembered);
  var [pin, setPin] = useState("");
  var [showPin, setShowPin] = useState(false);
  var [error, setError] = useState("");
  var [busy, setBusy] = useState(false);
  var nameRef = useRef(null), pinRef = useRef(null);
  var next = params.get("next");

  useEffect(function () { document.title = "Sign in — Formulation Test Tracker"; }, []);
  useEffect(function () { if (ready) (name ? pinRef : nameRef).current?.focus(); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ready && user) return <Navigate to={destination(next, user.role)} replace />;

  var notice = params.has("signedout") ? "You've signed out."
    : params.has("expired") ? "Your sign-in has ended. Please sign in again." : "";

  async function submit(e) {
    e.preventDefault();
    setError("");
    var n = name.trim(), p = pin.trim();
    if (!n) { setError("Enter your name."); nameRef.current.focus(); return; }
    if (!PIN_PATTERN.test(p)) { setError("Enter your PIN — 4 to 8 digits."); pinRef.current.focus(); return; }
    setBusy(true);
    try {
      await signIn(n, p);
      var me = await refresh();
      if (!me) throw new Error("This account has no access to the tracker. Ask an administrator.");
      remember(me.name);
      navigate(destination(next, me.role), { replace: true });
    } catch (err) {
      setError(err.message || "Could not sign in — try again");
      setPin("");
      pinRef.current?.focus();
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <main className="login">
        <section className="login-intro">
          <div className="login-brand">
            <div className="login-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3h6" /><path d="M10 3v6.5L4.8 18.2A2 2 0 0 0 6.5 21h11a2 2 0 0 0 1.7-2.8L14 9.5V3" /><path d="M7.5 15h9" /></svg>
            </div>
            <div>
              <div className="login-name">Formulation Test Tracker</div>
              <div className="login-sub">Hi‑Tech Company × Manna Rubber Park Laboratory</div>
            </div>
          </div>
          <h1>From formulation to test report, in one place.</h1>
          <ol className="login-steps">
            <li><b>Hi‑Tech Company sends a formulation</b><span>The reactor recipe, the tests needed and the acceptance limits.</span></li>
            <li><b>Manna lab assistants test it</b><span>Each result is graded pass or fail against those limits.</span></li>
            <li><b>The results come back</b><span>A numbered test report, on Hi‑Tech's screen the moment the lab releases it.</span></li>
          </ol>
        </section>

        <section className="login-panel">
          <form className="login-card" onSubmit={submit} noValidate>
            <h2>Sign in</h2>
            {notice && <p className="login-notice" role="status">{notice}</p>}

            <div className="field" style={{ marginTop: 18 }}>
              <label htmlFor="si-name">Name</label>
              <input ref={nameRef} id="si-name" name="username" autoComplete="username" spellCheck="false" placeholder="e.g. R. Menon"
                value={name} onChange={function (e) { setName(e.target.value); }} />
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="si-pin">PIN</label>
              <div className="code-wrap">
                <input ref={pinRef} id="si-pin" name="password" type={showPin ? "text" : "password"} className="mono" inputMode="numeric" pattern="[0-9]*" maxLength={8}
                  autoComplete="current-password" placeholder="4–8 digits" value={pin}
                  onChange={function (e) { setPin(e.target.value.replace(/\D/g, "")); }} />
                <button type="button" className="btn ghost small code-toggle" aria-controls="si-pin" aria-pressed={showPin}
                  onClick={function () { setShowPin(!showPin); pinRef.current.focus(); }}>{showPin ? "Hide" : "Show"}</button>
              </div>
            </div>

            <div className="form-error" role="alert">{error}</div>
            <button type="submit" className="btn primary login-submit" disabled={busy || !ready}>{busy ? "Signing in…" : "Sign in"}</button>

            <p className="login-help">Use the name and PIN your administrator gave you. No account yet, or forgotten your PIN? Ask an administrator.</p>
          </form>
        </section>
      </main>
    </div>
  );
}
