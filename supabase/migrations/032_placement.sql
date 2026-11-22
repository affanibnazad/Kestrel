-- Kestrel Spam Guard, part C: inbox placement tests (plan Outreach Engine/11-kestrel-spam-guard-plan.md), like Smartlead
-- SmartDelivery and Instantly placement tests. The team connects 2–6 test inboxes it owns (Gmail, Outlook, Yahoo…; reading
-- only, by IMAP). A test sends one real email from each chosen email account to each test inbox, then reads where it landed
-- (Inbox, Promotions, Spam, or not arrived). An email account whose emails land in spam is paused by itself (can be turned off).
-- Optional weekly test with the last test's email. Also: the mail timer now also runs when a sending domain is due for its daily
-- blacklist check (031 only ran while campaigns were sending).
-- Run once, after 031: node scripts/run-sql.mjs supabase/migrations/032_placement.sql  (safe to run again; only adds)

-- ---------- test inboxes (seed list). Passwords in Vault, like email accounts; never readable from the App.
create table if not exists public.seed_inboxes (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  email      text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and email = lower(email) and length(email) <= 254),
  provider   text not null default 'other' check (provider in ('gmail', 'outlook', 'yahoo', 'icloud', 'zoho', 'other')),
  imap_host  text not null check (imap_host ~ '^[a-z0-9.-]+$' and length(imap_host) <= 200),
  imap_port  integer not null default 993 check (imap_port in (143, 993)),
  username   text not null check (length(username) between 1 and 254),
  secret_id  uuid not null,
  status     text not null default 'new' check (status in ('new', 'ok', 'error')),
  last_error text check (length(last_error) <= 500),
  tested_at  timestamptz,
  created_at timestamptz not null default now(),
  unique (team_id, email)
);
alter table public.seed_inboxes enable row level security;
revoke all on public.seed_inboxes from anon, authenticated;
grant select (id, team_id, email, provider, imap_host, imap_port, username, status, last_error, tested_at, created_at) on public.seed_inboxes to authenticated;
drop policy if exists "team reads seed inboxes" on public.seed_inboxes;
create policy "team reads seed inboxes" on public.seed_inboxes for select to authenticated using (public.is_member(team_id));

-- ---------- team settings: weekly test, auto-pause
create table if not exists public.placement_settings (
  team_id    uuid primary key references public.teams (id) on delete cascade,
  weekly     boolean not null default false,
  auto_pause boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.placement_settings enable row level security;
revoke all on public.placement_settings from anon, authenticated;
grant select on public.placement_settings to authenticated;
drop policy if exists "team reads placement settings" on public.placement_settings;
create policy "team reads placement settings" on public.placement_settings for select to authenticated using (public.is_member(team_id));

-- ---------- tests and their results (one row per email account × test inbox)
create table if not exists public.placement_tests (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  status      text not null default 'sending' check (status in ('sending', 'checking', 'done', 'cancelled')),
  scheduled   boolean not null default false,
  subject     text not null check (length(subject) between 1 and 300),
  body        text not null check (length(body) between 1 and 6000),
  finished_at timestamptz,
  total       integer not null default 0,
  inbox       integer not null default 0,
  promotions  integer not null default 0,
  spam        integer not null default 0,
  missing     integer not null default 0,
  paused      integer not null default 0
);
create index if not exists placement_tests_team on public.placement_tests (team_id, created_at desc);
alter table public.placement_tests enable row level security;
revoke all on public.placement_tests from anon, authenticated;
grant select on public.placement_tests to authenticated;
drop policy if exists "team reads placement tests" on public.placement_tests;
create policy "team reads placement tests" on public.placement_tests for select to authenticated using (public.is_member(team_id));

create table if not exists public.placement_results (
  id           uuid primary key default gen_random_uuid(),
  test_id      uuid not null references public.placement_tests (id) on delete cascade,
  team_id      uuid not null references public.teams (id) on delete cascade,
  mailbox_id   uuid references public.mailboxes (id) on delete set null,
  seed_id      uuid references public.seed_inboxes (id) on delete set null,
  from_email   text not null,
  seed_email   text not null,
  seed_provider text not null default 'other',
  token        text not null unique,          -- part of the email's Message-ID, so the test inbox can find it
  state        text not null default 'queued' check (state in ('queued', 'sent', 'inbox', 'promotions', 'spam', 'missing', 'failed')),
  folder       text check (length(folder) <= 200),
  detail       text check (length(detail) <= 300),
  sent_at      timestamptz,
  checked_at   timestamptz,
  locked_until timestamptz,
  unique (test_id, mailbox_id, seed_id)
);
create index if not exists placement_results_open on public.placement_results (state) where state in ('queued', 'sent');
alter table public.placement_results enable row level security;
revoke all on public.placement_results from anon, authenticated;
grant select (id, test_id, team_id, mailbox_id, seed_id, from_email, seed_email, seed_provider, state, folder, detail, sent_at, checked_at) on public.placement_results to authenticated;
drop policy if exists "team reads placement results" on public.placement_results;
create policy "team reads placement results" on public.placement_results for select to authenticated using (public.is_member(team_id));

-- ---------- test inboxes: add / change / remove (owners and managers), server login and test result
create or replace function public.save_seed_inbox(seed_id uuid, email text, provider text, imap_host text, imap_port integer, username text, password text) returns uuid
language plpgsql security definer set search_path = public, vault as $$
declare t uuid := public.my_team_id(true); pw text := coalesce(password, ''); e text := lower(trim(coalesce(email, ''))); old uuid; id_out uuid;
begin
  if t is null then raise exception 'Only the owner or a manager can change test inboxes'; end if;
  if exists (select 1 from mailboxes m where m.team_id = t and m.email = e) then raise exception 'Use an inbox you do not send campaigns from'; end if;
  if seed_id is null then
    if (select count(*) from seed_inboxes s where s.team_id = t) >= 6 then raise exception 'At most 6 test inboxes'; end if;
    if length(pw) < 4 or length(pw) > 400 then raise exception 'Add the inbox app password'; end if;
    insert into seed_inboxes (team_id, email, provider, imap_host, imap_port, username, secret_id)
    values (t, e, coalesce(nullif(provider, ''), 'other'), lower(trim(imap_host)), coalesce(imap_port, 993), coalesce(nullif(trim(username), ''), e),
      vault.create_secret(pw, 'kestrel:' || t || ':seed:' || gen_random_uuid(), 'Kestrel test inbox password'))
    returning id into id_out;
    return id_out;
  end if;
  update seed_inboxes s set email = e, provider = coalesce(nullif(save_seed_inbox.provider, ''), 'other'), imap_host = lower(trim(save_seed_inbox.imap_host)),
    imap_port = coalesce(save_seed_inbox.imap_port, 993), username = coalesce(nullif(trim(save_seed_inbox.username), ''), e), status = 'new', last_error = null
  where s.id = seed_id and s.team_id = t returning s.secret_id into old;
  if old is null then raise exception 'Test inbox not found'; end if;
  if length(pw) > 0 then
    if length(pw) > 400 then raise exception 'That password is too long'; end if;
    perform vault.update_secret(old, pw);
  end if;
  return seed_id;
end $$;

create or replace function public.remove_seed_inbox(seed_id uuid) returns void
language plpgsql security definer set search_path = public, vault as $$
declare t uuid := public.my_team_id(true); old uuid;
begin
  if t is null then raise exception 'Only the owner or a manager can change test inboxes'; end if;
  delete from seed_inboxes where id = seed_id and team_id = t returning secret_id into old;
  if old is not null then delete from vault.secrets where id = old; end if;
end $$;

create or replace function public.seed_login_for_server(seed_id uuid, server_secret text) returns json
language plpgsql security definer set search_path = public, vault as $$
declare t uuid := public.my_team_id(true); r seed_inboxes; pw text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  if t is null then raise exception 'Only the owner or a manager can test inboxes'; end if;
  select * into r from seed_inboxes where id = seed_id and team_id = t;
  if r.id is null then raise exception 'Test inbox not found'; end if;
  select decrypted_secret into pw from vault.decrypted_secrets where id = r.secret_id;
  return json_build_object('email', r.email, 'provider', r.provider, 'imap_host', r.imap_host, 'imap_port', r.imap_port, 'username', r.username, 'password', pw);
end $$;

create or replace function public.seed_tested(seed_id uuid, server_secret text, ok boolean, err text) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id(true);
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  update seed_inboxes set status = case when ok then 'ok' else 'error' end, last_error = left(nullif(err, ''), 500), tested_at = now()
  where id = seed_id and team_id = t;
end $$;

create or replace function public.set_placement_settings(weekly boolean, auto_pause boolean) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id(true);
begin
  if t is null then raise exception 'Only the owner or a manager can change placement settings'; end if;
  if coalesce(weekly, false) and not exists (select 1 from placement_tests p where p.team_id = t) then raise exception 'Run one test first: the weekly test repeats your last test'; end if;
  insert into placement_settings (team_id, weekly, auto_pause, updated_at) values (t, coalesce(weekly, false), coalesce(auto_pause, true), now())
  on conflict (team_id) do update set weekly = excluded.weekly, auto_pause = excluded.auto_pause, updated_at = now();
end $$;

-- ---------- creating a test (the App, or the weekly schedule). Internal: no grants.
create or replace function public.placement_create(team uuid, who uuid, box_ids uuid[], subj text, txt text, is_scheduled boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare test uuid; n integer;
begin
  -- An old test that never finished (for example the timer was off) is closed first.
  update placement_tests set status = 'done', finished_at = now() where team_id = team and status in ('sending', 'checking') and created_at < now() - interval '2 hours';
  if exists (select 1 from placement_tests where team_id = team and status in ('sending', 'checking')) then raise exception 'A placement test is already running'; end if;
  if (select count(*) from placement_tests where team_id = team and created_at > now() - interval '24 hours') >= 3 then raise exception 'At most 3 placement tests a day (each sends real emails from your accounts)'; end if;
  if not exists (select 1 from seed_inboxes where team_id = team and status = 'ok') then raise exception 'Add a test inbox and test its connection first'; end if;
  if length(trim(coalesce(subj, ''))) = 0 or length(trim(coalesce(txt, ''))) = 0 then raise exception 'Add the subject and the email'; end if;
  insert into placement_tests (team_id, created_by, subject, body, scheduled) values (team, who, left(trim(subj), 300), left(txt, 6000), coalesce(is_scheduled, false)) returning id into test;
  insert into placement_results (test_id, team_id, mailbox_id, seed_id, from_email, seed_email, seed_provider, token)
    select test, team, m.id, s.id, m.email, s.email, s.provider, replace(gen_random_uuid()::text, '-', '')
    from (select * from mailboxes where team_id = team and id = any(box_ids) and status = 'ok' limit 10) m
    cross join (select * from seed_inboxes where team_id = team and status = 'ok') s;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Choose at least one ready email account'; end if;
  update placement_tests set total = n where id = test;
  return test;
end $$;
revoke all on function public.placement_create(uuid, uuid, uuid[], text, text, boolean) from public, anon, authenticated;

create or replace function public.start_placement_test(box_ids uuid[], subject text, body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id(true);
begin
  if t is null then raise exception 'Only the owner or a manager can run placement tests'; end if;
  if not public.team_active(t) then raise exception 'Your plan is read-only. Choose a plan to send emails'; end if;
  if coalesce(array_length(box_ids, 1), 0) > 10 then raise exception 'At most 10 email accounts per test'; end if;
  return public.placement_create(t, auth.uid(), box_ids, subject, body, false);
end $$;

create or replace function public.cancel_placement_test(test_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id(true);
begin
  if t is null then raise exception 'Only the owner or a manager can stop placement tests'; end if;
  update placement_tests set status = 'cancelled', finished_at = now() where id = test_id and team_id = t and status in ('sending', 'checking');
  update placement_results set state = 'failed', detail = 'Stopped' where placement_results.test_id = cancel_placement_test.test_id and team_id = t and state = 'queued';
end $$;

-- ---------- finishing a test: counts, and the auto-pause rule. Internal: no grants.
-- Auto-pause: an email account is paused when at least 2 of its test emails, and at least half of those that arrived, landed in spam.
create or replace function public.placement_finish(test uuid) returns void
language plpgsql security definer set search_path = public as $$
declare tm uuid; auto boolean; n integer := 0;
begin
  select team_id into tm from placement_tests where id = test and status in ('sending', 'checking');
  if tm is null then return; end if;
  if exists (select 1 from placement_results where test_id = test and state in ('queued', 'sent')) then return; end if;
  select coalesce((select s.auto_pause from placement_settings s where s.team_id = tm), true) into auto;
  if auto then
    with bad as (
      select r.mailbox_id from placement_results r where r.test_id = test and r.mailbox_id is not null
      group by r.mailbox_id
      having count(*) filter (where r.state = 'spam') >= 2
         and count(*) filter (where r.state = 'spam') * 2 >= greatest(1, count(*) filter (where r.state in ('inbox', 'promotions', 'spam')))
    ), upd as (
      update mailboxes m set status = 'paused',
        last_error = 'Paused by Kestrel: a placement test found its emails in spam. Check Domain health, warm it longer, simplify the email, then test again and resume.'
      from bad where m.id = bad.mailbox_id and m.status = 'ok' returning m.id
    ), ev as (
      insert into mail_events (team_id, mailbox_id, kind, detail) select tm, upd.id, 'paused', 'Email account auto-paused (placement test: spam)' from upd returning 1
    ) select count(*) into n from ev;
  end if;
  update placement_tests p set status = 'done', finished_at = now(), paused = n,
    inbox = (select count(*) from placement_results where test_id = test and state = 'inbox'),
    promotions = (select count(*) from placement_results where test_id = test and state = 'promotions'),
    spam = (select count(*) from placement_results where test_id = test and state = 'spam'),
    missing = (select count(*) from placement_results where test_id = test and state in ('missing', 'failed'))
  where p.id = test;
end $$;
revoke all on function public.placement_finish(uuid) from public, anon, authenticated;

-- ---------- for the placement timer (server secret)
-- Weekly tests: repeat the team's last test with all its ready email accounts, 7 days after the last test.
create or replace function public.placement_schedule(server_secret text) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  -- A test still open after 2 hours is closed with what it found.
  update placement_results x set state = 'missing', detail = coalesce(x.detail, 'Not checked in time'), locked_until = null
  from placement_tests p where p.id = x.test_id and p.status in ('sending', 'checking') and p.created_at < now() - interval '2 hours' and x.state in ('queued', 'sent');
  update placement_tests set status = 'checking' where status = 'sending' and created_at < now() - interval '2 hours';
  perform public.placement_finish(p.id) from placement_tests p where p.status = 'checking' and p.created_at < now() - interval '2 hours';
  for r in
    select s.team_id, last.subject, last.body from placement_settings s
    cross join lateral (select p.subject, p.body, p.created_at from placement_tests p where p.team_id = s.team_id order by p.created_at desc limit 1) last
    where s.weekly and last.created_at < now() - interval '7 days' and public.team_active(s.team_id)
    limit 5
  loop
    begin
      perform public.placement_create(r.team_id, null, array(select id from mailboxes where team_id = r.team_id and status = 'ok' order by created_at limit 10), r.subject, r.body, true);
      n := n + 1;
    exception when others then null;  -- nothing ready (no test inbox, no ready account): try again later
    end;
  end loop;
  return n;
end $$;

-- Emails to send now, with the sending account's login. Claimed for 5 minutes so two timer calls never send the same one.
create or replace function public.placement_send_due(server_secret text, max_n integer) returns json
language plpgsql security definer set search_path = public, vault as $$
declare out json;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  -- An account that was paused or broke after the test started is skipped.
  update placement_results r set state = 'failed', detail = 'The email account is not ready'
  from placement_tests p where p.id = r.test_id and p.status = 'sending' and r.state = 'queued'
    and not exists (select 1 from mailboxes m where m.id = r.mailbox_id and m.status = 'ok');
  with picked as (
    select r.id from placement_results r join placement_tests p on p.id = r.test_id
    where p.status = 'sending' and r.state = 'queued' and (r.locked_until is null or r.locked_until < now())
    order by p.created_at, r.mailbox_id limit greatest(1, least(max_n, 20)) for update of r skip locked
  ), locked as (
    update placement_results r set locked_until = now() + interval '5 minutes' from picked where r.id = picked.id returning r.*
  )
  select coalesce(json_agg(json_build_object('id', l.id, 'token', l.token, 'to', l.seed_email, 'subject', p.subject, 'body', p.body,
    'box', json_build_object('email', m.email, 'from_name', m.from_name, 'smtp_host', m.smtp_host, 'smtp_port', m.smtp_port, 'username', m.username,
      'password', (select decrypted_secret from vault.decrypted_secrets where id = m.secret_id)))), '[]'::json) into out
  from locked l join placement_tests p on p.id = l.test_id join mailboxes m on m.id = l.mailbox_id;
  -- Tests whose emails are all handled move on to checking.
  update placement_tests p set status = 'checking' where p.status = 'sending'
    and not exists (select 1 from placement_results r where r.test_id = p.id and r.state = 'queued');
  -- A test where nothing could be sent finishes at once.
  perform public.placement_finish(p.id) from placement_tests p where p.status = 'checking'
    and not exists (select 1 from placement_results r where r.test_id = p.id and r.state in ('queued', 'sent'));
  return out;
end $$;

create or replace function public.placement_sent(server_secret text, result_id uuid, ok boolean, err text) returns void
language plpgsql security definer set search_path = public as $$
declare test uuid;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  update placement_results set state = case when ok then 'sent' else 'failed' end, sent_at = case when ok then now() end,
    detail = case when ok then null else left(nullif(err, ''), 300) end, locked_until = null
  where id = result_id and state = 'queued' returning test_id into test;
  if test is null then return; end if;
  update placement_tests p set status = 'checking' where p.id = test and p.status = 'sending'
    and not exists (select 1 from placement_results r where r.test_id = p.id and r.state = 'queued');
  perform public.placement_finish(test);
end $$;

-- Test inboxes to read now: each with the emails sent to it at least 90 seconds ago that were not found yet (checked every 2 minutes).
create or replace function public.placement_check_due(server_secret text, max_n integer) returns json
language plpgsql security definer set search_path = public, vault as $$
declare out json;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  with seeds as (
    select distinct r.seed_id from placement_results r
    where r.state = 'sent' and r.seed_id is not null and r.sent_at < now() - interval '90 seconds'
      and (r.checked_at is null or r.checked_at < now() - interval '2 minutes') and (r.locked_until is null or r.locked_until < now())
    limit greatest(1, least(max_n, 6))
  ), items as (
    update placement_results r set locked_until = now() + interval '3 minutes' from seeds
    where r.seed_id = seeds.seed_id and r.state = 'sent' and r.sent_at < now() - interval '90 seconds' returning r.*
  )
  select coalesce(json_agg(x), '[]'::json) into out from (
    select s.id, s.email, s.provider, s.imap_host, s.imap_port, s.username,
      (select decrypted_secret from vault.decrypted_secrets where id = s.secret_id) as password,
      json_agg(json_build_object('id', i.id, 'token', i.token, 'from', i.from_email, 'sent_at', i.sent_at)) as items
    from items i join seed_inboxes s on s.id = i.seed_id group by s.id) x;
  -- Emails sent to a test inbox that was removed cannot be checked.
  update placement_results set state = 'missing', detail = 'The test inbox was removed', checked_at = now() where state = 'sent' and seed_id is null;
  perform public.placement_finish(p.id) from placement_tests p where p.status = 'checking'
    and not exists (select 1 from placement_results r where r.test_id = p.id and r.state in ('queued', 'sent'));
  return out;
end $$;

-- What the timer found. state: inbox | promotions | spam | notfound | error. "notfound" after 20 minutes = did not arrive.
create or replace function public.placement_report(server_secret text, items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb; t uuid;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  for it in select * from jsonb_array_elements(coalesce(items, '[]'::jsonb)) limit 200 loop
    t := null;
    update placement_results r set checked_at = now(), locked_until = null,
      state = case when it ->> 'state' in ('inbox', 'promotions', 'spam') then it ->> 'state'
                   when r.sent_at < now() - interval '20 minutes' then 'missing' else r.state end,
      folder = left(nullif(it ->> 'folder', ''), 200),
      detail = case when it ->> 'state' = 'error' then left(nullif(it ->> 'detail', ''), 300)
                    when it ->> 'state' = 'notfound' and r.sent_at < now() - interval '20 minutes' then 'Not found in Inbox or Spam after 20 minutes' else r.detail end
    where r.id = (it ->> 'id')::uuid and r.state = 'sent' returning r.test_id into t;
    if t is not null then perform public.placement_finish(t); end if;
  end loop;
end $$;

revoke all on function public.save_seed_inbox(uuid, text, text, text, integer, text, text), public.remove_seed_inbox(uuid), public.seed_login_for_server(uuid, text),
  public.seed_tested(uuid, text, boolean, text), public.set_placement_settings(boolean, boolean), public.start_placement_test(uuid[], text, text),
  public.cancel_placement_test(uuid), public.placement_schedule(text), public.placement_send_due(text, integer), public.placement_sent(text, uuid, boolean, text),
  public.placement_check_due(text, integer), public.placement_report(text, jsonb) from public, anon;
grant execute on function public.save_seed_inbox(uuid, text, text, text, integer, text, text), public.remove_seed_inbox(uuid), public.seed_login_for_server(uuid, text),
  public.seed_tested(uuid, text, boolean, text), public.set_placement_settings(boolean, boolean), public.start_placement_test(uuid[], text, text),
  public.cancel_placement_test(uuid) to authenticated;
-- The timer's server call has no signed-in person: these check the server secret instead.
grant execute on function public.placement_schedule(text), public.placement_send_due(text, integer), public.placement_sent(text, uuid, boolean, text),
  public.placement_check_due(text, integer), public.placement_report(text, jsonb) to anon, authenticated;

-- ---------- timers
do $$ begin
  -- Placement: every minute while a test runs, or when a weekly test is due.
  if exists (select 1 from cron.job where jobname = 'kestrel-placement') then perform cron.unschedule('kestrel-placement'); end if;
  perform cron.schedule('kestrel-placement', '* * * * *', $job$
    select net.http_post(
      url := 'https://kestrelleads.com/api/mail/placement',
      headers := jsonb_build_object('content-type', 'application/json',
        'x-kestrel-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'kestrel:mail-server-secret' limit 1)),
      body := '{}'::jsonb, timeout_milliseconds := 55000)
    where exists (select 1 from public.placement_tests where status in ('sending', 'checking'))
       or exists (select 1 from public.placement_settings s where s.weekly
                  and not exists (select 1 from public.placement_tests p where p.team_id = s.team_id and p.created_at > now() - interval '7 days'));
  $job$);
  -- The mail timer (017) also runs when a sending domain is due for its daily blacklist check (031).
  if exists (select 1 from cron.job where jobname = 'kestrel-mail-tick') then perform cron.unschedule('kestrel-mail-tick'); end if;
  perform cron.schedule('kestrel-mail-tick', '* * * * *', $job$
    select net.http_post(
      url := 'https://kestrelleads.com/api/mail/tick',
      headers := jsonb_build_object('content-type', 'application/json',
        'x-kestrel-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'kestrel:mail-server-secret' limit 1)),
      body := '{}'::jsonb, timeout_milliseconds := 55000)
    where exists (select 1 from public.campaigns where status = 'running')
       or exists (select 1 from public.campaign_leads where first_sent_at > now() - interval '30 days')
       or exists (select 1 from public.mailboxes m where m.status in ('ok', 'paused')
                  and not exists (select 1 from public.domain_monitor dm where dm.team_id = m.team_id
                                  and dm.domain = lower(split_part(m.email, '@', 2)) and dm.checked_at > now() - interval '23 hours'));
  $job$);
end $$;

notify pgrst, 'reload schema';
