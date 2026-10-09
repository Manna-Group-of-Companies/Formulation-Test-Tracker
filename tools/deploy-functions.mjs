// Deploys every Edge Function in supabase/functions and sets their secret
// PIN_PEPPER, through the Supabase Management API (no Supabase CLI needed).
// Needs SUPABASE_ACCESS_TOKEN and PIN_PEPPER in tools/.env.
//
//   npm run deploy-functions

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT = "nnjwggmixzkdzpeezayj";
const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(here, ".env")); } catch { /* use the real environment */ }
const { SUPABASE_ACCESS_TOKEN: token, PIN_PEPPER } = process.env;
if (!token || !PIN_PEPPER) {
  console.error("SUPABASE_ACCESS_TOKEN and PIN_PEPPER must be set in tools/.env (see .env.example).");
  process.exit(1);
}
const api = `https://api.supabase.com/v1/projects/${PROJECT}`;
const auth = { Authorization: `Bearer ${token}` };

// verify_jwt for each function, from supabase/config.toml ([functions.<name>] verify_jwt = false).
const config = fs.readFileSync(path.join(here, "..", "supabase", "config.toml"), "utf8");
function verifyJwt(name) {
  const m = config.match(new RegExp(`\\[functions\\.${name}\\][^\\[]*?verify_jwt\\s*=\\s*(true|false)`));
  return m ? m[1] === "true" : true;
}

const res = await fetch(`${api}/secrets`, {
  method: "POST", headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify([{ name: "PIN_PEPPER", value: PIN_PEPPER }]),
});
if (!res.ok) { console.error("Could not set PIN_PEPPER:", res.status, await res.text()); process.exit(1); }
console.log("set secret PIN_PEPPER");

const dir = path.join(here, "..", "supabase", "functions");
for (const name of fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, "index.ts")))) {
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify({ entrypoint_path: "index.ts", name, verify_jwt: verifyJwt(name) })], { type: "application/json" }));
  form.append("file", new Blob([fs.readFileSync(path.join(dir, name, "index.ts"))], { type: "application/typescript" }), "index.ts");
  const r = await fetch(`${api}/functions/deploy?slug=${name}`, { method: "POST", headers: auth, body: form });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { console.error(`${name}: deploy failed`, r.status, JSON.stringify(body)); process.exitCode = 1; continue; }
  console.log(`deployed ${name} (version ${body.version}, verify_jwt ${body.verify_jwt})`);
}
