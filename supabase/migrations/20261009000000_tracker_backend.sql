-- Formulation Test Tracker — the whole backend, in Supabase.
--
-- Hi-Tech Company sends a formulation (its reactor recipe: raw materials as
-- % of the charge and the reactor conditions) with the tests it wants run
-- and optional acceptance limits. The Manna Rubber Park lab records a result
-- for each requested test; these functions grade each one against the
-- limits and move the formulation along
--
--   submitted -> in_testing -> review -> released     (or on_hold before release)
--
-- "review" means every requested test is recorded and the lab is checking
-- before sending the results back. Releasing issues a numbered test report,
-- and only then can Hi-Tech Company see the measured values and pass/fail.
--
-- Everyone signs in with Supabase Auth (the browser turns their name into
-- an internal email address and uses the PIN as the password). Each account
-- has a row in profiles saying which side it belongs to.
--
-- The browser never reads or writes the tables directly: row level security
-- is on with no policies, and the table privileges are revoked. Every read
-- and write goes through the public.ftt_* functions below, which check who
-- is asking and what they may do or see. Each change sends a small
-- "changed" message on the public Realtime channel "ftt-changes", so every
-- open page reloads. The message carries only the table name.
--
-- Safe to run more than once.

create schema if not exists tracker_private;
revoke all on schema tracker_private from public, anon, authenticated;

-- ---------- tables ----------

-- A formulation Hi-Tech Company sends to the lab for testing.
create table if not exists public.formulations (
  id text primary key,
  name text not null,
  code text not null,
  description text,
  priority text not null default 'normal',
  requested_tests jsonb not null,
  specs jsonb not null,
  materials jsonb not null default '[]',  -- [{name, percent}], % of the reactor charge
  reactor jsonb not null default '{}',    -- temperature, cookingTime, pressure, airReleaseTime
  status text not null default 'submitted',
  hold_reason text,                       -- what the lab needs, while on_hold
  submitted_by_name text,
  submitted_at timestamptz not null,
  completed_at timestamptz,               -- when the last requested test was recorded
  report_no text unique,                  -- assigned on first release, e.g. TR-2026-0001
  revision integer not null default 0,
  lab_remarks text,
  released_by_name text,
  released_at timestamptz
);
-- Databases made before the reactor recipe was added.
alter table public.formulations add column if not exists materials jsonb not null default '[]';
alter table public.formulations add column if not exists reactor jsonb not null default '{}';

-- One test result recorded against a formulation (at most one per
-- requested test type — recording again replaces it).
create table if not exists public.results (
  id text primary key,
  formulation_id text not null references public.formulations(id) on delete cascade,
  test_type text not null,
  specimen_id text,
  measured jsonb not null,
  notes text,
  result text not null,
  tested_by_name text,
  tested_at timestamptz not null,
  unique (formulation_id, test_type)
);

-- Who each signed-in account is: name, side, administrator. The account
-- itself (and its PIN, as the password) lives in auth.users.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  name_key text not null unique,  -- the name lower-cased, as used for signing in
  role text not null check (role in ('company', 'lab')),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.formulations enable row level security;
alter table public.results enable row level security;
alter table public.profiles enable row level security;
revoke all on public.formulations, public.results, public.profiles from anon, authenticated;

-- The Node server's own accounts and sign-ins, from before Supabase Auth.
-- Nothing uses them any more; keep them out of reach until they're dropped.
do $$ begin
  if to_regclass('public.users') is not null then
    execute 'alter table public.users enable row level security';
    execute 'revoke all on public.users from anon, authenticated';
  end if;
  if to_regclass('public.sessions') is not null then
    execute 'alter table public.sessions enable row level security';
    execute 'revoke all on public.sessions from anon, authenticated';
  end if;
end $$;

-- ---------- helpers (not callable from the browser) ----------

-- The measured value each test is graded on, and the spec limits (keys into
-- the formulation's specs) it's graded against. Keep in step with
-- TEST_META in client/src/lib/format.js.
create or replace function tracker_private.tests() returns jsonb
language sql immutable set search_path = '' as $$
  select '{
    "rheo_tc90":        {"value": "tc90",            "min": "tc90Min",       "max": "tc90Max"},
    "rheo_ts2":         {"value": "ts2",             "min": "ts2Min",        "max": "ts2Max"},
    "specific_gravity": {"value": "sgValue",         "min": "sgMin",         "max": "sgMax"},
    "hardness":         {"value": "hardnessValue",   "min": "hardnessMin",   "max": "hardnessMax"},
    "tensile":          {"value": "tensileStrength", "min": "tensileMin",    "max": "tensileMax"},
    "elongation":       {"value": "elongationValue", "min": "elongationMin", "max": "elongationMax"},
    "mooney":           {"value": "mooneyValue",     "min": "mooneyMin",     "max": "mooneyMax"},
    "ash":              {"value": "ashValue",        "min": "ashMin",        "max": "ashMax"},
    "acetone":          {"value": "acetoneValue",    "min": "acetoneMin",    "max": "acetoneMax"},
    "carbon_black":     {"value": "cbValue",         "min": "cbMin",         "max": "cbMax"},
    "mixing":           {"value": "dumpTemp",        "min": "mixingMin",     "max": "mixingMax"},
    "moulding":         {"value": "cureTemp",        "min": "mouldingMin",   "max": "mouldingMax"}
  }'::jsonb
$$;

-- An error the person sees as it is. 28000 means "not signed in" to the
-- browser, which then goes to the login page.
create or replace function tracker_private.fail(msg text, code text default 'P0001') returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using message = msg, errcode = code;
end $$;

-- The signed-in person's profile; stops if there is none.
create or replace function tracker_private.me() returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then
    perform tracker_private.fail('sign in first', '28000');
  end if;
  return p;
end $$;

create or replace function tracker_private.require_role(p public.profiles, want text) returns void
language plpgsql set search_path = '' as $$
begin
  if p.role <> want then
    perform tracker_private.fail('only ' || case want when 'company' then 'Hi-Tech Company' else 'Manna Rubber Park Lab' end || ' can do that');
  end if;
end $$;

-- Trimmed text, or null when empty.
create or replace function tracker_private.txt(v jsonb) returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim(case when v is null or jsonb_typeof(v) = 'null' then null
                           when jsonb_typeof(v) = 'string' then v #>> '{}'
                           else v::text end), '')
$$;

-- A number from a JSON number or numeric string, else null.
create or replace function tracker_private.num(v jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select case
    when v is null then null
    when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric
    when jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$'
      then btrim(v #>> '{}')::numeric
    else null end
$$;

create or replace function tracker_private.new_id(prefix text) returns text
language sql volatile set search_path = '' as $$
  select prefix || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
$$;

-- Keep only the known limit keys, as numbers (or null), plus the hardness scale.
create or replace function tracker_private.clean_specs(s jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare out jsonb := '{}'; t jsonb;
begin
  s := coalesce(s, '{}');
  for t in select value from jsonb_each(tracker_private.tests()) loop
    out := out || jsonb_build_object(t ->> 'min', tracker_private.num(s -> (t ->> 'min')),
                                     t ->> 'max', tracker_private.num(s -> (t ->> 'max')));
  end loop;
  return out || jsonb_build_object('hardnessScale', tracker_private.txt(s -> 'hardnessScale'));
end $$;

-- Raw materials as [{name, percent}]: each needs a name and a percentage
-- from 0 to 100, and together they can't go over 100 %.
create or replace function tracker_private.clean_materials(list jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare out jsonb := '[]'; m jsonb; nm text; pct numeric; total numeric := 0; n int := 0;
begin
  if list is null or jsonb_typeof(list) <> 'array' then return '[]'; end if;
  for m in select value from jsonb_array_elements(list) loop
    n := n + 1;
    exit when n > 30;
    nm := left(tracker_private.txt(m -> 'name'), 60);
    pct := tracker_private.num(m -> 'percent');
    continue when nm is null and pct is null;
    if nm is null then perform tracker_private.fail('give a name for the material at ' || pct || ' %'); end if;
    if pct is null then perform tracker_private.fail('enter the percentage for ' || nm); end if;
    if pct < 0 or pct > 100 then perform tracker_private.fail(nm || ': the percentage must be between 0 and 100'); end if;
    total := total + pct;
    out := out || jsonb_build_array(jsonb_build_object('name', nm, 'percent', pct));
  end loop;
  if total > 100.0001 then perform tracker_private.fail('the raw materials add up to more than 100 %'); end if;
  return out;
end $$;

create or replace function tracker_private.clean_reactor(r jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'temperature', tracker_private.num(r -> 'temperature'),
    'cookingTime', tracker_private.num(r -> 'cookingTime'),
    'pressure', tracker_private.num(r -> 'pressure'),
    'airReleaseTime', tracker_private.num(r -> 'airReleaseTime'))
$$;

-- pass / fail against the limits, or "recorded" when there are none.
create or replace function tracker_private.grade(specs jsonb, test_type text, measured jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare t jsonb := tracker_private.tests() -> test_type; lo numeric; hi numeric; val numeric;
begin
  lo := tracker_private.num(specs -> (t ->> 'min'));
  hi := tracker_private.num(specs -> (t ->> 'max'));
  val := tracker_private.num(measured -> (t ->> 'value'));
  if lo is null and hi is null then return 'recorded'; end if;
  if (lo is not null and val < lo) or (hi is not null and val > hi) then return 'fail'; end if;
  return 'pass';
end $$;

create or replace function tracker_private.all_recorded(fid text, requested jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from jsonb_array_elements_text(requested) t(x)
    where not exists (select 1 from public.results r where r.formulation_id = fid and r.test_type = t.x))
$$;

-- The overall outcome once every requested test is recorded: fail if any
-- failed, recorded if any had no limits, otherwise pass.
create or replace function tracker_private.outcome_of(fid text, requested jsonb) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when not tracker_private.all_recorded(fid, requested) then null
    when exists (select 1 from public.results r where r.formulation_id = fid and r.result = 'fail') then 'fail'
    when exists (select 1 from public.results r where r.formulation_id = fid and r.result = 'recorded') then 'recorded'
    else 'pass' end
$$;

-- What a formulation looks like to the person asking. Hi-Tech Company sees
-- which tests are done while testing is under way, but the grades, overall
-- outcome and lab remarks only once the results are released.
create or replace function tracker_private.formulation_json(viewer_role text, f public.formulations) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare visible boolean := viewer_role = 'lab' or f.status = 'released'; done jsonb;
begin
  select coalesce(jsonb_agg(distinct r.test_type), '[]') into done from public.results r where r.formulation_id = f.id;
  return jsonb_build_object(
    'id', f.id, 'name', f.name, 'code', f.code, 'description', f.description, 'priority', f.priority,
    'requestedTests', f.requested_tests, 'specs', f.specs, 'materials', f.materials, 'reactor', f.reactor,
    'status', f.status, 'holdReason', f.hold_reason,
    'submittedByName', f.submitted_by_name, 'submittedAt', f.submitted_at, 'completedAt', f.completed_at,
    'testsDone', done,
    'outcome', case when visible then tracker_private.outcome_of(f.id, f.requested_tests) end,
    'reportNo', f.report_no, 'revision', f.revision,
    'labRemarks', case when visible then f.lab_remarks end,
    'releasedByName', f.released_by_name, 'releasedAt', f.released_at);
end $$;

create or replace function tracker_private.result_json(r public.results) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'formulationId', r.formulation_id, 'testType', r.test_type, 'specimenId', r.specimen_id,
    'values', r.measured, 'notes', r.notes, 'result', r.result,
    'testedByName', r.tested_by_name, 'testedAt', r.tested_at)
$$;

create or replace function tracker_private.locked_formulation(fid text) returns public.formulations
language plpgsql volatile security definer set search_path = '' as $$
declare f public.formulations;
begin
  select * into f from public.formulations where id = fid for update;
  if f.id is null then perform tracker_private.fail('formulation not found'); end if;
  return f;
end $$;

-- Report numbers run per year: TR-2026-0001, TR-2026-0002, ... The lock
-- stops two releases at the same moment from taking the same number.
create or replace function tracker_private.next_report_no() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare prefix text := 'TR-' || extract(year from now())::int || '-'; last text;
begin
  perform pg_advisory_xact_lock(7301);
  select report_no into last from public.formulations where report_no like prefix || '%' order by report_no desc limit 1;
  return prefix || lpad((coalesce(substr(last, length(prefix) + 1)::int, 0) + 1)::text, 4, '0');
end $$;

-- After a result is saved or removed, move the formulation along:
-- in_testing while tests are missing, review once every requested test is
-- recorded. A formulation on hold stays there until the lab resumes it.
create or replace function tracker_private.advance(fid text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare f public.formulations;
begin
  select * into f from public.formulations where id = fid;
  if f.status in ('on_hold', 'released') then return; end if;
  if tracker_private.all_recorded(f.id, f.requested_tests) then
    update public.formulations set status = 'review', completed_at = coalesce(completed_at, now()) where id = fid;
  else
    update public.formulations set status = 'in_testing', completed_at = null where id = fid;
  end if;
end $$;

-- Tell every open page that something changed. A failure here (Realtime
-- not available) must not undo the change itself.
create or replace function tracker_private.broadcast_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform realtime.send(jsonb_build_object('table', tg_table_name), 'changed', 'ftt-changes', false);
  exception when others then
    null;
  end;
  return null;
end $$;

drop trigger if exists ftt_broadcast on public.formulations;
create trigger ftt_broadcast after insert or update or delete on public.formulations
  for each statement execute function tracker_private.broadcast_change();
drop trigger if exists ftt_broadcast on public.results;
create trigger ftt_broadcast after insert or update or delete on public.results
  for each statement execute function tracker_private.broadcast_change();

-- ---------- the API the browser calls (supabase.rpc) ----------

-- Who is signed in.
create or replace function public.ftt_session() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles := tracker_private.me();
begin
  return jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role, 'admin', p.is_admin);
end $$;

-- Every formulation and the results the person may see: the lab sees all,
-- Hi-Tech Company only those of released formulations.
create or replace function public.ftt_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles := tracker_private.me();
begin
  return jsonb_build_object(
    'formulations', coalesce((select jsonb_agg(tracker_private.formulation_json(p.role, f) order by f.submitted_at desc)
                              from public.formulations f), '[]'),
    'results', coalesce((select jsonb_agg(tracker_private.result_json(r) order by r.tested_at desc)
                         from public.results r join public.formulations f on f.id = r.formulation_id
                         where p.role = 'lab' or f.status = 'released'), '[]'));
end $$;

-- Hi-Tech Company sends a formulation.
create or replace function public.ftt_submit(payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.profiles := tracker_private.me();
  nm text := tracker_private.txt(payload -> 'name');
  cd text := tracker_private.txt(payload -> 'code');
  requested jsonb;
  f public.formulations;
begin
  perform tracker_private.require_role(p, 'company');
  if nm is null or cd is null then perform tracker_private.fail('name and code are required'); end if;
  select coalesce(jsonb_agg(t order by first_at), '[]') into requested from (
    select t, min(ord) as first_at
    from jsonb_array_elements_text(case when jsonb_typeof(payload -> 'requestedTests') = 'array' then payload -> 'requestedTests' else '[]' end)
         with ordinality as e(t, ord)
    where tracker_private.tests() ? t
    group by t) x;
  if jsonb_array_length(requested) = 0 then perform tracker_private.fail('select at least one test'); end if;
  insert into public.formulations
    (id, name, code, description, priority, requested_tests, specs, materials, reactor, status, submitted_by_name, submitted_at)
  values (tracker_private.new_id('form'), nm, cd, tracker_private.txt(payload -> 'description'),
    case when payload ->> 'priority' = 'urgent' then 'urgent' else 'normal' end,
    requested, tracker_private.clean_specs(payload -> 'specs'),
    tracker_private.clean_materials(payload -> 'materials'), tracker_private.clean_reactor(payload -> 'reactor'),
    'submitted', p.name, now())
  returning * into f;
  return tracker_private.formulation_json(p.role, f);
end $$;

-- Hi-Tech Company can take a formulation back until the lab starts on it.
create or replace function public.ftt_withdraw(formulation_id text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare p public.profiles := tracker_private.me(); f public.formulations;
begin
  perform tracker_private.require_role(p, 'company');
  f := tracker_private.locked_formulation(formulation_id);
  if f.status <> 'submitted' or exists (select 1 from public.results r where r.formulation_id = f.id) then
    perform tracker_private.fail('the lab has already started on this formulation — ask them to put it on hold instead');
  end if;
  delete from public.formulations where id = f.id;
end $$;

-- What the lab does to a formulation: start, hold (with a reason), resume,
-- release (with optional remarks; issues the report number) and reopen.
create or replace function public.ftt_lab_action(formulation_id text, action text, body jsonb default '{}') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.profiles := tracker_private.me();
  f public.formulations;
  allowed text[];
  reason text;
  status_text constant jsonb := '{"submitted":"submitted","in_testing":"in testing","on_hold":"on hold","review":"in lab review","released":"released"}';
begin
  perform tracker_private.require_role(p, 'lab');
  allowed := case action
    when 'start' then array['submitted']
    when 'hold' then array['submitted', 'in_testing', 'review']
    when 'resume' then array['on_hold']
    when 'release' then array['review']
    when 'reopen' then array['released'] end;
  if allowed is null then perform tracker_private.fail('unknown action'); end if;
  f := tracker_private.locked_formulation(formulation_id);
  if not f.status = any(allowed) then
    perform tracker_private.fail('can''t ' || action || ' a formulation that is ' || (status_text ->> f.status));
  end if;

  if action = 'start' then
    update public.formulations set status = 'in_testing' where id = f.id;
  elsif action = 'hold' then
    reason := tracker_private.txt(body -> 'reason');
    if reason is null then perform tracker_private.fail('say what the lab needs, so Hi-Tech Company knows why it is on hold'); end if;
    update public.formulations set status = 'on_hold', hold_reason = reason where id = f.id;
  elsif action = 'resume' then
    if tracker_private.all_recorded(f.id, f.requested_tests) then
      update public.formulations set status = 'review', hold_reason = null, completed_at = coalesce(completed_at, now()) where id = f.id;
    else
      update public.formulations set status = 'in_testing', hold_reason = null where id = f.id;
    end if;
  elsif action = 'release' then
    if not tracker_private.all_recorded(f.id, f.requested_tests) then
      perform tracker_private.fail('record every requested test before releasing');
    end if;
    update public.formulations set status = 'released', lab_remarks = tracker_private.txt(body -> 'remarks'),
      released_by_name = p.name, released_at = now(), revision = revision + 1,
      report_no = coalesce(report_no, tracker_private.next_report_no())
    where id = f.id;
  elsif action = 'reopen' then
    update public.formulations set status = 'review' where id = f.id;
  end if;

  select * into f from public.formulations where id = f.id;
  return tracker_private.formulation_json(p.role, f);
end $$;

-- The lab records a result (recording a test again replaces the earlier
-- result and keeps its id). The grade is worked out here, never trusted
-- from the browser.
create or replace function public.ftt_record_result(payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.profiles := tracker_private.me();
  f public.formulations;
  ttype text := payload ->> 'testType';
  vals jsonb := case when jsonb_typeof(payload -> 'values') = 'object' then payload -> 'values' else '{}' end;
  when_tested timestamptz;
  r public.results;
begin
  perform tracker_private.require_role(p, 'lab');
  f := tracker_private.locked_formulation(payload ->> 'formulationId');
  if ttype is null or not f.requested_tests ? ttype then
    perform tracker_private.fail('Hi-Tech Company did not request that test for this formulation');
  end if;
  if f.status = 'released' then
    perform tracker_private.fail('these results have been released — reopen the formulation to change them');
  end if;
  if jsonb_typeof(vals -> (tracker_private.tests() -> ttype ->> 'value')) is distinct from 'number' then
    perform tracker_private.fail('enter the measured value');
  end if;
  begin
    when_tested := coalesce((payload ->> 'testedAt')::timestamptz, now());
  exception when others then
    when_tested := now();
  end;

  insert into public.results (id, formulation_id, test_type, specimen_id, measured, notes, result, tested_by_name, tested_at)
  values (tracker_private.new_id('res'), f.id, ttype, tracker_private.txt(payload -> 'specimenId'), vals,
    tracker_private.txt(payload -> 'notes'), tracker_private.grade(f.specs, ttype, vals), p.name, when_tested)
  on conflict (formulation_id, test_type) do update set
    specimen_id = excluded.specimen_id, measured = excluded.measured, notes = excluded.notes,
    result = excluded.result, tested_by_name = excluded.tested_by_name, tested_at = excluded.tested_at
  returning * into r;

  perform tracker_private.advance(f.id);
  return tracker_private.result_json(r);
end $$;

create or replace function public.ftt_delete_result(result_id text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare p public.profiles := tracker_private.me(); r public.results; f public.formulations;
begin
  perform tracker_private.require_role(p, 'lab');
  select * into r from public.results where id = result_id;
  if r.id is null then perform tracker_private.fail('result not found'); end if;
  f := tracker_private.locked_formulation(r.formulation_id);
  if f.status = 'released' then
    perform tracker_private.fail('these results have been released — reopen the formulation to change them');
  end if;
  delete from public.results where id = r.id;
  perform tracker_private.advance(f.id);
end $$;

-- Everything the printable test report needs. The lab can preview it at
-- any time; Hi-Tech Company only once it has been released.
create or replace function public.ftt_report(formulation_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles := tracker_private.me(); f public.formulations;
begin
  select * into f from public.formulations where id = formulation_id;
  if f.id is null or (p.role <> 'lab' and f.status <> 'released') then
    perform tracker_private.fail('this report has not been released yet');
  end if;
  return jsonb_build_object(
    'formulation', tracker_private.formulation_json(p.role, f),
    'results', coalesce((select jsonb_agg(tracker_private.result_json(r)) from public.results r where r.formulation_id = f.id), '[]'));
end $$;

-- Everyone who can sign in (administrators only). Adding, changing and
-- removing accounts needs the secret key, so it happens in the
-- ftt-admin-users Edge Function.
create or replace function public.ftt_list_users() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles := tracker_private.me();
begin
  if not p.is_admin then perform tracker_private.fail('only an administrator can manage users'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'role', u.role, 'admin', u.is_admin, 'createdAt', u.created_at)
                                    order by u.role, u.name_key) from public.profiles u), '[]');
end $$;

-- Signs a person out of every browser after a new PIN (Edge Function only).
create or replace function public.ftt_end_sessions(user_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from auth.sessions s where s.user_id = ftt_end_sessions.user_id;
end $$;

-- ---------- who may call what ----------

revoke all on all functions in schema tracker_private from public, anon, authenticated;

revoke all on function public.ftt_session(), public.ftt_list(), public.ftt_submit(jsonb), public.ftt_withdraw(text),
  public.ftt_lab_action(text, text, jsonb), public.ftt_record_result(jsonb), public.ftt_delete_result(text),
  public.ftt_report(text), public.ftt_list_users(), public.ftt_end_sessions(uuid) from public, anon;

grant execute on function public.ftt_session(), public.ftt_list(), public.ftt_submit(jsonb), public.ftt_withdraw(text),
  public.ftt_lab_action(text, text, jsonb), public.ftt_record_result(jsonb), public.ftt_delete_result(text),
  public.ftt_report(text), public.ftt_list_users() to authenticated;

revoke execute on function public.ftt_end_sessions(uuid) from authenticated;
grant execute on function public.ftt_end_sessions(uuid) to service_role;
