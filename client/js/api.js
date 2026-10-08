// ---------- API ----------

import { state } from "./state.js";

export var API = "/api";

// Signing in and checking the session answer 401 as a plain "no"; from any
// other call it means the sign-in has run out.
var SESSION_PATHS = ["/login", "/session"];
var onUnauthorized = null;

export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export function api(path, opts) {
  return fetch(API + path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts))
    .then(function (res) {
      if (!res.ok) return res.json().catch(function () { return {}; }).then(function (b) {
        if (res.status === 401 && onUnauthorized && SESSION_PATHS.indexOf(path) < 0) onUnauthorized();
        var err = new Error(b.error || ("HTTP " + res.status));
        err.status = res.status;
        throw err;
      });
      if (res.status === 204) return null;
      return res.json();
    });
}

export function fetchAll() {
  return Promise.all([api("/formulations"), api("/results")]).then(function (r) {
    state.formulations = r[0];
    state.results = r[1];
  });
}
