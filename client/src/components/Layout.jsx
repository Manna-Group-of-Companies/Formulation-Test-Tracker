// The signed-in pages: top bar with who is signed in and the page links
// for their side, then the page. Signed-out visitors go to the login page,
// which brings them back here afterwards.

import { useEffect } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router";
import { useSession } from "../context/session.jsx";
import { DataProvider } from "../context/data.jsx";
import { ROLE_LABEL } from "../lib/format.js";

function NavItem({ to, current, children }) {
  return <Link to={to} aria-current={current ? "page" : undefined}>{children}</Link>;
}

export function TopBar() {
  var { user, signOut } = useSession();
  var path = useLocation().pathname;
  var lab = user.role === "lab";
  return (
    <div className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <div className="name">Formulation Test Tracker</div>
          <div className="sub">Hi‑Tech Company submits → Manna Rubber Park Laboratory tests → results return</div>
        </div>
        <div className="who">
          <span id="whoami">
            <span className={"role-pill " + user.role}>{ROLE_LABEL[user.role]}</span>
            <span className="who-name" title={user.name}>{user.name}</span>
          </span>
          <button className="btn ghost small" onClick={signOut}>Sign out</button>
        </div>
      </div>
      <nav className="nav" aria-label="Pages">
        <NavItem to="/" current={path === "/"}>Board</NavItem>
        {!lab && <NavItem to="/add" current={path === "/add"}>Add<span className="nav-long"> Formulation</span></NavItem>}
        {lab && <NavItem to="/queue" current={path === "/queue" || path.startsWith("/test/")}><span className="nav-long">Test </span>Queue</NavItem>}
        <NavItem to="/history" current={path === "/history"}><span className="nav-long">Test Result </span>History</NavItem>
        {user.admin && <NavItem to="/users" current={path === "/users"}>Users</NavItem>}
      </nav>
    </div>
  );
}

export function RequireSignIn() {
  var { user, ready } = useSession();
  var location = useLocation();

  useEffect(function () {
    document.body.dataset.role = user ? user.role : "";
    document.body.dataset.admin = user && user.admin ? "1" : "";
  }, [user]);

  if (!ready) return <main><p className="spec-line">Loading…</p></main>;
  if (!user) return <Navigate to={"/login?next=" + encodeURIComponent(location.pathname + location.search)} replace />;
  return <DataProvider><Outlet /></DataProvider>;
}

// Pages with the top bar.
export function Page({ narrow, children }) {
  return (
    <>
      <TopBar />
      <main className={narrow ? "narrow" : undefined}>{children}</main>
    </>
  );
}
