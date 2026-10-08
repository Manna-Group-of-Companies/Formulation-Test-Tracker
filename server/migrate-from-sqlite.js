// One-time copy of the old SQLite database (data/tracker.db) into the
// Postgres database in DATABASE_URL.
//
//   node migrate-from-sqlite.js [path/to/tracker.db]
//
// Formulations, results and accounts come across with their ids, report
// numbers and dates. PINs keep working, because the stored PIN hashes are
// copied as they are. Sign-ins don't: everyone signs in once more.
// Running it again skips what is already there, except that an account
// with the same name gets the old PIN, side and administrator flag back.

const path = require('path');
const Database = require('better-sqlite3');
const { pool, SCHEMA, transaction } = require('./server.js');

const file = process.argv[2] || path.join(__dirname, 'data', 'tracker.db');

async function main() {
  const old = new Database(file, { readonly: true, fileMustExist: true });
  const users = old.prepare('SELECT * FROM users').all();
  const forms = old.prepare('SELECT * FROM formulations').all();
  const formIds = new Set(forms.map((f) => f.id));
  const results = old.prepare('SELECT * FROM results').all().filter((r) => formIds.has(r.formulationId));
  old.close();

  await pool.query(SCHEMA);
  const added = { users: 0, formulations: 0, results: 0 };

  await transaction(async (db) => {
    for (const u of users) {
      const r = await db.query(`INSERT INTO users (id, name, name_key, role, pin_hash, is_admin, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (name_key) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, role = EXCLUDED.role, is_admin = EXCLUDED.is_admin
        RETURNING (xmax = 0) AS inserted`,
      [u.id, u.name, u.nameKey, u.role, u.pinHash, !!u.isAdmin, u.createdAt]);
      if (r.rows[0].inserted) added.users++;
    }

    for (const f of forms) {
      const r = await db.query(`INSERT INTO formulations
        (id, name, code, description, priority, requested_tests, specs, status, hold_reason,
         submitted_by_name, submitted_at, completed_at, report_no, revision, lab_remarks, released_by_name, released_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (id) DO NOTHING`,
      [f.id, f.name, f.code, f.description, f.priority, f.requestedTestsJson, f.specsJson,
        // the first version said "completed" where the lab now reviews and releases
        f.status === 'completed' ? 'review' : f.status, f.holdReason ?? null,
        f.submittedByName, f.submittedAt, f.completedAt, f.reportNo ?? null, f.revision ?? 0,
        f.labRemarks ?? null, f.releasedByName ?? null, f.releasedAt ?? null]);
      added.formulations += r.rowCount;
    }

    for (const x of results) {
      const r = await db.query(`INSERT INTO results
        (id, formulation_id, test_type, specimen_id, measured, notes, result, tested_by_name, tested_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT DO NOTHING`,
      [x.id, x.formulationId, x.testType, x.specimenId, x.valuesJson, x.notes, x.result, x.testedByName, x.testedAt]);
      added.results += r.rowCount;
    }
  });

  console.log(`Read from ${file}: ${users.length} accounts, ${forms.length} formulations, ${results.length} results.`);
  console.log(`New in the database: ${added.users} accounts, ${added.formulations} formulations, ${added.results} results.`);
}

main().then(() => pool.end()).catch(async (err) => {
  console.error('Migration failed, nothing was changed:', err.message);
  await pool.end();
  process.exit(1);
});
