// Edge Function: administrators add people, change a name, side, PIN or
// administrator flag, and remove accounts. This needs the project's secret
// key (to manage Supabase Auth users), which must never reach a browser,
// so the Users page calls this instead of the database.
//
//   POST { action: "create", name, role, pin, admin }
//   POST { action: "update", id, name?, role?, admin?, pin? }
//   POST { action: "delete", id }
//
// Each person signs in with a name and a PIN (through ftt-sign-in).
// Supabase Auth wants an email address and a password, so the name is
// turned into an internal address and the PIN into a password mixed with
// the secret PIN_PEPPER. ftt-sign-in and tools/create-account.mjs use the
// same rules; keep the three in step. Listing accounts is the database
// function ftt_list_users.

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
const admin = createClient(SUPABASE_URL, secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ROLES = ["company", "lab"];
const PIN_PATTERN = /^\d{4,8}$/;
const PIN_RULE = "a PIN is 4 to 8 digits";
const EMAIL_DOMAIN = "tracker.mannarubber.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

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
  if (!PIN_PEPPER) throw new Error("PIN_PEPPER is not set");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(PIN_PEPPER), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("ftt-pin:" + pin)));
}

function cleanName(v: unknown) {
  const name = String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!name) throw new HttpError(400, "enter a name");
  return name;
}

function cleanPin(v: unknown) {
  const pin = String(v ?? "").trim();
  if (!PIN_PATTERN.test(pin)) throw new HttpError(400, PIN_RULE);
  return pin;
}

async function checkNameFree(name: string, exceptId?: string) {
  const { data } = await admin.from("profiles").select("id, name").eq("name_key", nameKey(name)).maybeSingle();
  if (data && data.id !== exceptId) throw new HttpError(409, `there is already an account named ${data.name}`);
}

async function adminCount() {
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", true);
  return count ?? 0;
}

async function getProfile(id: string) {
  const { data } = await admin.from("profiles").select("*").eq("id", id).maybeSingle();
  if (!data) throw new HttpError(404, "account not found");
  return data;
}

function publicUser(p: { id: string; name: string; role: string; is_admin: boolean; created_at: string }) {
  return { id: p.id, name: p.name, role: p.role, admin: p.is_admin, createdAt: p.created_at };
}

// A new PIN signs that person out of their other browsers.
async function endSessions(userId: string) {
  const { error } = await admin.rpc("ftt_end_sessions", { user_id: userId });
  if (error) console.error("Could not end sessions:", error.message);
}

async function create(body: Record<string, unknown>) {
  const name = cleanName(body.name);
  const role = String(body.role ?? "");
  if (!ROLES.includes(role)) throw new HttpError(400, "choose a side");
  const pin = cleanPin(body.pin);
  await checkNameFree(name);
  const { data, error } = await admin.auth.admin.createUser({
    email: await emailFor(name), password: await pinPassword(pin), email_confirm: true, user_metadata: { name },
  });
  if (error || !data.user) throw new HttpError(400, error?.message ?? "could not add the account");
  const { data: p, error: e2 } = await admin.from("profiles")
    .insert({ id: data.user.id, name, name_key: nameKey(name), role, is_admin: !!body.admin })
    .select().single();
  if (e2) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw new HttpError(400, e2.message);
  }
  return publicUser(p);
}

async function update(body: Record<string, unknown>, me: { id: string }) {
  const u = await getProfile(String(body.id ?? ""));
  const profile: Record<string, unknown> = {};
  const account: { email?: string; password?: string; email_confirm?: boolean } = {};
  if (body.name !== undefined) {
    const name = cleanName(body.name);
    await checkNameFree(name, u.id);
    profile.name = name;
    profile.name_key = nameKey(name);
    account.email = await emailFor(name);
    account.email_confirm = true;
  }
  if (body.role !== undefined) {
    if (!ROLES.includes(String(body.role))) throw new HttpError(400, "choose a side");
    profile.role = body.role;
  }
  if (body.admin !== undefined) {
    if (!body.admin && u.is_admin && await adminCount() === 1) throw new HttpError(409, "keep at least one administrator");
    profile.is_admin = !!body.admin;
  }
  if (body.pin !== undefined) account.password = await pinPassword(cleanPin(body.pin));

  if (Object.keys(account).length) {
    const { error } = await admin.auth.admin.updateUserById(u.id, account);
    if (error) throw new HttpError(400, error.message);
  }
  if (Object.keys(profile).length) {
    const { error } = await admin.from("profiles").update(profile).eq("id", u.id);
    if (error) throw new HttpError(400, error.message);
  }
  // Changing your own PIN keeps you signed in here.
  if (account.password && u.id !== me.id) await endSessions(u.id);
  return publicUser(await getProfile(u.id));
}

async function remove(body: Record<string, unknown>, me: { id: string }) {
  const u = await getProfile(String(body.id ?? ""));
  if (u.id === me.id) throw new HttpError(409, "you can't remove your own account");
  if (u.is_admin && await adminCount() === 1) throw new HttpError(409, "keep at least one administrator");
  const { error } = await admin.auth.admin.deleteUser(u.id); // the profile goes with it
  if (error) throw new HttpError(400, error.message);
  return { removed: u.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") throw new HttpError(405, "use POST");
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await admin.auth.getUser(jwt);
    if (!auth?.user) throw new HttpError(401, "sign in first");
    const { data: me } = await admin.from("profiles").select("*").eq("id", auth.user.id).maybeSingle();
    if (!me?.is_admin) throw new HttpError(403, "only an administrator can manage users");

    const body = await req.json().catch(() => { throw new HttpError(400, "invalid JSON"); });
    switch (body.action) {
      case "create": return reply(201, await create(body));
      case "update": return reply(200, await update(body, me));
      case "delete": return reply(200, await remove(body, me));
      default: throw new HttpError(400, "unknown action");
    }
  } catch (err) {
    if (err instanceof HttpError) return reply(err.status, { error: err.message });
    console.error(err);
    return reply(500, { error: "something went wrong" });
  }
});
