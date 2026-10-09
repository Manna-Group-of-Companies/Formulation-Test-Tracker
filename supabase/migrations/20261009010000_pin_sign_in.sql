-- Sign-in with a 4-digit PIN: counting wrong PINs.
--
-- A short PIN can be guessed, so sign-in goes through the ftt-sign-in Edge
-- Function, which asks these functions first and reports each wrong PIN:
--   - the same name from the same address: 5 wrong PINs, then 5 minutes' wait
--   - the same name from anywhere: 20 wrong PINs within an hour, then 30 minutes' wait
-- (The function also turns the PIN into the account's password with a
-- server-side secret, so guessing straight at Supabase Auth gets nowhere.)
--
-- Only the Edge Function (secret key) can call these. Safe to run more than once.

create table if not exists public.ftt_sign_in_attempts (
  key text primary key,           -- '<name key>' or '<address>|<name key>'
  failures integer not null default 0,
  first_failed_at timestamptz,    -- start of the current counting window
  locked_until timestamptz
);
alter table public.ftt_sign_in_attempts enable row level security;
revoke all on public.ftt_sign_in_attempts from anon, authenticated;

-- Minutes this name (from this address) must still wait; 0 to go ahead.
create or replace function public.ftt_sign_in_wait(name_key text, address text) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(ceil(extract(epoch from max(a.locked_until) - now()) / 60)::int, 0)
  from public.ftt_sign_in_attempts a
  where a.key in (ftt_sign_in_wait.address || '|' || ftt_sign_in_wait.name_key, ftt_sign_in_wait.name_key)
    and a.locked_until > now()
$$;

create or replace function public.ftt_sign_in_failed(name_key text, address text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  rule record;
begin
  for rule in select * from (values
      (ftt_sign_in_failed.address || '|' || ftt_sign_in_failed.name_key, 5, interval '5 minutes', interval '5 minutes'),
      (ftt_sign_in_failed.name_key, 20, interval '1 hour', interval '30 minutes')
    ) as r(k, lim, win, lock_for)
  loop
    insert into public.ftt_sign_in_attempts as a (key, failures, first_failed_at)
    values (rule.k, 1, now())
    on conflict (key) do update set
      failures = case when a.first_failed_at is null or a.first_failed_at < now() - rule.win then 1 else a.failures + 1 end,
      first_failed_at = case when a.first_failed_at is null or a.first_failed_at < now() - rule.win then now() else a.first_failed_at end;
    update public.ftt_sign_in_attempts a
      set locked_until = now() + rule.lock_for, failures = 0, first_failed_at = null
      where a.key = rule.k and a.failures >= rule.lim;
  end loop;
end $$;

-- A correct PIN clears the count for this name.
create or replace function public.ftt_sign_in_ok(name_key text, address text) returns void
language sql volatile security definer set search_path = '' as $$
  delete from public.ftt_sign_in_attempts a
  where a.key in (ftt_sign_in_ok.address || '|' || ftt_sign_in_ok.name_key, ftt_sign_in_ok.name_key)
$$;

revoke all on function public.ftt_sign_in_wait(text, text), public.ftt_sign_in_failed(text, text),
  public.ftt_sign_in_ok(text, text) from public, anon, authenticated;
grant execute on function public.ftt_sign_in_wait(text, text), public.ftt_sign_in_failed(text, text),
  public.ftt_sign_in_ok(text, text) to service_role;
