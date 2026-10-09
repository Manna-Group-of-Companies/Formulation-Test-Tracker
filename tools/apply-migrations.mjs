// Applies every SQL file in supabase/migrations, in name order, to the
// database in DATABASE_URL (tools/.env). The files are written to be safe
// to run again, so this simply runs them all.
//
//   npm run migrate

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(here, ".env")); } catch { /* use the real environment */ }
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Put the Supabase connection string in tools/.env (see .env.example).");
  process.exit(1);
}

const dir = path.join(here, "..", "supabase", "migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false } });

await client.connect();
try {
  for (const f of files) {
    await client.query("begin");
    try {
      await client.query(fs.readFileSync(path.join(dir, f), "utf8"));
      await client.query("commit");
      console.log("applied", f);
    } catch (err) {
      await client.query("rollback");
      console.error(`${f} failed, nothing from it was kept: ${err.message}`);
      process.exitCode = 1;
      break;
    }
  }
} finally {
  await client.end();
}
