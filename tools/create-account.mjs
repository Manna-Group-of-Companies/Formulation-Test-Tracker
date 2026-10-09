// Creates a sign-in account directly, for the first administrator (after
// that, administrators add people on the Users page). Needs the project's
// secret key in tools/.env.
//
//   npm run create-account -- "<name>" <company|lab> [pin] [--admin]
//
// Without a PIN it makes a random 4-digit one and prints it. If the name
// already has an account, its side, PIN and administrator flag are updated.
// The name -> email and PIN -> password rules (PIN mixed with the secret
// PIN_PEPPER) are the same in the ftt-sign-in and ftt-admin-users Edge
// Functions; keep the three in step.

import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(here, ".env")); } catch { /* use the real environment */ }
const { SUPABASE_URL, SUPABASE_SECRET_KEY, PIN_PEPPER } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !PIN_PEPPER) {
  console.error("SUPABASE_URL, SUPABASE_SECRET_KEY and PIN_PEPPER must be set in tools/.env (see .env.example).");
  process.exit(1);
}

const args = process.argv.slice(2);
const admin = args.includes("--admin");
const [name, role, pinArg] = args.filter((a) => a !== "--admin");
if (!name || !["company", "lab"].includes(role)) {
  console.error('Usage: npm run create-account -- "<name>" <company|lab> [pin] [--admin]');
  process.exit(1);
}
const pin = pinArg || String(crypto.randomInt(10000)).padStart(4, "0");
if (!/^\d{4,8}$/.test(pin)) { console.error("A PIN is 4 to 8 digits."); process.exit(1); }

function nameKey(n) {
  return String(n || "").trim().replace(/\s+/g, " ").replace(/[‐-―−]/g, "-").toLowerCase();
}
const email = "u" + crypto.createHash("sha256").update(nameKey(name)).digest("hex").slice(0, 24) + "@tracker.mannarubber.com";
const password = crypto.createHmac("sha256", PIN_PEPPER).update("ftt-pin:" + pin).digest("hex");
const cleanName = name.trim().replace(/\s+/g, " ");

const sb = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: existing, error: findErr } = await sb.from("profiles").select("id").eq("name_key", nameKey(name)).maybeSingle();
if (findErr) { console.error("Could not read profiles:", findErr.message); process.exit(1); }

let id = existing?.id;
if (id) {
  const { error } = await sb.auth.admin.updateUserById(id, { password, email, email_confirm: true });
  if (error) { console.error("Could not update the account:", error.message); process.exit(1); }
} else {
  const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: cleanName } });
  if (error) { console.error("Could not create the account:", error.message); process.exit(1); }
  id = data.user.id;
}
const { error: profErr } = await sb.from("profiles").upsert({ id, name: cleanName, name_key: nameKey(name), role, is_admin: admin });
if (profErr) { console.error("Could not save the profile:", profErr.message); process.exit(1); }

console.log(`${existing ? "Updated" : "Created"} ${cleanName} (${role === "lab" ? "Manna Rubber Park Lab" : "Hi-Tech Company"}${admin ? ", administrator" : ""}). PIN: ${pin}`);
