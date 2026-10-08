// ---------- who's signed in: Hi-Tech Company or the Manna lab ----------
//
// Signing in happens on the login page (login.html). The server remembers
// the sign-in with a cookie for 30 days and checks the role on every change,
// so the signed-in pages only need to find out who it is, label the top bar,
// and offer Sign out.

import { api } from "./api.js";
import { state } from "./state.js";
import { esc, ROLE_LABEL } from "./format.js";

function setUser(user) {
  state.user = user;
  document.body.dataset.role = user ? user.role : "";
  document.body.dataset.admin = user && user.admin ? "1" : "";
  document.getElementById("whoami").innerHTML = user
    ? '<span class="role-pill ' + user.role + '">' + esc(ROLE_LABEL[user.role]) + '</span><span class="who-name" title="' + esc(user.name) + '">' + esc(user.name) + "</span>"
    : "";
}

export function loadSession() {
  return api("/session").then(function (user) { setUser(user); return user; }, function (err) {
    if (err.status === 401) { setUser(null); return null; }
    throw err;
  });
}

export function initSession() {
  document.getElementById("btn-signout").addEventListener("click", function () {
    api("/logout", { method: "POST" }).catch(function () {}).then(function () { location.href = "login.html?signedout=1"; });
  });
}
