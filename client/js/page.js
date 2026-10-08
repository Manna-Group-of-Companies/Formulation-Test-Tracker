// ---------- start-up shared by the signed-in pages ----------
//
// If nobody is signed in here, or the sign-in runs out while the page is
// open, send the browser to the login page, which brings it back to this
// page afterwards.

import { setUnauthorizedHandler } from "./api.js";
import { loadSession, initSession } from "./session.js";

export function startPage(page) {
  function toLogin(expired) {
    location.replace("login.html?next=" + encodeURIComponent(page) + (expired ? "&expired=1" : ""));
  }
  setUnauthorizedHandler(function () { toLogin(true); });
  initSession();
  return loadSession().then(function (user) {
    if (user) return user;
    toLogin(false);
    return new Promise(function () {}); // the page is going away; don't carry on
  });
}
