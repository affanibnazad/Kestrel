-- Kestrel Mail, phase 3: campaigns. Pick leads (with their written emails), a sequence and the team's mailboxes,
-- then Start. A timer in the database calls the App's server every minute; each call sends a few emails:
--   * at most each mailbox's daily limit in any 24 hours (default 25, follow-ups included), one email per mailbox
--     every 3 to 7 minutes, only inside the campaign's sending hours, weekends off when the sequence says so;
--   * follow-ups only to people who did not reply (the server checks the mailbox before each follow-up);
--   * never to anyone on Do-not-contact; one-click unsubscribe adds them to Do-not-contact at once;
--   * only while the team is active (trial, paid plan or access code).
-- The emails are the drafts already written for each lead (first email + follow-ups), frozen when the campaign starts.
-- Run once: node scripts/run-sql.mjs supabase/migrations/016_campaigns.sql  (safe to run again; only adds)

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ---------- campaigns
create table if not exists public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  name          text not null check (length(name) between 1 and 80),
  sequence_id   uuid references public.sequences (id) on delete set null,
  mailbox_ids   uuid[] not null default '{}',
  status        text not null default 'draft' check (status in ('draft', 'running', 'paused', 'stopped', 'done')),
  time_zone     text not null default 'Europe/London' check (length(time_zone) between 3 and 60),
  window_start  integer not null default 9 check (window_start between 0 and 23),
  window_end    integer not null default 17 check (window_end between 1 and 24),
  weekdays_only boolean not null default true,
  tested_at     timestamptz,
  started_at    timestamptz,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (window_end > window_start),
  unique (team_id, name)
);
alter table public.campaigns enable row level security;
revoke all on public.campaigns from anon, authenticated;
grant select on public.campaigns to authenticated;
grant insert (team_id, name, sequence_id, mailbox_ids, time_zone, window_start, window_end, weekdays_only) on public.campaigns to authenticated;
grant update (name, sequence_id, mailbox_ids, time_zone, window_start, window_end, weekdays_only) on public.campaigns to authenticated;
grant delete on public.campaigns to authenticated;
drop policy if exists "team reads campaigns" on public.campaigns;
create policy "team reads campaigns" on public.campaigns for select to authenticated using (public.is_member(team_id));
drop policy if exists "team adds campaigns" on public.campaigns;
create policy "team adds campaigns" on public.campaigns for insert to authenticated with check (public.can_edit(team_id));
-- Settings can change only before the start (draft) or while paused.
drop policy if exists "team changes campaigns" on public.campaigns;
create policy "team changes campaigns" on public.campaigns for update to authenticated
  using (public.can_edit(team_id) and status in ('draft', 'paused')) with check (public.can_edit(team_id));
drop policy if exists "team removes campaigns" on public.campaigns;
create policy "team removes campaigns" on public.campaigns for delete to authenticated using (public.can_edit(team_id) and status in ('draft', 'stopped', 'done'));

-- A campaign may only use its own team's sequence and mailboxes, and a real time zone.
create or replace function public.campaign_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sequence_id is not null and not exists (select 1 from sequences s where s.id = new.sequence_id and s.team_id = new.team_id) then
    raise exception 'That sequence belongs to another team';
  end if;
  if exists (select 1 from unnest(new.mailbox_ids) b where not exists (select 1 from mailboxes m where m.id = b and m.team_id = new.team_id)) then
    raise exception 'That mailbox belongs to another team';
  end if;
  if not exists (select 1 from pg_timezone_names where name = new.time_zone) then raise exception 'Unknown time zone'; end if;
  -- A test is only valid for the mailboxes and sequence it was sent with.
  if tg_op = 'UPDATE' and (new.mailbox_ids is distinct from old.mailbox_ids or new.sequence_id is distinct from old.sequence_id) then new.tested_at := null; end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.campaign_check() from public, anon, authenticated;
drop trigger if exists campaigns_check on public.campaigns;
create trigger campaigns_check before insert or update on public.campaigns for each row execute function public.campaign_check();

-- ---------- one row per lead in a campaign: its frozen emails, which step is next, and when
create table if not exists public.campaign_leads (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns (id) on delete cascade,
  team_id       uuid not null references public.teams (id) on delete cascade,
  lead_id       uuid references public.leads (id) on delete set null,
  mailbox_id    uuid references public.mailboxes (id) on delete set null,
  to_email      text not null,
  lead_name     text,
  steps         jsonb not null,               -- [{day, subject, body}] frozen at start
  next_step     integer not null default 0,
  next_at       timestamptz,
  status        text not null default 'active' check (status in ('active', 'done', 'replied', 'unsubscribed', 'blocked', 'failed', 'stopped')),
  thread_id     text,                         -- Message-ID of the first email, for follow-ups in the same thread
  first_sent_at timestamptz,
  attempts      integer not null default 0,
  locked_until  timestamptz,
  unsub_token   text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  last_error    text check (length(last_error) <= 500),
  unique (campaign_id, lead_id)
);
create index if not exists campaign_leads_due on public.campaign_leads (status, next_at);
create index if not exists campaign_leads_campaign on public.campaign_leads (campaign_id, status);
alter table public.campaign_leads enable row level security;
revoke all on public.campaign_leads from anon, authenticated;
grant select (id, campaign_id, team_id, lead_id, mailbox_id, to_email, lead_name, steps, next_step, next_at, status, first_sent_at, attempts, last_error)
  on public.campaign_leads to authenticated;
drop policy if exists "team reads campaign leads" on public.campaign_leads;
create policy "team reads campaign leads" on public.campaign_leads for select to authenticated using (public.is_member(team_id));

-- ---------- what happened (sent, failed, replied, unsubscribed, skipped)
create table if not exists public.mail_events (
  id            bigint generated always as identity primary key,
  team_id       uuid not null references public.teams (id) on delete cascade,
  campaign_id   uuid references public.campaigns (id) on delete cascade,
  campaign_lead_id uuid references public.campaign_leads (id) on delete cascade,
  mailbox_id    uuid references public.mailboxes (id) on delete set null,
  step          integer,
  kind          text not null check (kind in ('sent', 'failed', 'replied', 'unsubscribed', 'blocked', 'test')),
  detail        text check (length(detail) <= 500),
  message_id    text,
  at            timestamptz not null default now()
);
create index if not exists mail_events_box_time on public.mail_events (mailbox_id, kind, at);
create index if not exists mail_events_campaign on public.mail_events (campaign_id, at desc);
alter table public.mail_events enable row level security;
revoke all on public.mail_events from anon, authenticated;
grant select on public.mail_events to authenticated;
drop policy if exists "team reads mail events" on public.mail_events;
create policy "team reads mail events" on public.mail_events for select to authenticated using (public.is_member(team_id));

-- When each mailbox may send next (a random 3–7 minute gap between emails).
alter table public.mailboxes add column if not exists next_send_at timestamptz;

-- ---------- Do-not-contact check for one email (the email itself, its domain or a parent domain)
create or replace function public.dnc_blocks_email(t uuid, email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from do_not_contact d where d.team_id = t and (d.entry = lower(email)
    or lower(split_part(email, '@', 2)) = d.entry or lower(split_part(email, '@', 2)) like '%.' || d.entry));
$$;
revoke all on function public.dnc_blocks_email(uuid, text) from public, anon, authenticated;

-- ---------- the App: start, pause, stop, test recorded
-- Start: freezes each chosen lead's written emails into the campaign. Skips leads with no email, no draft,
-- on Do-not-contact, or already in another running campaign. Needs: sequence, at least one working mailbox, a test sent.
create or replace function public.start_campaign(campaign uuid, lead_ids uuid[]) returns json
language plpgsql security definer set search_path = public as $$
declare c campaigns; boxes uuid[]; added integer := 0; skipped integer := 0; n integer;
begin
  select * into c from campaigns where id = campaign;
  if c.id is null or not public.can_edit(c.team_id) then raise exception 'Campaign not found'; end if;
  -- Sending uses the team's mailboxes, so only the people who manage them (owner or manager) may start.
  if public.my_team_id(true) is distinct from c.team_id then raise exception 'Only the owner or a manager can start a campaign'; end if;
  if c.status <> 'draft' then raise exception 'This campaign has already started (use Resume)'; end if;
  if c.tested_at is null then raise exception 'Send a test to yourself first'; end if;
  -- Only mailboxes whose sending (SMTP) and reply-reading (IMAP) tests passed: follow-ups need the reply check.
  select array_agg(m.id order by m.created_at) into boxes from mailboxes m where m.id = any (c.mailbox_ids) and m.team_id = c.team_id and m.status = 'ok' and m.imap_ok is true;
  if boxes is null then raise exception 'Choose at least one mailbox whose sending and reading tests both passed'; end if;
  n := array_length(boxes, 1);
  if coalesce(array_length(lead_ids, 1), 0) > 5000 then raise exception 'At most 5,000 leads in one campaign'; end if;

  with picked as (
    select l.id, l.name, lower(trim(l.email)) as email,
      coalesce(case when jsonb_typeof(l.data #> '{outreach,steps}') = 'array' and jsonb_array_length(l.data #> '{outreach,steps}') > 0 then l.data #> '{outreach,steps}' end,
        case when length(coalesce(l.data #>> '{outreach,body}', '')) > 0
          then jsonb_build_array(jsonb_build_object('day', 0, 'subject', coalesce(l.data #>> '{outreach,subject}', ''), 'body', l.data #>> '{outreach,body}')) end) as steps
    from leads l where l.id = any (lead_ids) and l.team_id = c.team_id
  ), ok as (
    select p.*, row_number() over (order by p.id) as rn from picked p
    where p.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and p.steps is not null and public.sequence_steps_ok(p.steps)
      and not public.dnc_blocks_email(c.team_id, p.email)
      and not exists (select 1 from campaign_leads x join campaigns y on y.id = x.campaign_id
                      where x.to_email = p.email and x.team_id = c.team_id and x.status = 'active' and y.status in ('running', 'paused') and y.id <> c.id)
  ), ins as (
    insert into campaign_leads (campaign_id, team_id, lead_id, mailbox_id, to_email, lead_name, steps, next_at)
    select c.id, c.team_id, ok.id, boxes[1 + ((ok.rn - 1) % n)], ok.email, ok.name, ok.steps, now() from ok
    on conflict (campaign_id, lead_id) do nothing
    returning 1
  ) select count(*) into added from ins;
  skipped := coalesce(array_length(lead_ids, 1), 0) - added;
  update campaigns set status = 'running', started_at = coalesce(started_at, now()) where id = c.id;
  return json_build_object('added', added, 'skipped', skipped);
end $$;

create or replace function public.pause_campaign(campaign uuid, paused boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c campaigns;
begin
  select * into c from campaigns where id = campaign;
  if c.id is null or not public.can_block(c.team_id) then raise exception 'Campaign not found'; end if;
  if paused and c.status = 'running' then update campaigns set status = 'paused' where id = c.id;
  elsif not paused and c.status = 'paused' then
    if not public.can_edit(c.team_id) then raise exception 'Your team needs an active plan to send'; end if;
    if public.my_team_id(true) is distinct from c.team_id then raise exception 'Only the owner or a manager can resume sending'; end if;
    update campaigns set status = 'running' where id = c.id;
  end if;
end $$;

-- Stop for good: nothing more is sent. (Pausing is always allowed, even after the trial.)
create or replace function public.stop_campaign(campaign uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c campaigns;
begin
  select * into c from campaigns where id = campaign;
  if c.id is null or not public.can_block(c.team_id) then raise exception 'Campaign not found'; end if;
  update campaigns set status = 'stopped' where id = c.id and status in ('draft', 'running', 'paused');
  update campaign_leads set status = 'stopped', next_at = null where campaign_id = c.id and status = 'active';
end $$;

-- The App's server records that a test was sent to the signed-in person (needs the server secret).
create or replace function public.campaign_tested(campaign uuid, server_secret text) returns void
language plpgsql security definer set search_path = public as $$
declare c campaigns;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into c from campaigns where id = campaign;
  if c.id is null or not public.can_edit(c.team_id) or public.my_team_id(true) is distinct from c.team_id then raise exception 'Campaign not found'; end if;
  update campaigns set tested_at = now() where id = c.id;
  insert into mail_events (team_id, campaign_id, kind, detail) values (c.team_id, c.id, 'test', 'Test sent to ' || coalesce((select email from auth.users where id = auth.uid()), 'you'));
end $$;

-- ---------- the timer's server call: due emails (claimed so no other call sends them), with the mailbox login
create or replace function public.mail_due(server_secret text, max_n integer) returns json
language plpgsql security definer set search_path = public, vault as $$
declare out jsonb := '[]'::jsonb; b record; l record; pw text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  for b in
    select m.* from mailboxes m
    where m.status = 'ok' and coalesce(m.next_send_at, '-infinity') <= now()
      and public.team_active(m.team_id)
      and (select count(*) from mail_events e where e.mailbox_id = m.id and e.kind = 'sent' and e.at > now() - interval '24 hours') < m.daily_limit
    order by coalesce(m.next_send_at, '-infinity')
    for update skip locked
  loop
    exit when jsonb_array_length(out) >= greatest(1, least(max_n, 20));
    select cl.*, c.time_zone into l from campaign_leads cl join campaigns c on c.id = cl.campaign_id
    where cl.mailbox_id = b.id and cl.status = 'active' and cl.next_at <= now() and coalesce(cl.locked_until, '-infinity') < now()
      and c.status = 'running'
      and extract(hour from now() at time zone c.time_zone) >= c.window_start and extract(hour from now() at time zone c.time_zone) < c.window_end
      and (not c.weekdays_only or extract(isodow from now() at time zone c.time_zone) < 6)
    order by cl.next_step desc, cl.next_at
    limit 1 for update of cl skip locked;
    continue when l.id is null;
    -- Do-not-contact may have changed since the start.
    if public.dnc_blocks_email(l.team_id, l.to_email) then
      update campaign_leads set status = 'blocked', next_at = null where id = l.id;
      insert into mail_events (team_id, campaign_id, campaign_lead_id, mailbox_id, step, kind, detail) values (l.team_id, l.campaign_id, l.id, b.id, l.next_step, 'blocked', 'On Do-not-contact');
      continue;
    end if;
    -- Claimed for 6 hours: if the server sent but could not report back, the email is not sent again soon.
    update campaign_leads set locked_until = now() + interval '6 hours' where id = l.id;
    update mailboxes set next_send_at = now() + interval '3 minutes' where id = b.id;
    select decrypted_secret into pw from vault.decrypted_secrets where id = b.secret_id;
    out := out || jsonb_build_array(jsonb_build_object(
      'id', l.id, 'step', l.next_step, 'steps_total', jsonb_array_length(l.steps), 'to', l.to_email,
      'subject', l.steps -> l.next_step ->> 'subject', 'body', l.steps -> l.next_step ->> 'body',
      'thread_id', l.thread_id, 'first_sent_at', l.first_sent_at, 'unsub_token', l.unsub_token,
      'box', jsonb_build_object('id', b.id, 'email', b.email, 'from_name', b.from_name, 'smtp_host', b.smtp_host, 'smtp_port', b.smtp_port,
        'imap_host', b.imap_host, 'imap_port', b.imap_port, 'username', b.username, 'password', pw)));
  end loop;
  return out;
end $$;

-- The server reports what happened to one claimed email.
--   sent: schedule the next step (its day minus this step's day), or done.  replied: stop.  failed: try again in 30 minutes,
--   3 tries at most.  box_error: the mailbox refused to sign in, so it is marked as an error and not used until tested again.
create or replace function public.mail_result(server_secret text, cl_id uuid, kind text, message_id text, err text, box_error boolean) returns void
language plpgsql security definer set search_path = public as $$
declare l campaign_leads; gap integer;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into l from campaign_leads where id = cl_id for update;
  if l.id is null then return; end if;
  if kind = 'sent' then
    -- Steps were checked at the start (sequence_steps_ok): whole days, increasing.
    gap := coalesce(floor((l.steps -> (l.next_step + 1) ->> 'day')::numeric)::integer - floor((l.steps -> l.next_step ->> 'day')::numeric)::integer, 0);
    update campaign_leads set
      thread_id = coalesce(thread_id, left(message_id, 300)), first_sent_at = coalesce(first_sent_at, now()),
      next_step = next_step + 1, attempts = 0, locked_until = null, last_error = null,
      next_at = case when next_step + 1 < jsonb_array_length(steps) then now() + make_interval(days => greatest(gap, 1)) end,
      status = case when next_step + 1 < jsonb_array_length(steps) then 'active' else 'done' end
    where id = l.id;
    update mailboxes set next_send_at = now() + make_interval(secs => 180 + floor(random() * 240)::integer) where id = l.mailbox_id;
    insert into mail_events (team_id, campaign_id, campaign_lead_id, mailbox_id, step, kind, message_id) values (l.team_id, l.campaign_id, l.id, l.mailbox_id, l.next_step, 'sent', left(message_id, 300));
  elsif kind = 'replied' then
    update campaign_leads set status = 'replied', next_at = null, locked_until = null where id = l.id;
    insert into mail_events (team_id, campaign_id, campaign_lead_id, mailbox_id, step, kind) values (l.team_id, l.campaign_id, l.id, l.mailbox_id, l.next_step, 'replied');
  else
    update campaign_leads set attempts = attempts + 1, locked_until = null, last_error = left(err, 500),
      status = case when attempts + 1 >= 3 then 'failed' else status end,
      next_at = case when attempts + 1 >= 3 then null else now() + interval '30 minutes' end
    where id = l.id;
    if box_error then update mailboxes set status = 'error', last_error = left(err, 500) where id = l.mailbox_id; end if;
    insert into mail_events (team_id, campaign_id, campaign_lead_id, mailbox_id, step, kind, detail) values (l.team_id, l.campaign_id, l.id, l.mailbox_id, l.next_step, 'failed', left(err, 500));
  end if;
  -- A campaign with nothing left to send is done.
  update campaigns c set status = 'done' where c.id = l.campaign_id and c.status = 'running'
    and not exists (select 1 from campaign_leads x where x.campaign_id = c.id and x.status = 'active');
end $$;

-- ---------- one-click unsubscribe (from the link in the email header): stop and add to Do-not-contact
create or replace function public.mail_unsubscribe(token text) returns boolean
language plpgsql security definer set search_path = public as $$
declare l campaign_leads;
begin
  select * into l from campaign_leads where unsub_token = token;
  if l.id is null or length(coalesce(token, '')) < 20 then return false; end if;
  update campaign_leads set status = 'unsubscribed', next_at = null where campaign_id in (select id from campaigns where team_id = l.team_id) and to_email = l.to_email and status = 'active';
  insert into do_not_contact (team_id, entry, reason) values (l.team_id, l.to_email, 'Unsubscribed from a Kestrel email') on conflict do nothing;
  insert into mail_events (team_id, campaign_id, campaign_lead_id, mailbox_id, step, kind) values (l.team_id, l.campaign_id, l.id, l.mailbox_id, l.next_step, 'unsubscribed');
  return true;
end $$;

revoke all on function public.start_campaign(uuid, uuid[]), public.pause_campaign(uuid, boolean), public.stop_campaign(uuid), public.campaign_tested(uuid, text),
  public.mail_due(text, integer), public.mail_result(text, uuid, text, text, text, boolean), public.mail_unsubscribe(text) from public, anon, authenticated;
grant execute on function public.start_campaign(uuid, uuid[]), public.pause_campaign(uuid, boolean), public.stop_campaign(uuid), public.campaign_tested(uuid, text) to authenticated;
-- The timer's server call has no signed-in person: these check the server secret instead.
grant execute on function public.mail_due(text, integer), public.mail_result(text, uuid, text, text, text, boolean) to anon, authenticated;
grant execute on function public.mail_unsubscribe(text) to anon, authenticated;

-- ---------- the timer: every minute, ask the App's server to send what is due (it does nothing when no campaign runs)
do $$ begin
  if exists (select 1 from cron.job where jobname = 'kestrel-mail-tick') then perform cron.unschedule('kestrel-mail-tick'); end if;
  perform cron.schedule('kestrel-mail-tick', '* * * * *', $job$
    select net.http_post(
      url := 'https://kestrelleads.com/api/mail/tick',
      headers := jsonb_build_object('content-type', 'application/json',
        'x-kestrel-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'kestrel:mail-server-secret' limit 1)),
      body := '{}'::jsonb, timeout_milliseconds := 55000)
    where exists (select 1 from public.campaigns where status = 'running');
  $job$);
end $$;

notify pgrst, 'reload schema';
