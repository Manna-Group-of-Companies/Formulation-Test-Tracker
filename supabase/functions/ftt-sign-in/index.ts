// Edge Function: sign in with a name and a 4- to 8-digit PIN.
//
//   POST { name, pin }  ->  { access_token, refresh_token }  (the page then
//   calls supabase.auth.setSession with them)
//
// A short PIN can be guessed, so this is the only way in:
//  - wrong PINs are counted (ftt_sign_in_* in the database): 5 for a name
//    from one address means a 5-minute wait, 20 for a name from anywhere
//    within an hour means a 30-minute wait;
//  - the PIN becomes the Supabase Auth password only after mixing in the
//    secret PIN_PEPPER, which never leaves the server. Guessing PINs
//    straight at Supabase Auth therefore gets nowhere.
// The name -> email and PIN -> password rules are the same in
// ftt-admin-users and tools/create-account.mjs; keep the three in step.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const PIN_PEPPER = Deno.env.get("PIN_PEPPER") ?? "";
function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (keys.default) return keys.default;
  } catch { /* fall back to the legacy key */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}
const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(SUPABASE_URL, secretKey(), NO_SESSION);

const PIN_PATTERN = /^\d{4,8}$/;
const EMAIL_DOMAIN = "tracker.mannarubber.com";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Case, extra spaces and the kind of hyphen don't matter: "hi‑tech" signs in as Hi-Tech.
function nameKey(name: string) {
  return String(name || "").trim().replace(/\s+/g, " ").replace(/[‐-―−]/g, "-").toLowerCase();
}

function hex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function emailFor(name: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nameKey(name)));
  return `u${hex(digest).slice(0, 24)}@${EMAIL_DOMAIN}`;
}

async function pinPassword(pin: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(PIN_PEPPER), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("ftt-pin:" + pin)));
}

function callerAddress(req: Request) {
  return (req.headers.get("cf-connecting-ip") || (req.headers.get("x-forwarded-for") ?? "").split(",")[0] || "unknown").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "use POST" });
  if (!PIN_PEPPER) {
    console.error("PIN_PEPPER is not set");
    return reply(500, { error: "sign-in is not set up yet" });
  }
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const pin = String(body.pin ?? "").trim();
  if (!name || !PIN_PATTERN.test(pin)) return reply(400, { error: "enter your name and PIN (4 to 8 digits)" });

  const key = nameKey(name);
  const address = callerAddress(req);
  const { data: wait, error: waitErr } = await admin.rpc("ftt_sign_in_wait", { name_key: key, address });
  if (waitErr) { console.error(waitErr.message); return reply(500, { error: "something went wrong" }); }
  if (wait > 0) return reply(429, { error: `Too many wrong PINs. Try again in ${wait} minute${wait > 1 ? "s" : ""}.` });

  // A client of its own, so this person's session never mixes with the admin one.
  const auth = createClient(SUPABASE_URL, secretKey(), NO_SESSION);
  const { data, error } = await auth.auth.signInWithPassword({ email: await emailFor(name), password: await pinPassword(pin) });
  if (error || !data.session) {
    if (error && error.status !== 400) { console.error("sign-in error:", error.status, error.message); return reply(503, { error: "sign-in is busy — try again in a minute" }); }
    await admin.rpc("ftt_sign_in_failed", { name_key: key, address });
    return reply(401, { error: "That name and PIN don't match an account." });
  }
  await admin.rpc("ftt_sign_in_ok", { name_key: key, address });
  return reply(200, { access_token: data.session.access_token, refresh_token: data.session.refresh_token });
});
