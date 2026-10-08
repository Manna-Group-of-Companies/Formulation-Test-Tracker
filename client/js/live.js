// ---------- live updates ----------

import { API } from "./api.js";

export function connectEvents(onChange) {
  var es = new EventSource(API + "/events");
  var opened = false;
  // A refresh that fails because the sign-in ended is already dealt with
  // (api.js sends the page to the login page); anything else is logged.
  function refresh() {
    Promise.resolve(onChange()).catch(function (err) {
      if (err && err.status !== 401) console.warn("Live refresh failed:", err.message || err);
    });
  }
  es.onmessage = refresh;
  // EventSource reconnects on its own (after a server restart, say); catch
  // up on anything missed while it was down.
  es.onopen = function () { if (opened) refresh(); opened = true; };
  return es;
}
