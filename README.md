# Formulation Test Tracker

A web app for the process where **Hi-Tech Company** sends a formulation
to **Manna Rubber Park**, the Manna lab tests it, and the test results are
sent back as a numbered test report. Both sides use the same tracker from
their own computers, and every open screen updates live.

It has two parts and no server of its own:

- **`client/`**: the pages, a React app (Vite). Cloudflare Workers serves
  the built files.
- **Supabase**: Postgres holds the data and enforces every rule (database
  functions and row level security, in `supabase/migrations/`). Supabase
  Auth handles sign-in, Realtime sends live updates, and an Edge Function
  (`supabase/functions/ftt-admin-users/`) manages accounts.

## Setting it up

You need [Node.js](https://nodejs.org) 20.12 or newer and the Supabase
project `nnjwggmixzkdzpeezayj`. One-off steps:

1. **Keys.** In `tools/`, copy `.env.example` to `.env` (never committed).
   Fill in `DATABASE_URL` (dashboard → **Connect** → **Session pooler**,
   with the database password) and `SUPABASE_SECRET_KEY` (dashboard →
   **Project Settings → API Keys → Secret keys**).
2. **Database.** In `tools/`: `npm install`, then `npm run migrate`. This
   creates the tables, functions and access rules. It is safe to run again
   after pulling changes to `supabase/migrations/`.
3. **Accounts function.** Deploy the Edge Function the Users page uses:
   `npx supabase functions deploy ftt-admin-users --project-ref nnjwggmixzkdzpeezayj`
   (after `npx supabase login` once). `supabase/config.toml` turns off the
   gateway's JWT check for it, because the function checks the sign-in
   itself.
4. **First administrator.** In `tools/`:
   `npm run create-account -- "Lab" lab --admin`. It prints a PIN. Sign in
   with it and add everyone else on the **Users** page.
5. **Sign-ups off.** In the dashboard: **Authentication → Sign In /
   Providers → Allow new users to sign up: off**. Accounts are only made by
   administrators. A stranger's sign-up couldn't see anything anyway, since
   every function needs a profile, but there is no reason to allow it.

### Running the pages locally

```bash
cd client
npm install
npm run dev
```

Open **http://localhost:5173**. `npm run dev` uses the same Supabase
project (`client/.env.development`); put other values in
`client/.env.local` to use another one.

### Deploying (Cloudflare Workers)

The Cloudflare project builds from this repository: root directory
`client`, build command `npm run Build`, deploy command
`npx wrangler deploy`. `client/wrangler.jsonc` serves `client/dist` and
gives every unknown address `index.html`, so links like `/test/…` and
`/report/…` open the right page. Addresses from the earlier version
(`report.html?id=…`, `test.html?id=…`, `queue.html`, …) still work.

The publishable key in `client/.env.production` is meant to be public: it
only lets a browser call what the database functions allow.

### Signing in

Everyone signs in on the **login page** (`/login`) with their own **name
and PIN** (6 to 8 digits); **Show** reveals the PIN as you type it. The
account decides the side, so there is nothing else to choose. Names are
not case-sensitive. Supabase Auth keeps the sign-in in that browser and
renews it, and slows down repeated wrong PINs from the same address.

Behind the scenes a name becomes an internal email address
(`u<hash>@tracker.mannarubber.com`) and the PIN is that account's
password. No mail is ever sent to these addresses.

- If you opened a particular page while signed out, such as a Test Result
  History bookmark or a Conduct Test or report link, you're taken back to
  it after signing in. Otherwise Hi-Tech Company lands on the **Board**
  and the lab lands on its **Test Queue**.
- The browser remembers your name, never the PIN, so next time you only
  type the PIN.
- **Sign out** (top right) returns you to the login page. If a sign-in
  ends while a page is open, you're sent to the login page with a note
  saying so.

### Users (administrators)

Administrators get a **Users** link in the top bar. There they add a
person (name, side, PIN, and whether they are an administrator), change
someone's PIN (**New** suggests a random one), make or remove
administrators, and remove accounts. A new PIN signs that person out of
their other browsers. Things they sent or recorded keep their name. There
is always at least one administrator.

If the only administrator forgets their PIN, run
`npm run create-account -- "<their name>" lab --admin` in `tools/`. It
gives the existing account a new PIN and prints it.

## How the process works

| Step | Who | What happens |
|---|---|---|
| 1. **Send** | Hi-Tech Company | Opens **Add Formulation**. Enters the name and batch code, sets the priority, gives the raw materials as a percentage of the reactor charge (Crumb, RA 480, Process Oil, Pine Tar and Water to start with; more can be added; they can't total more than 100 %), the reactor conditions (temperature °C, cooking time min, pressure kg/cm², air releasing time min) and any notes, ticks the tests (see the list below, in any combination), and optionally sets acceptance limits for each. The card appears in **Submitted**. Hi-Tech can withdraw it until the lab starts. |
| 2. **Test** | Manna lab | Opens the card and clicks **Start testing**, then records a result for each requested test (specimen/lot, measured value, date, notes). The database grades each result as Pass or Fail against Hi-Tech's limits, or "Recorded" if no limits were set. |
| 2a. *On hold* | Manna lab | If something is missing, the lab clicks **Put on hold** and says what it needs. Hi-Tech sees the reason on the card straight away. **Resume testing** picks up where it left off. |
| 3. **Review** | Manna lab | Once every requested test has a result, the formulation moves itself to **Lab review**. The lab checks the results, previews the report (marked DRAFT), and adds remarks if needed. |
| 4. **Send back** | Manna lab | **Release results to Hi-Tech Company** issues a report number (`TR-2026-0001`, …) and moves the card to **Results sent**. |
| 5. **Receive** | Hi-Tech Company | Sees the measured values, pass/fail for each test, the overall outcome and the lab's remarks, on the board and in **Test Result History**. Can open the **test report** and print it or save it as PDF. |

### Tests the lab can record

| Test | Graded value | Also recorded |
|---|---|---|
| Cure time (TC90) | minutes | Test temperature (°C) |
| Scorch time (TS2) | minutes | Test temperature (°C) |
| Specific gravity after moulding | ratio | Method |
| Hardness | value on the chosen scale | Shore A / Shore D / IRHD |
| Tensile strength | MPa | |
| Elongation at break | % | |

Formulations from before the reactor version may also have Mooney
viscosity, ash, acetone extraction, carbon black, mixing or moulding
tests; those still show and can still be recorded, but new formulations
can't ask for them.

Hi-Tech Company can give a minimum and/or maximum for the graded value of
any of these. Without limits the value is recorded, not graded.

### Hi-Tech Company's pages

When signed in as Hi-Tech Company, the top bar has three links:

- **Board**: the live board of every formulation, by status.
- **Add Formulation**: the form for sending a new formulation to the lab.
  The raw materials show their total as you type. A test's limit fields
  are enabled only when the test is ticked, and a minimum higher than its
  maximum is caught before sending.
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
  first and then the longest waiting. Each entry shows Hi-Tech's reactor
  recipe, each requested test with its limits and whether it's done
  (Pass/Fail) or still to do, how long it has waited, and any hold reason.
  You can search (including raw material names), filter by stage, or show
  urgent only. The queue updates live as assistants record results.
- **Conduct Test** (opened from the queue): one formulation on its own
  page, with the reactor recipe at the top, then **Start testing**,
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

The database checks every rule: only Hi-Tech Company can send or withdraw
formulations, only the lab can record, release or reopen results, and
Hi-Tech's view of a formulation leaves out grades and remarks until the
release. Hiding a button in the browser is not what enforces this.

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
client/                    the pages (React + Vite)
  src/App.jsx              the pages and their addresses
  src/pages/               Login, Board, AddFormulation, Queue, ConductTest,
                           History, Users, Report
  src/components/          FormulationDetail (one formulation with each side's
                           controls: result entry, hold, release), Layout (top
                           bar, sign-in check), bits (badges, tiles, recipe)
  src/context/             session (who is signed in), data (formulations and
                           results, reloaded on every Realtime "changed"), toast
  src/lib/                 supabase (the client), api (every database call),
                           auth (name + PIN sign-in), format (tests, recipe,
                           display text)
  src/styles/              app.css, report.css (scoped to the report page)
  .env.production          the Supabase URL and publishable key (public)
  wrangler.jsonc           Cloudflare Workers: serve dist/ as a single-page app
supabase/
  migrations/              tables, access rules and every workflow rule (SQL)
  functions/ftt-admin-users/   adding, changing and removing accounts
  config.toml              Supabase CLI settings
tools/                     one-off setup: npm run migrate, npm run create-account
```

## Data

Everything lives in the Supabase Postgres database: `formulations`,
`results` and `profiles` (each account's name, side and administrator
flag; the account itself is in Supabase Auth). The browser can't read or
change these tables directly. Row level security is on with no policies,
and the table privileges are revoked. Every read and write goes through the
`ftt_*` functions, which check who is asking. The tables `users` and
`sessions` are left over from the earlier Node server and are no longer
used. They can be dropped once everyone has their new account.

Each change sends a small "changed" message on the public Realtime channel
`ftt-changes`, and every open page reloads its data. The message carries
nothing but the table name. Pages also reload when the tab comes back into
view, and once a minute in case a message was missed.

## API

The pages call these database functions with `supabase.rpc` (see
`client/src/lib/api.js`). Each one needs a signed-in account with a
profile.

- `ftt_session()`: who is signed in
- `ftt_list()`: every formulation, and the results this side may see
- `ftt_submit(payload)` (Hi-Tech Company), `ftt_withdraw(formulation_id)`
  (Hi-Tech Company, before testing starts)
- `ftt_lab_action(formulation_id, action, body)` (lab): `start`, `hold`
  (`{reason}`), `resume`, `release` (`{remarks}`), `reopen`
- `ftt_record_result(payload)`, `ftt_delete_result(result_id)` (lab)
- `ftt_report(formulation_id)`: everything the test report shows
- `ftt_list_users()` (administrators). Adding, changing and removing
  accounts goes through the `ftt-admin-users` Edge Function (`create`,
  `update`, `delete`)

To add another test type, add it to `tracker_private.tests()` in a new
migration (the value it is graded on and its spec keys), and to `TEST_META`
in `client/src/lib/format.js` (label, unit, the same keys, and an optional
second field). The Add Formulation form, the result entry form, the
history filter and the report are all built from `TEST_META`.
