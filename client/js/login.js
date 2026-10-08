// ---------- Login page ----------
//
// Everyone signs in here with their own name and PIN. Accounts are made by
// an administrator on the Users page, and each belongs to one side (Hi-Tech
// Company or the Manna lab), so nobody picks a side here. The sign-in lasts
// 30 days in this browser. Other pages send people here with ?next=<page>
// and get them back afterwards.

import { api } from "./api.js";

// Where each side lands when they didn't ask for a particular page.
var HOME = { company: "./", lab: "queue.html" };
// Only our own pages may be returned to.
var NEXT_PAGE = /^(\.\/|(add|history|queue|test|report|users)\.html(\?id=[\w-]+)?)$/;

var params = new URLSearchParams(location.search);
var form = document.getElementById("signin-form");
var error = document.getElementById("si-error");
var nameEl = document.getElementById("si-name");
var pinEl = document.getElementById("si-pin");
var toggle = document.getElementById("si-pin-toggle");
var submitBtn = form.querySelector("button[type=submit]");

function destination(role) {
  var next = params.get("next");
  return next && NEXT_PAGE.test(next) ? next : HOME[role];
}

// The name (never the PIN) is remembered for next time, in this browser only.
function remember(name) {
  try { localStorage.setItem("ftt-login", JSON.stringify({ name: name })); } catch (e) {}
}
function remembered() {
  try { return JSON.parse(localStorage.getItem("ftt-login")) || {}; } catch (e) { return {}; }
}

function showNotice(msg) {
  var notice = document.getElementById("login-notice");
  notice.textContent = msg;
  notice.hidden = !msg;
}

function prefill() {
  var last = remembered();
  if (last.name) nameEl.value = last.name;
  (nameEl.value ? pinEl : nameEl).focus();
}

toggle.addEventListener("click", function () {
  var show = pinEl.type === "password";
  pinEl.type = show ? "text" : "password";
  toggle.textContent = show ? "Hide" : "Show";
  toggle.setAttribute("aria-pressed", String(show));
  pinEl.focus();
});

// Digits only.
pinEl.addEventListener("input", function () {
  var digits = pinEl.value.replace(/\D/g, "");
  if (digits !== pinEl.value) pinEl.value = digits;
});

form.addEventListener("submit", function (e) {
  e.preventDefault();
  error.textContent = "";
  var name = nameEl.value.trim();
  var pin = pinEl.value.trim();
  if (!name) { error.textContent = "Enter your name."; nameEl.focus(); return; }
  if (!/^\d{4,8}$/.test(pin)) { error.textContent = "Enter your PIN — 4 to 8 digits."; pinEl.focus(); return; }

  submitBtn.disabled = true;
  submitBtn.textContent = "Signing in…";
  api("/login", { method: "POST", body: JSON.stringify({ name: name, pin: pin }) }).then(function (user) {
    remember(user.name);
    location.replace(destination(user.role));
  }).catch(function (err) {
    error.textContent = err.status ? (err.message || "Could not sign in — try again") : "Can't reach the server — is it running?";
    if (err.status === 401) { pinEl.value = ""; pinEl.focus(); }
    submitBtn.disabled = false;
    submitBtn.textContent = "Sign in";
  });
});

// Already signed in? Go straight on.
api("/session").then(function (user) {
  location.replace(destination(user.role));
}, function (err) {
  if (!err.status) showNotice("Can't reach the server — is it running?");
  else if (params.has("signedout")) showNotice("You've signed out.");
  else if (params.has("expired")) showNotice("Your sign-in has ended. Please sign in again.");
  prefill();
});
