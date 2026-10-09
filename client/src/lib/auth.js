// Signing in with a name and a PIN. Supabase Auth wants an email address
// and a password, so the name becomes an internal address and the PIN is
// the password. The same mapping is in supabase/functions/ftt-admin-users,
// which creates the accounts; keep the two in step.

import { supabase } from "./supabase.js";

var EMAIL_DOMAIN = "tracker.mannarubber.com";
export var PIN_PATTERN = /^\d{6,8}$/;

// Case, extra spaces and the kind of hyphen don't matter: "hi‑tech" signs in as Hi-Tech.
export function nameKey(name) {
  return String(name || "").trim().replace(/\s+/g, " ").replace(/[‐-―−]/g, "-").toLowerCase();
}

export async function emailFor(name) {
  var digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nameKey(name)));
  var hex = Array.from(new Uint8Array(digest), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  return "u" + hex.slice(0, 24) + "@" + EMAIL_DOMAIN;
}

export async function signIn(name, pin) {
  var res = await supabase.auth.signInWithPassword({ email: await emailFor(name), password: pin });
  if (res.error) {
    var err = new Error(/invalid login/i.test(res.error.message)
      ? "That name and PIN don't match an account."
      : res.status === 429 || /rate limit|too many/i.test(res.error.message)
        ? "Too many tries. Wait a few minutes, then try again."
        : res.error.message);
    err.status = res.error.status;
    throw err;
  }
}

export function signOut() {
  return supabase.auth.signOut();
}

export function randomPin() {
  var a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1000000).padStart(6, "0");
}
