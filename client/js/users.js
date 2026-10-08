// ---------- Users page (administrators) ----------
//
// Everyone who can sign in, by side. An administrator adds people with a
// name, side and PIN, gives someone a new PIN, makes or unmakes
// administrators, and removes accounts. A new PIN signs that person out of
// their other browsers; a removed account is signed out everywhere.

import { api } from "./api.js";
import { state } from "./state.js";
import { toast } from "./toast.js";
import { startPage } from "./page.js";
import { esc, fmtDate } from "./format.js";

var SIDES = [
  { role: "company", title: "Hi‑Tech Company" },
  { role: "lab", title: "Manna Rubber Park Lab" }
];

var form = document.getElementById("add-user");
var error = document.getElementById("u-error");
var lists = document.getElementById("u-lists");
var users = [];
var resetting = null; // id of the account whose PIN is being changed

function randomPin() {
  var a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1000000).padStart(6, "0");
}

function digitsOnly(input) {
  input.addEventListener("input", function () {
    var d = input.value.replace(/\D/g, "");
    if (d !== input.value) input.value = d;
  });
}

function userRow(u) {
  var me = u.id === state.user.id;
  var html = '<li class="user-row" data-id="' + esc(u.id) + '">' +
    '<div class="user-main"><b>' + esc(u.name) + "</b>" + (me ? ' <span class="hint">(you)</span>' : "") +
    (u.admin ? ' <span class="status-pill review">Administrator</span>' : "") +
    '<div class="spec-line">Added ' + esc(fmtDate(u.createdAt)) + "</div></div>" +
    '<div class="user-actions">' +
    '<button type="button" class="btn small" data-act="pin">Change PIN</button>' +
    '<button type="button" class="btn small" data-act="admin">' + (u.admin ? "Remove admin" : "Make admin") + "</button>" +
    (me ? "" : '<button type="button" class="btn small danger" data-act="remove">Remove</button>') +
    "</div>";
  if (resetting === u.id) {
    html += '<form class="inline-form user-pin-form" novalidate>' +
      '<div class="field"><label for="pin-' + esc(u.id) + '">New PIN for ' + esc(u.name) + "</label>" +
      '<div class="code-wrap"><input id="pin-' + esc(u.id) + '" class="mono" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="4–8 digits">' +
      '<button type="button" class="btn ghost small code-toggle" data-act="newpin">New</button></div></div>' +
      '<div class="form-error" role="alert"></div>' +
      '<div class="form-actions"><button type="button" class="btn ghost" data-act="cancel">Cancel</button>' +
      '<button type="submit" class="btn primary">Save PIN</button></div></form>';
  }
  return html + "</li>";
}

function render() {
  lists.innerHTML = SIDES.map(function (s) {
    var mine = users.filter(function (u) { return u.role === s.role; });
    return '<div class="card"><div class="card-head"><h2>' + esc(s.title) + '</h2><span class="hint">' +
      mine.length + (mine.length === 1 ? " person" : " people") + "</span></div>" +
      (mine.length ? '<ul class="user-list">' + mine.map(userRow).join("") + "</ul>"
        : '<div class="empty">Nobody yet — add someone above.</div>') + "</div>";
  }).join("");
  var pinInput = lists.querySelector(".user-pin-form input");
  if (pinInput) { digitsOnly(pinInput); pinInput.focus(); }
}

function load() {
  return api("/users").then(function (list) { users = list; render(); });
}

function findUser(id) {
  return users.find(function (u) { return u.id === id; });
}

lists.addEventListener("click", function (e) {
  var btn = e.target.closest("button[data-act]");
  if (!btn) return;
  var u = findUser(btn.closest(".user-row").dataset.id);
  var act = btn.dataset.act;
  if (act === "pin") { resetting = resetting === u.id ? null : u.id; render(); }
  else if (act === "cancel") { resetting = null; render(); }
  else if (act === "newpin") { btn.parentNode.querySelector("input").value = randomPin(); }
  else if (act === "admin") {
    api("/users/" + u.id, { method: "PATCH", body: JSON.stringify({ admin: !u.admin }) }).then(function (nu) {
      toast(nu.admin ? nu.name + " is now an administrator" : nu.name + " is no longer an administrator");
      if (nu.id === state.user.id && !nu.admin) { location.href = "./"; return; }
      return load();
    }).catch(function (err) { toast(err.message || "Could not change that"); });
  } else if (act === "remove") {
    if (!confirm("Remove " + u.name + "? They won't be able to sign in any more. What they sent or recorded stays.")) return;
    api("/users/" + u.id, { method: "DELETE" }).then(function () {
      toast("Removed " + u.name);
      return load();
    }).catch(function (err) { toast(err.message || "Could not remove " + u.name); });
  }
});

lists.addEventListener("submit", function (e) {
  e.preventDefault();
  var f = e.target;
  var u = findUser(f.closest(".user-row").dataset.id);
  var pin = f.querySelector("input").value.trim();
  var err = f.querySelector(".form-error");
  if (!/^\d{4,8}$/.test(pin)) { err.textContent = "A PIN is 4 to 8 digits."; return; }
  api("/users/" + u.id, { method: "PATCH", body: JSON.stringify({ pin: pin }) }).then(function () {
    resetting = null;
    toast("New PIN saved for " + u.name + " — " + pin);
    return load();
  }).catch(function (x) { err.textContent = x.message || "Could not save the PIN"; });
});

digitsOnly(document.getElementById("u-pin"));
document.getElementById("u-pin-new").addEventListener("click", function () {
  document.getElementById("u-pin").value = randomPin();
});

form.addEventListener("submit", function (e) {
  e.preventDefault();
  error.textContent = "";
  var data = {
    name: document.getElementById("u-name").value.trim(),
    role: document.getElementById("u-role").value,
    pin: document.getElementById("u-pin").value.trim(),
    admin: document.getElementById("u-admin").checked
  };
  if (!data.name) { error.textContent = "Enter the person's name."; return; }
  if (!/^\d{4,8}$/.test(data.pin)) { error.textContent = "Give them a PIN of 4 to 8 digits, or press New."; return; }
  var btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  api("/users", { method: "POST", body: JSON.stringify(data) }).then(function (u) {
    toast("Added " + u.name + " — PIN " + data.pin);
    form.reset();
    document.getElementById("u-name").focus();
    return load();
  }).catch(function (err) {
    error.textContent = err.message || "Could not add — try again";
  }).finally(function () { btn.disabled = false; });
});

startPage("users.html").then(function (user) {
  if (!user.admin) { document.getElementById("not-admin").hidden = false; return; }
  form.hidden = false;
  return load();
}).catch(function () {
  toast("Could not reach the server — is it running?");
});
