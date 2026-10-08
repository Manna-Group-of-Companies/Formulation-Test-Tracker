# Formulation Test Tracker

A self-hosted web app for the process where **Hi-Tech Company** sends a
formulation to **Manna Rubber Park**, the Manna lab tests it, and the test
results are sent back as a numbered test report. Both sides use the same
tracker from their own computers, and every open screen updates live.

## Running it

Requirements: [Node.js](https://nodejs.org) 20.12 or newer (the current
LTS is a good choice) and a [Supabase](https://supabase.com) project, whose
Postgres database holds all the data.

1. In `server/`, copy `.env.example` to `.env`.
2. In the Supabase dashboard, click **Connect**, choose **Session pooler**,
   copy the connection string into `DATABASE_URL`, and put the database
   password in place of `[YOUR-PASSWORD]`. `.env` stays on this computer;
   it is not committed.
3. Start it:

```bash
cd server
npm install
npm start
```

The first start creates the tables. If the database has no accounts yet,
it also creates one for each side:

```
Formulation Test Tracker running at http://localhost:3000

Starting accounts (change the PINs on the Users page):
  Hi-Tech Company: name Hi-Tech, PIN 2026
  Manna Rubber Park Lab: name Lab, PIN 2022 (administrator)
```

Open **http://localhost:3000**. Anyone on the same network can reach it at
`http://<this-computer's-IP>:3000`.

### Signing in

Everyone signs in on the **login page** (`/login`) with their own **name
and PIN** (4 to 8 digits); **Show** reveals the PIN as you type it. The
account decides the side, so there is nothing else to choose. Names are
not case-sensitive. The sign-in lasts 30 days in that browser. After 5
wrong PINs for a name, that name has to wait 5 minutes.

- If you opened a particular page while signed out, such as a Test Result
  History bookmark or a Conduct Test or report link, you're taken back to
  it after signing in. Otherwise Hi-Tech Company lands on the **Board**
  and the lab lands on its **Test Queue**.
- The browser remembers your name, never the PIN, so next time you only
  type the PIN.
- **Sign out** (top right) returns you to the login page. If a sign-in
  runs out while a page is open, you're sent to the login page with a
  note saying so.

### Users (administrators)

Administrators get a **Users** link in the top bar. There they add a
person (name, side, PIN, and whether they are an administrator), change
someone's PIN (**New** suggests a random one), make or remove
administrators, and remove accounts. A new PIN signs that person out of
their other browsers; a removed account is signed out everywhere. Things
they sent or recorded keep their name. There is always at least one
administrator.

If the only administrator forgets their PIN, stop the server and run
`node server.js reset-pin "Lab"` in `server/`. It prints a new PIN.

To keep the server running permanently, use a process manager such as
[pm2](https://pm2.keymetrics.io/) (`pm2 start server.js --name formulation-tracker`)
or a Windows service. For HTTPS and a normal domain name, put it behind a
reverse proxy. `npm run dev` restarts the server automatically when you
edit `server.js`.

Settings, in `server/.env` or the environment: `DATABASE_URL` (required)
and `PORT` (default 3000). On a host such as Render, set `DATABASE_URL`
as an environment variable there.

### Pages on Cloudflare Workers (optional)

The Node server already serves the pages itself. To serve them from
Cloudflare instead, deploy `client/` as a Worker: root directory `client`,
build command `npm run build` (it does nothing), deploy command
`npx wrangler deploy`. `client/wrangler.jsonc` uploads the pages as static
assets (`.assetsignore` leaves out everything else), and `client/worker.js`
passes every `/api/*` request on to the Node server, so signing in and
live updates work on the Cloudflare domain. The server's address is
`API_ORIGIN` in `wrangler.jsonc`.

## How the process works

| Step | Who | What happens |
|---|---|---|
| 1. **Send** | Hi-Tech Company | Opens **Add Formulation**. Enters the name, batch code and composition notes, sets the priority, ticks the tests (see the list below, in any combination), and optionally sets acceptance limits for each. The card appears in **Submitted**. Hi-Tech can withdraw it until the lab starts. |
| 2. **Test** | Manna lab | Opens the card and clicks **Start testing**, then records a result for each requested test (specimen/lot, measured value, date, notes). The server grades each result as Pass or Fail against Hi-Tech's limits, or "Recorded" if no limits were set. |
| 2a. *On hold* | Manna lab | If something is missing, the lab clicks **Put on hold** and says what it needs. Hi-Tech sees the reason on the card straight away. **Resume testing** picks up where it left off. |
| 3. **Review** | Manna lab | Once every requested test has a result, the formulation moves itself to **Lab review**. The lab checks the results, previews the report (marked DRAFT), and adds remarks if needed. |
| 4. **Send back** | Manna lab | **Release results to Hi-Tech Company** issues a report number (`TR-2026-0001`, …) and moves the card to **Results sent**. |
| 5. **Receive** | Hi-Tech Company | Sees the measured values, pass/fail for each test, the overall outcome and the lab's remarks, on the board and in **Test Result History**. Can open the **test report** and print it or save it as PDF. |

### Tests the lab can record

| Test | Graded value | Also recorded |
|---|---|---|
| Tensile strength | MPa | Elongation (%) |
| Hardness | value on the chosen scale | Shore A / Shore D / IRHD |
| Specific gravity | ratio | Method |
| Rheometer TS2 (scorch) | minutes | Test temperature (°C) |
| Rheometer TC90 (cure) | minutes | Test temperature (°C) |
| Mooney viscosity | MU | Condition, e.g. ML(1+4) 100 °C |
| Ash content | % | |
| Acetone extraction | % | |
| Carbon black content | % | |
| Mixing | dump temperature (°C) | Mixing time (min) |
| Moulding | cure temperature (°C) | Cure time (min) |

Hi-Tech Company can give a minimum and/or maximum for the graded value of
any of these. Without limits the value is recorded, not graded.

### Hi-Tech Company's pages

When signed in as Hi-Tech Company, the top bar has three links:

- **Board**: the live board of every formulation, by status.
- **Add Formulation**: the form for sending a new formulation to the lab.
  A test's limit fields are enabled only when the test is ticked, and a
  minimum higher than its maximum is caught before sending.
- **Test Result History**: every formulation sent, newest first, with its
  full record. That includes the report number, when it was sent and
  released and by whom, and the turnaround. Each requested test shows the
  specimen, measured value, specification, **Pass/Fail**, test date,
  tester and notes, followed by the overall outcome, the lab's remarks and
  a link to the test report. You can search by name, code or report
  number, and filter by outcome or by test. The page updates live, and on
  a phone each test is shown as a compact block with its Pass/Fail next to
  the test name.

### Manna lab's pages

Lab assistants test each formulation as Hi-Tech Company specified it.
When signed in as the Manna lab, the top bar has:

- **Board**: the same live board.
- **Test Queue**: the assistants' work list. It shows every formulation
  whose results haven't been sent back yet, grouped as **To start**,
  **In testing**, **Ready to release** and **On hold**, with urgent ones
  first and then the longest waiting. Each entry shows Hi-Tech's
  composition notes, each requested test with its limits and whether it's
  done (Pass/Fail) or still to do, how long it has waited, and any hold
  reason. You can search (including the composition text), filter by
  stage, or show urgent only. The queue updates live as assistants record
  results.
- **Conduct Test** (opened from the queue): one formulation on its own
  page, with the composition notes at the top, then **Start testing**,
  **Put on hold**, a form per requested test (specimen/lot, date, measured
  value, notes), and **Release results to Hi-Tech Company** once
  everything is recorded. It updates if someone else changes the
  formulation meanwhile, and says so if Hi-Tech withdraws it.
- **Test Result History**: the same page Hi-Tech uses, except the lab sees
  every result as soon as it's saved, even before release. Formulations
  not yet released link straight to Conduct Test.

Each side's pages refuse the other side politely: Add Formulation shows
"Hi-Tech Company only" to the lab, and Test Queue and Conduct Test show
"Manna lab only" to Hi-Tech.

Until the lab releases the results, Hi-Tech Company sees only the
progress: which tests are done and which are pending. It sees no values
and no pass/fail. If a released result needs correcting, the lab clicks
**Reopen to correct results**. That withdraws the results from Hi-Tech
until the lab releases them again, and the report number stays the same
with the revision number going up.

The server checks every rule: only Hi-Tech Company can send or withdraw
formulations, and only the lab can record, release or reopen results.
Hiding a button in the browser is not what enforces this.

## Phones, tablets and large screens

Every page works from a 320px phone up to a wide desktop monitor:

- **Phones:** the top bar scrolls away instead of staying pinned, and the
  page links become an even tab bar. On the narrowest phones the labels
  shorten to "Add", "Queue" and "History". Summary tiles sit two to a row,
  the board's stages stack vertically, and tables (Results sent back, test
  history, the test report) turn into labelled blocks, with Pass/Fail next
  to each test name. Buttons in forms stretch to full width.
- **Tablets:** the board keeps all five stages side by side and scrolls
  sideways. Tiles sit three to a row.
- **Laptops and wide screens:** the full five-column board. On screens
  1440px and wider, pages use up to 1360px of width.
- **Touch screens:** buttons, links and form fields are at least 40–44px
  tall, and form text is 16px so iPhones don't zoom in when you tap a
  field.
- **Other details:** phones held sideways get a top bar that scrolls away
  too; content stays clear of notches; long names shorten with "…"; and
  the test report still prints on A4 as a normal table.

## What's in here

```
server/
  server.js        Express API, sign-in, workflow rules, live updates, static files
  migrate-from-sqlite.js   one-time copy of the old data/tracker.db into Postgres
  package.json     Node dependencies (express, pg; better-sqlite3 for the copy)
  .env.example     copy to .env and fill in DATABASE_URL
client/
  login.html       the login page (also at /login)
  index.html       the board
  add.html         Add Formulation (Hi-Tech Company)
  queue.html       Test Queue (Manna lab)
  test.html        Conduct Test for one formulation (test.html?id=…, Manna lab)
  history.html     Test Result History (both sides)
  users.html       Users: accounts and PINs (administrators)
  report.html      printable test report (report.html?id=…)
  package.json, wrangler.jsonc, worker.js, .assetsignore
                   Cloudflare Workers only: the pages as assets, /api/* to the Node server
  css/styles.css, css/report.css
  js/
    api.js         fetch wrapper; reports when the sign-in has ended
    login.js       the login form: name and PIN, Show/Hide, where to go next
    session.js     who is signed in, role label, sign-out
    page.js        start-up for signed-in pages: to the login page and back
    add.js         Add Formulation form
    queue.js       Test Queue grouping, ordering and filters
    test.js        Conduct Test page
    history.js     Test Result History list, search and filters
    users.js       Users page: add people, change PINs, administrators
    state.js       the in-memory copy of formulations/results
    format.js      display formatting, spec text, badges, status names
    toast.js       bottom-of-screen status messages
    live.js        Server-Sent Events client
    main.js        the board's entry point
    report.js      renders the test report
    views/formulations.js   board tiles, status columns, results sent back
    views/detail.js         one formulation with each side's controls: result
                            entry, hold, release (board panel and Conduct Test)
```

## Data

Everything lives in the Supabase Postgres database, in four tables:
`formulations`, `results`, `users` and `sessions`. Supabase backs it up
daily (on paid plans). The tables have row level security switched on with
no policies, so Supabase's public Data API (the publishable key) can't read
or change them; only this server, using the database password, can.

### Moving over from the SQLite version

Earlier versions kept everything in `server/data/tracker.db`. To copy it
into Supabase, set up `.env` as above, then in `server/`:

```bash
node migrate-from-sqlite.js
```

Run it before the first `npm start`, so the starting accounts aren't
created. Formulations, results, report numbers and accounts come across,
and everyone keeps their PIN; they sign in once more. Running it again
doesn't duplicate anything. Formulations that the first version marked
"completed" move to **Lab review**, so the lab can release them properly.

## API

JSON over HTTP. Sign in with `POST /api/login` first; the session is a cookie.

- `POST /api/login` `{name, pin}`, `GET /api/session`, `POST /api/logout`
- `GET /api/users`, `POST /api/users` `{name, role, pin, admin}`, `PATCH /api/users/:id`, `DELETE /api/users/:id` (administrators)
- `GET /api/formulations`; `POST /api/formulations` (company); `DELETE /api/formulations/:id` (company, withdraw before testing starts)
- `POST /api/formulations/:id/start|hold|resume|release|reopen` (lab). `hold` takes `{reason}`, `release` takes `{remarks}`
- `GET /api/results`; `POST /api/results`, `DELETE /api/results/:id` (lab)
- `GET /api/reports/:id`: everything the test report shows
- `GET /api/events`: Server-Sent Events, one message per change

To add another test type: add it to `TESTS` in `server.js` (the value it
is graded on and its spec keys) and to `TEST_META` in `client/js/format.js`
(label, unit, the same keys, and an optional second field). The Add
Formulation form, the result entry form, the history filter and the report
are all built from `TEST_META`.
