// Formulation Test Tracker — server
//
// Hi-Tech Company sends a formulation with the tests it wants run and
// optional acceptance limits. The Manna Rubber Park lab records a result
// for each requested test; this server grades each one against the limits
// and moves the formulation along
//
//   submitted -> in_testing -> review -> released     (or on_hold before release)
//
// "review" means every requested test is recorded and the lab is checking
// before sending the results back. Releasing issues a numbered test report,
// and only then can Hi-Tech Company see the measured values and pass/fail.
//
// Everyone signs in with their own name and PIN; an account belongs to one
// side, and administrators add people and reset PINs on the Users page.
// Every write checks the side: only Hi-Tech Company sends or withdraws
// formulations, only the lab records and releases results. A small signal goes to every open browser
// tab over Server-Sent Events whenever anything changes, so both screens
// stay current without refreshing.
//
// Data lives in a Postgres database (Supabase), given by DATABASE_URL in
// the environment or in server/.env.

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (e) { /* no .env: use the real environment */ }

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const CLIENT_DIR = path.join(__dirname, '..', 'client');

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Put the Supabase connection string in server/.env (see .env.example).');
  process.exit(1);
}

const SESSION_COOKIE = 'ftt_session';
const SESSION_DAYS = 30;
const ROLE_LABEL = { company: 'Hi-Tech Company', lab: 'Manna Rubber Park Lab' };
const STATUS_TEXT = { submitted: 'submitted', in_testing: 'in testing', on_hold: 'on hold', review: 'in lab review', released: 'released' };

// The measured value each test is graded on, and the spec limits (keys into
// the formulation's specs) it's graded against.
const TESTS = {
  tensile: { value: 'tensileStrength', min: 'tensileMin', max: 'tensileMax' },
  hardness: { value: 'hardnessValue', min: 'hardnessMin', max: 'hardnessMax' },
  specific_gravity: { value: 'sgValue', min: 'sgMin', max: 'sgMax' },
  rheo_ts2: { value: 'ts2', min: 'ts2Min', max: 'ts2Max' },
  rheo_tc90: { value: 'tc90', min: 'tc90Min', max: 'tc90Max' },
  mooney: { value: 'mooneyValue', min: 'mooneyMin', max: 'mooneyMax' },
  ash: { value: 'ashValue', min: 'ashMin', max: 'ashMax' },
  acetone: { value: 'acetoneValue', min: 'acetoneMin', max: 'acetoneMax' },
  carbon_black: { value: 'cbValue', min: 'cbMin', max: 'cbMax' },
  mixing: { value: 'dumpTemp', min: 'mixingMin', max: 'mixingMax' },
  moulding: { value: 'cureTemp', min: 'mouldingMin', max: 'mouldingMax' }
};
// Text specs that go with a test (not graded on).
const TEXT_SPECS = ['hardnessScale'];

// ---------- database ----------

// Supabase only takes encrypted connections; a database on this computer
// (for trying things out) usually has none.
const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL);
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
  max: 5
});
pool.on('error', (err) => console.error('Database connection error:', err.message));

async function all(db, sql, params) { return (await db.query(sql, params)).rows; }
async function one(db, sql, params) { return (await db.query(sql, params)).rows[0]; }

// Run fn(client) inside one transaction.
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Row level security is switched on with no policies, so Supabase's public
// Data API (the publishable key) can't read or change these tables. This
// server connects as the database owner, which isn't affected.
const SCHEMA = `
  -- A formulation Hi-Tech Company sends to the lab for testing.
  CREATE TABLE IF NOT EXISTS formulations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    description TEXT,
    priority TEXT NOT NULL DEFAULT 'normal',
    requested_tests JSONB NOT NULL,
    specs JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted',
    hold_reason TEXT,               -- what the lab needs, while on_hold
    submitted_by_name TEXT,
    submitted_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,       -- when the last requested test was recorded
    report_no TEXT UNIQUE,          -- assigned on first release, e.g. TR-2026-0001
    revision INTEGER NOT NULL DEFAULT 0,
    lab_remarks TEXT,
    released_by_name TEXT,
    released_at TIMESTAMPTZ
  );

  -- One test result recorded against a formulation (at most one per
  -- requested test type — recording again replaces it).
  CREATE TABLE IF NOT EXISTS results (
    id TEXT PRIMARY KEY,
    formulation_id TEXT NOT NULL REFERENCES formulations(id) ON DELETE CASCADE,
    test_type TEXT NOT NULL,
    specimen_id TEXT,
    measured JSONB NOT NULL,
    notes TEXT,
    result TEXT NOT NULL,
    tested_by_name TEXT,
    tested_at TIMESTAMPTZ NOT NULL,
    UNIQUE (formulation_id, test_type)
  );

  -- A person who can sign in, and the side they belong to. Only a salted
  -- hash of the PIN is stored.
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,  -- the name lower-cased, for signing in
    role TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL
  );

  -- A signed-in browser. Only a hash of the cookie token is stored.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  );

  ALTER TABLE formulations ENABLE ROW LEVEL SECURITY;
  ALTER TABLE results ENABLE ROW LEVEL SECURITY;
  ALTER TABLE users ENABLE ROW LEVEL SECURITY;
  ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
`;

// ---------- accounts: a name and a PIN for each person ----------

const PIN_PATTERN = /^\d{4,8}$/;
const PIN_RULE = 'a PIN is 4 to 8 digits';

// Case, extra spaces and the kind of hyphen don't matter: "hi‑tech" signs in as Hi-Tech.
function nameKey(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').replace(/[‐-―−]/g, '-').toLowerCase();
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(String(pin), salt, 32).toString('hex');
}

function pinMatches(stored, pin) {
  const [salt, hash] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), crypto.scryptSync(String(pin), salt, 32));
}

// Checked when nobody has the name given, so a wrong name takes as long to
// refuse as a wrong PIN.
const DUMMY_PIN_HASH = hashPin('0000');

function newPin() {
  return String(crypto.randomInt(1000000)).padStart(6, '0');
}

function userByName(name) {
  return one(pool, 'SELECT * FROM users WHERE name_key = $1', [nameKey(name)]);
}

function publicUser(u) {
  return { id: u.id, name: u.name, role: u.role, admin: u.is_admin, createdAt: u.created_at };
}

// A short PIN can be guessed, so after a few wrong tries the same name from
// the same address has to wait.
const MAX_TRIES = 5;
const LOCK_MINUTES = 5;
const failedLogins = new Map();

function minutesLocked(key) {
  const f = failedLogins.get(key);
  if (!f || f.count < MAX_TRIES) return 0;
  const wait = f.at + LOCK_MINUTES * 60000 - Date.now();
  if (wait <= 0) { failedLogins.delete(key); return 0; }
  return Math.ceil(wait / 60000);
}

function noteFailedLogin(key) {
  const f = failedLogins.get(key) || { count: 0 };
  failedLogins.set(key, { count: f.count + 1, at: Date.now() });
}

// With no accounts yet, start with one for each side. Lab is the
// administrator, who adds people and changes PINs on the Users page.
const STARTING_ACCOUNTS = [
  { name: 'Hi-Tech', role: 'company', pin: '2026', admin: false },
  { name: 'Lab', role: 'lab', pin: '2022', admin: true }
];

// Create the tables if needed, then the starting accounts if there are none.
async function prepareDatabase() {
  await pool.query(SCHEMA);
  await pool.query('DELETE FROM sessions WHERE created_at < $1',
    [new Date(Date.now() - SESSION_DAYS * 86400000).toISOString()]);
  const { n } = await one(pool, 'SELECT COUNT(*)::int AS n FROM users');
  if (n) return false;
  for (const a of STARTING_ACCOUNTS) {
    await pool.query(`INSERT INTO users (id, name, name_key, role, pin_hash, is_admin, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id('user'), a.name, nameKey(a.name), a.role, hashPin(a.pin), a.admin, now()]);
  }
  return true;
}

// `node server.js reset-pin "<name>"` gives that person a new PIN, for an
// administrator who has forgotten theirs.
async function resetPin(name) {
  const u = await userByName(name);
  if (!u) { console.error(`No account named "${name || ''}".`); return 1; }
  const pin = newPin();
  await pool.query('UPDATE users SET pin_hash = $1 WHERE id = $2', [hashPin(pin), u.id]);
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [u.id]);
  console.log(`New PIN for ${u.name}: ${pin}`);
  return 0;
}

// ---------- sessions ----------

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function sessionCookie(req, token, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}` +
    (req.secure ? '; Secure' : '');
}

// The signed-in person as their account is now: a removed account is signed
// out everywhere, and a changed name or side applies straight away.
async function currentUser(req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const s = await one(pool, `SELECT s.token_hash, s.created_at AS signed_in_at, u.* FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`, [sha256(token)]);
  if (!s) return null;
  if (Date.now() - s.signed_in_at > SESSION_DAYS * 86400000) {
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [s.token_hash]);
    return null;
  }
  return { id: s.id, role: s.role, name: s.name, admin: s.is_admin, tokenHash: s.token_hash };
}

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function id(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function now() { return new Date().toISOString(); }

function text(v) {
  return v == null ? null : String(v).trim() || null;
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function validDate(v) {
  const d = new Date(v);
  return v && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

// Keep only the known limit keys, as numbers (or null), plus the text specs.
function cleanSpecs(s) {
  const out = {};
  for (const t of Object.values(TESTS)) {
    out[t.min] = numOrNull(s[t.min]);
    out[t.max] = numOrNull(s[t.max]);
  }
  for (const k of TEXT_SPECS) out[k] = text(s[k]);
  return out;
}

function computeResult(specs, testType, values) {
  const t = TESTS[testType];
  const min = specs[t.min], max = specs[t.max], val = values[t.value];
  if (min == null && max == null) return 'recorded';
  if ((min != null && val < min) || (max != null && val > max)) return 'fail';
  return 'pass';
}

function outcomeOf(requested, results) {
  if (!requested.every((t) => results.some((r) => r.test_type === t))) return null;
  if (results.some((r) => r.result === 'fail')) return 'fail';
  if (results.some((r) => r.result === 'recorded')) return 'recorded';
  return 'pass';
}

// FOR UPDATE inside a transaction holds the row until it commits, so two
// changes to one formulation happen one after the other.
async function getFormulation(db, formulationId, forUpdate) {
  const f = await one(db, 'SELECT * FROM formulations WHERE id = $1' + (forUpdate ? ' FOR UPDATE' : ''), [formulationId]);
  if (!f) throw new HttpError(404, 'formulation not found');
  return f;
}

function loadResults(db, formulationId) {
  return all(db, 'SELECT * FROM results WHERE formulation_id = $1', [formulationId]);
}

async function resultsByFormulation() {
  const map = {};
  for (const r of await all(pool, 'SELECT * FROM results')) (map[r.formulation_id] ||= []).push(r);
  return map;
}

async function allTestsRecorded(db, f) {
  const have = (await loadResults(db, f.id)).map((r) => r.test_type);
  return f.requested_tests.every((t) => have.includes(t));
}

// Report numbers run per year: TR-2026-0001, TR-2026-0002, ... The lock
// stops two releases at the same moment from taking the same number.
async function nextReportNo(db) {
  await db.query('SELECT pg_advisory_xact_lock(7301)');
  const prefix = `TR-${new Date().getFullYear()}-`;
  const last = await one(db, 'SELECT report_no FROM formulations WHERE report_no LIKE $1 ORDER BY report_no DESC LIMIT 1',
    [prefix + '%']);
  const n = last ? Number(last.report_no.slice(prefix.length)) + 1 : 1;
  return prefix + String(n).padStart(4, '0');
}

// What a formulation looks like to the person asking. Hi-Tech Company sees
// which tests are done while testing is under way, but the grades, overall
// outcome and lab remarks only once the results are released.
function formulationFor(user, f, results) {
  const visible = user.role === 'lab' || f.status === 'released';
  return {
    id: f.id, name: f.name, code: f.code, description: f.description, priority: f.priority,
    requestedTests: f.requested_tests, specs: f.specs,
    status: f.status, holdReason: f.hold_reason,
    submittedByName: f.submitted_by_name, submittedAt: f.submitted_at, completedAt: f.completed_at,
    testsDone: [...new Set(results.map((r) => r.test_type))],
    outcome: visible ? outcomeOf(f.requested_tests, results) : null,
    reportNo: f.report_no, revision: f.revision,
    labRemarks: visible ? f.lab_remarks : null,
    releasedByName: f.released_by_name, releasedAt: f.released_at
  };
}

function rowToResult(r) {
  return {
    id: r.id, formulationId: r.formulation_id, testType: r.test_type, specimenId: r.specimen_id,
    values: r.measured, notes: r.notes, result: r.result,
    testedByName: r.tested_by_name, testedAt: r.tested_at
  };
}

// Set the given columns of one row. Column names only ever come from this
// file, never from a request.
function updateRow(db, table, keyCol, key, changes) {
  const cols = Object.keys(changes);
  if (!cols.length) return;
  const set = cols.map((col, i) => `${col} = $${i + 2}`).join(', ');
  return db.query(`UPDATE ${table} SET ${set} WHERE ${keyCol} = $1`, [key, ...cols.map((c) => changes[c])]);
}

// After a result is saved, move the formulation along: in_testing once
// anything is recorded, review once every requested test is. A formulation
// on hold stays there until the lab resumes it.
async function advanceAfterResult(db, f) {
  if (f.status === 'on_hold') return;
  if (await allTestsRecorded(db, f)) {
    await db.query("UPDATE formulations SET status = 'review', completed_at = COALESCE(completed_at, $2) WHERE id = $1",
      [f.id, now()]);
  } else {
    await db.query("UPDATE formulations SET status = 'in_testing' WHERE id = $1", [f.id]);
  }
}

// What the lab can do to a formulation, from which statuses, and the
// columns each action changes.
const LAB_ACTIONS = {
  start: { from: ['submitted'], apply: () => ({ status: 'in_testing' }) },
  hold: {
    from: ['submitted', 'in_testing', 'review'],
    apply: (db, f, body) => {
      const reason = text(body.reason);
      if (!reason) throw new HttpError(400, 'say what the lab needs, so Hi-Tech Company knows why it is on hold');
      return { status: 'on_hold', hold_reason: reason };
    }
  },
  resume: {
    from: ['on_hold'],
    apply: async (db, f) => (await allTestsRecorded(db, f))
      ? { status: 'review', hold_reason: null, completed_at: f.completed_at || now() }
      : { status: 'in_testing', hold_reason: null }
  },
  release: {
    from: ['review'],
    apply: async (db, f, body, user) => {
      if (!(await allTestsRecorded(db, f))) throw new HttpError(409, 'record every requested test before releasing');
      return {
        status: 'released', lab_remarks: text(body.remarks), released_by_name: user.name, released_at: now(),
        revision: f.revision + 1, report_no: f.report_no || await nextReportNo(db)
      };
    }
  },
  reopen: { from: ['released'], apply: () => ({ status: 'review' }) }
};

// ---------- Server-Sent Events: tell every open client "something changed" ----------

let clients = [];

function broadcast() {
  clients.forEach((res) => res.write('data: {"type":"changed"}\n\n'));
}

// A comment line now and then keeps proxies from closing idle streams.
// unref: the timer alone doesn't keep the process running (migrate-from-sqlite.js).
setInterval(() => clients.forEach((res) => res.write(': ping\n\n')), 25000).unref();

// ---------- app ----------

const app = express();
app.use(express.json());

// Express 4 doesn't pass on errors from async handlers by itself.
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const requireUser = handle(async (req, res, next) => {
  req.user = await currentUser(req);
  if (!req.user) return res.status(401).json({ error: 'sign in first' });
  next();
});

function adminOnly(req, res, next) {
  if (!req.user.admin) return res.status(403).json({ error: 'only an administrator can manage users' });
  next();
}

function only(role) {
  return (req, res, next) => {
    if (req.user.role !== role) return res.status(403).json({ error: `only ${ROLE_LABEL[role]} can do that` });
    next();
  };
}

app.post('/api/login', handle(async (req, res) => {
  const b = req.body || {};
  const name = text(b.name);
  const pin = String(b.pin == null ? '' : b.pin).trim();
  if (!name || !pin) throw new HttpError(400, 'enter your name and PIN');
  const tryKey = req.ip + '|' + nameKey(name);
  const wait = minutesLocked(tryKey);
  if (wait) throw new HttpError(429, `Too many wrong PINs. Try again in ${wait} minute${wait > 1 ? 's' : ''}.`);
  const u = await userByName(name);
  const ok = pinMatches(u ? u.pin_hash : DUMMY_PIN_HASH, pin);
  if (!u || !ok) {
    noteFailedLogin(tryKey);
    throw new HttpError(401, "That name and PIN don't match an account.");
  }
  failedLogins.delete(tryKey);
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO sessions (token_hash, user_id, role, name, created_at) VALUES ($1, $2, $3, $4, $5)',
    [sha256(token), u.id, u.role, u.name, now()]);
  res.setHeader('Set-Cookie', sessionCookie(req, token, SESSION_DAYS * 86400));
  res.json(publicUser(u));
}));

app.get('/api/session', handle(async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'not signed in' });
  const { tokenHash, ...shown } = user;
  res.json(shown);
}));

app.post('/api/logout', handle(async (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
  res.status(204).end();
}));

app.use('/api', requireUser);

app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();
  res.write('retry: 2000\n\n');
  clients.push(res);
  req.on('close', () => {
    clients = clients.filter((c) => c !== res);
  });
});

// ---------- accounts (administrators only) ----------

async function getUser(userId) {
  const u = await one(pool, 'SELECT * FROM users WHERE id = $1', [userId]);
  if (!u) throw new HttpError(404, 'account not found');
  return u;
}

function cleanName(v) {
  const name = (text(v) || '').replace(/\s+/g, ' ').slice(0, 80);
  if (!name) throw new HttpError(400, 'enter a name');
  return name;
}

async function checkNameFree(name, exceptId) {
  const other = await userByName(name);
  if (other && other.id !== exceptId) throw new HttpError(409, `there is already an account named ${other.name}`);
}

function cleanPin(v) {
  const pin = String(v == null ? '' : v).trim();
  if (!PIN_PATTERN.test(pin)) throw new HttpError(400, PIN_RULE);
  return pin;
}

async function adminCount() {
  return (await one(pool, 'SELECT COUNT(*)::int AS n FROM users WHERE is_admin')).n;
}

app.get('/api/users', adminOnly, handle(async (req, res) => {
  res.json((await all(pool, 'SELECT * FROM users ORDER BY role, name_key')).map(publicUser));
}));

app.post('/api/users', adminOnly, handle(async (req, res) => {
  const b = req.body || {};
  const name = cleanName(b.name);
  if (!Object.hasOwn(ROLE_LABEL, b.role)) throw new HttpError(400, 'choose a side');
  const pin = cleanPin(b.pin);
  await checkNameFree(name);
  const userId = id('user');
  await pool.query(`INSERT INTO users (id, name, name_key, role, pin_hash, is_admin, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`,
  [userId, name, nameKey(name), b.role, hashPin(pin), !!b.admin, now()]);
  res.status(201).json(publicUser(await getUser(userId)));
}));

// Change a name, side, administrator flag or PIN. A new PIN signs the
// person out of their other browsers.
app.patch('/api/users/:id', adminOnly, handle(async (req, res) => {
  const u = await getUser(req.params.id);
  const b = req.body || {};
  const changes = {};
  if (b.name !== undefined) {
    changes.name = cleanName(b.name);
    await checkNameFree(changes.name, u.id);
    changes.name_key = nameKey(changes.name);
  }
  if (b.role !== undefined) {
    if (!Object.hasOwn(ROLE_LABEL, b.role)) throw new HttpError(400, 'choose a side');
    changes.role = b.role;
  }
  if (b.admin !== undefined) {
    if (!b.admin && u.is_admin && await adminCount() === 1) throw new HttpError(409, 'keep at least one administrator');
    changes.is_admin = !!b.admin;
  }
  if (b.pin !== undefined) changes.pin_hash = hashPin(cleanPin(b.pin));
  await updateRow(pool, 'users', 'id', u.id, changes);
  if (changes.pin_hash) {
    await pool.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash != $2', [u.id, req.user.tokenHash]);
  }
  res.json(publicUser(await getUser(u.id)));
}));

app.delete('/api/users/:id', adminOnly, handle(async (req, res) => {
  const u = await getUser(req.params.id);
  if (u.id === req.user.id) throw new HttpError(409, "you can't remove your own account");
  if (u.is_admin && await adminCount() === 1) throw new HttpError(409, 'keep at least one administrator');
  await pool.query('DELETE FROM users WHERE id = $1', [u.id]); // their sessions go with it
  res.status(204).end();
}));

// ---------- formulations and results ----------

app.get('/api/formulations', handle(async (req, res) => {
  const rows = await all(pool, 'SELECT * FROM formulations ORDER BY submitted_at DESC');
  const byForm = await resultsByFormulation();
  res.json(rows.map((f) => formulationFor(req.user, f, byForm[f.id] || [])));
}));

app.post('/api/formulations', only('company'), handle(async (req, res) => {
  const b = req.body || {};
  const name = text(b.name), code = text(b.code);
  if (!name || !code) throw new HttpError(400, 'name and code are required');
  const requestedTests = Array.isArray(b.requestedTests)
    ? [...new Set(b.requestedTests.filter((t) => Object.hasOwn(TESTS, t)))]
    : [];
  if (!requestedTests.length) throw new HttpError(400, 'select at least one test');
  const formId = id('form');
  await pool.query(`INSERT INTO formulations
    (id, name, code, description, priority, requested_tests, specs, status, submitted_by_name, submitted_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'submitted', $8, $9)`,
  [formId, name, code, text(b.description), b.priority === 'urgent' ? 'urgent' : 'normal',
    JSON.stringify(requestedTests), JSON.stringify(cleanSpecs(b.specs || {})), req.user.name, now()]);
  broadcast();
  res.status(201).json(formulationFor(req.user, await getFormulation(pool, formId), []));
}));

// Hi-Tech Company can take a formulation back until the lab starts on it.
app.delete('/api/formulations/:id', only('company'), handle(async (req, res) => {
  await transaction(async (db) => {
    const f = await getFormulation(db, req.params.id, true);
    if (f.status !== 'submitted' || (await loadResults(db, f.id)).length) {
      throw new HttpError(409, 'the lab has already started on this formulation — ask them to put it on hold instead');
    }
    await db.query('DELETE FROM formulations WHERE id = $1', [f.id]);
  });
  broadcast();
  res.status(204).end();
}));

app.post('/api/formulations/:id/:action', only('lab'), handle(async (req, res) => {
  const action = Object.hasOwn(LAB_ACTIONS, req.params.action) ? LAB_ACTIONS[req.params.action] : null;
  if (!action) throw new HttpError(404, 'unknown action');
  const f = await transaction(async (db) => {
    const f = await getFormulation(db, req.params.id, true);
    if (!action.from.includes(f.status)) {
      throw new HttpError(409, `can't ${req.params.action} a formulation that is ${STATUS_TEXT[f.status]}`);
    }
    await updateRow(db, 'formulations', 'id', f.id, await action.apply(db, f, req.body || {}, req.user));
    return getFormulation(db, f.id);
  });
  broadcast();
  res.json(formulationFor(req.user, f, await loadResults(pool, f.id)));
}));

app.get('/api/results', handle(async (req, res) => {
  const rows = req.user.role === 'lab'
    ? await all(pool, 'SELECT * FROM results ORDER BY tested_at DESC')
    : await all(pool, `SELECT r.* FROM results r JOIN formulations f ON f.id = r.formulation_id
        WHERE f.status = 'released' ORDER BY r.tested_at DESC`);
  res.json(rows.map(rowToResult));
}));

app.post('/api/results', only('lab'), handle(async (req, res) => {
  const b = req.body || {};
  const row = await transaction(async (db) => {
    const f = await getFormulation(db, b.formulationId, true);
    if (!f.requested_tests.includes(b.testType)) {
      throw new HttpError(400, 'Hi-Tech Company did not request that test for this formulation');
    }
    if (f.status === 'released') {
      throw new HttpError(409, 'these results have been released — reopen the formulation to change them');
    }
    const values = b.values && typeof b.values === 'object' ? b.values : {};
    if (!Number.isFinite(values[TESTS[b.testType].value])) throw new HttpError(400, 'enter the measured value');

    // Recording a test again replaces the earlier result (and keeps its id).
    const row = await one(db, `INSERT INTO results
      (id, formulation_id, test_type, specimen_id, measured, notes, result, tested_by_name, tested_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (formulation_id, test_type) DO UPDATE SET
        specimen_id = EXCLUDED.specimen_id, measured = EXCLUDED.measured, notes = EXCLUDED.notes,
        result = EXCLUDED.result, tested_by_name = EXCLUDED.tested_by_name, tested_at = EXCLUDED.tested_at
      RETURNING *, (xmax = 0) AS inserted`,
    [id('res'), f.id, b.testType, text(b.specimenId), JSON.stringify(values), text(b.notes),
      computeResult(f.specs, b.testType, values), req.user.name, validDate(b.testedAt) || now()]);
    await advanceAfterResult(db, f);
    return row;
  });
  broadcast();
  res.status(row.inserted ? 201 : 200).json(rowToResult(row));
}));

app.delete('/api/results/:id', only('lab'), handle(async (req, res) => {
  await transaction(async (db) => {
    const r = await one(db, 'SELECT * FROM results WHERE id = $1', [req.params.id]);
    if (!r) throw new HttpError(404, 'result not found');
    const f = await getFormulation(db, r.formulation_id, true);
    if (f.status === 'released') {
      throw new HttpError(409, 'these results have been released — reopen the formulation to change them');
    }
    await db.query('DELETE FROM results WHERE id = $1', [r.id]);
    if (f.status === 'review') {
      await db.query("UPDATE formulations SET status = 'in_testing', completed_at = NULL WHERE id = $1", [f.id]);
    }
  });
  broadcast();
  res.status(204).end();
}));

// Everything the printable test report needs. The lab can preview it at
// any time; Hi-Tech Company only once it has been released.
app.get('/api/reports/:id', handle(async (req, res) => {
  const f = await getFormulation(pool, req.params.id);
  if (req.user.role !== 'lab' && f.status !== 'released') {
    throw new HttpError(404, 'this report has not been released yet');
  }
  const results = await loadResults(pool, f.id);
  res.json({ formulation: formulationFor(req.user, f, results), results: results.map(rowToResult) });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

// extensions: /login serves login.html, /history serves history.html, ...
app.use(express.static(CLIENT_DIR, { extensions: ['html'] }));
app.get('*', (req, res) => {
  res.sendFile(path.join(CLIENT_DIR, 'index.html'));
});

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'something went wrong on the server' });
});

// ---------- start ----------

async function main() {
  const startingAccountsMade = await prepareDatabase();
  if (process.argv[2] === 'reset-pin') {
    const code = await resetPin(process.argv[3]);
    await pool.end();
    process.exit(code);
  }
  app.listen(PORT, () => {
    console.log(`Formulation Test Tracker running at http://localhost:${PORT}`);
    if (startingAccountsMade) {
      console.log('\nStarting accounts (change the PINs on the Users page):');
      for (const a of STARTING_ACCOUNTS) {
        console.log(`  ${ROLE_LABEL[a.role]}: name ${a.name}, PIN ${a.pin}${a.admin ? ' (administrator)' : ''}`);
      }
      console.log('');
    }
  });
}

// migrate-from-sqlite.js loads this file for the database connection and
// the tables, without starting the server.
if (require.main === module) {
  main().catch((err) => {
    console.error('Could not start:', err.message);
    process.exit(1);
  });
}

module.exports = { pool, SCHEMA, transaction };
