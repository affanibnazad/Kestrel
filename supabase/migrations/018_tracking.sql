-- Kestrel Mail, phase 4b: faster replies, open tracking (estimates) with the team's own tracking domain, lead timeline.
--   * Mailboxes are read for replies every minute (was every 10 minutes).
--   * Open tracking (optional per campaign): a tiny image in an HTML copy of the email, loaded from the team's own
--     tracking domain (for example track.yourdomain.com, a DNS CNAME to Vercel). Never a shared domain. Counts are estimates:
--     Gmail loads the image once and keeps it; Apple Mail loads every image by itself. The App says so.
--   * The lead timeline in the App reads campaign_leads, mail_events and mail_replies (already readable by the team).
-- Run once: node scripts/run-sql.mjs supabase/migrations/018_tracking.sql  (safe to run again; only adds)

-- ---------- read mailboxes every minute
create or replace function public.mail_scan_due(server_secret text, max_n integer) returns json
language plpgsql security definer set search_path = public, vault as $$
declare out jsonb := '[]'::jsonb; b record; pw text; since timestamptz;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  for b in
    select m.* from mailboxes m
    where m.imap_host is not null and m.status in ('ok', 'paused')
      and coalesce(m.scanned_at, '-infinity') < now() - interval '50 seconds'
      and exists (select 1 from campaign_leads cl where cl.mailbox_id = m.id and cl.first_sent_at > now() - interval '30 days')
    order by coalesce(m.scanned_at, '-infinity')
    limit greatest(1, least(max_n, 8))
    for update skip locked
  loop
    select min(cl.first_sent_at) into since from campaign_leads cl where cl.mailbox_id = b.id and cl.first_sent_at > now() - interval '30 days';
    update mailboxes set scanned_at = now() where id = b.id;
    select decrypted_secret into pw from vault.decrypted_secrets where id = b.secret_id;
    out := out || jsonb_build_array(jsonb_build_object('id', b.id, 'email', b.email, 'imap_host', b.imap_host, 'imap_port', b.imap_port,
      'username', b.username, 'password', pw, 'scan_uid', b.scan_uid, 'scan_validity', b.scan_validity, 'since', since));
  end loop;
  return out;
end $$;

-- ---------- open tracking
alter table public.campaigns add column if not exists track_opens boolean not null default false;
grant insert (track_opens) on public.campaigns to authenticated;
grant update (track_opens) on public.campaigns to authenticated;
alter table public.campaign_leads add column if not exists open_token text;
update public.campaign_leads set open_token = encode(extensions.gen_random_bytes(18), 'hex') where open_token is null;
alter table public.campaign_leads alter column open_token set default encode(extensions.gen_random_bytes(18), 'hex');
create unique index if not exists campaign_leads_open_token on public.campaign_leads (open_token);

alter table public.mail_events drop constraint if exists mail_events_kind_check;
alter table public.mail_events add constraint mail_events_kind_check
  check (kind in ('sent', 'failed', 'replied', 'unsubscribed', 'blocked', 'test', 'bounced', 'auto', 'opened'));

-- The team's own tracking domain (one per team), and whether its DNS was checked.
alter table public.teams add column if not exists tracking_domain text check (tracking_domain is null or (tracking_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' and length(tracking_domain) <= 200));
alter table public.teams add column if not exists tracking_ok boolean not null default false;
alter table public.teams add column if not exists tracking_checked_at timestamptz;
create unique index if not exists teams_tracking_domain on public.teams (tracking_domain) where tracking_domain is not null;

create or replace function public.my_tracking() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('domain', t.tracking_domain, 'ok', t.tracking_ok, 'checked_at', t.tracking_checked_at)
  from teams t where t.id = public.my_team_id(false);
$$;

-- Owners and managers set the domain (it must be checked again after every change).
create or replace function public.set_tracking_domain(domain text) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id(true); d text := nullif(lower(trim(coalesce(domain, ''))), '');
begin
  if t is null then raise exception 'Only the owner or a manager can change the tracking domain'; end if;
  if d is not null and d in ('kestrelleads.com', 'www.kestrelleads.com') then raise exception 'Use a domain of your own'; end if;
  update teams set tracking_domain = d, tracking_ok = false, tracking_checked_at = null where id = t;
exception when unique_violation then raise exception 'That tracking domain is already used by another team';
end $$;

-- The App's server reports the DNS check (needs the server secret; only for the caller's own team).
create or replace function public.tracking_checked(server_secret text, ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id(true);
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  if t is null then raise exception 'Only the owner or a manager can check the tracking domain'; end if;
  update teams set tracking_ok = ok, tracking_checked_at = now() where id = t;
end $$;

-- The tracking image was loaded: one "opened" event (at most 50 per email step; repeats within 10 seconds ignored).
create or replace function public.mail_open(token text, step integer, host text, agent text) returns void
language plpgsql security definer set search_path = public as $$
declare l campaign_leads; t teams;
begin
  select * into l from campaign_leads where open_token = token;
  if l.id is null or step is null or step < 0 or step >= jsonb_array_length(l.steps) then return; end if;
  -- Only through the team's own checked tracking domain.
  select * into t from teams where id = l.team_id;
  if not t.tracking_ok or t.tracking_domain is distinct from lower(host) then return; end if;
  if (select count(*) from mail_events e where e.campaign_lead_id = l.id and e.kind = 'opened' and e.step = mail_open.step) >= 50 then return; end if;
  if exists (select 1 from mail_events e where e.campaign_lead_id = l.id and e.kind = 'opened' and e.step = mail_open.step and e.at > now() - interval '10 seconds') then return; end if;
  insert into mail_events (team_id, campaign_id, campaign_lead_id, mailbox_id, step, kind, detail)
  values (l.team_id, l.campaign_id, l.id, l.mailbox_id, mail_open.step, 'opened', left(coalesce(agent, ''), 120));
end $$;

-- ---------- sending: the due email now also says whether to add the tracking image
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
    select cl.*, c.time_zone, c.track_opens, t.tracking_domain, t.tracking_ok into l
    from campaign_leads cl join campaigns c on c.id = cl.campaign_id join teams t on t.id = cl.team_id
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
      -- Open tracking only with the team's own checked tracking domain (never a shared one).
      'track', case when l.track_opens and l.tracking_ok and l.tracking_domain is not null
        then jsonb_build_object('domain', l.tracking_domain, 'token', l.open_token) end,
      'box', jsonb_build_object('id', b.id, 'email', b.email, 'from_name', b.from_name, 'smtp_host', b.smtp_host, 'smtp_port', b.smtp_port,
        'imap_host', b.imap_host, 'imap_port', b.imap_port, 'username', b.username, 'password', pw)));
  end loop;
  return out;
end $$;

-- The Daily tracker also counts opens (estimates).
create or replace function public.mail_daily(days integer) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(r order by r.day desc), '[]'::json) from (
    select to_char(date_trunc('day', e.at), 'YYYY-MM-DD') as day,
      count(*) filter (where e.kind = 'sent' and e.step = 0) as first_sent,
      count(*) filter (where e.kind = 'sent' and e.step > 0) as follow_ups,
      count(*) filter (where e.kind = 'replied') as replies,
      count(*) filter (where e.kind = 'bounced') as bounces,
      count(*) filter (where e.kind = 'unsubscribed') as unsubscribes,
      count(*) filter (where e.kind = 'auto') as auto_replies,
      count(distinct e.campaign_lead_id) filter (where e.kind = 'opened') as opened
    from mail_events e
    where e.team_id = public.my_team_id(false) and e.at > now() - make_interval(days => greatest(1, least(days, 90)))
    group by 1) r;
$$;

-- ---------- fixes and the Inbox
-- Start refuses a campaign with no leads to send to; campaigns already running with no leads are closed.
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
  -- Nothing to send: do not start (a running campaign with no leads would wait forever).
  if added = 0 and not exists (select 1 from campaign_leads x where x.campaign_id = c.id) then
    raise exception 'No leads could be added: each needs an email and a written email, must not be on Do-not-contact and not already in another running campaign';
  end if;
  update campaigns set status = 'running', started_at = coalesce(started_at, now()) where id = c.id;
  return json_build_object('added', added, 'skipped', skipped);
end $$;
update public.campaigns c set status = 'done' where c.status = 'running' and not exists (select 1 from public.campaign_leads x where x.campaign_id = c.id);

-- The whole reply (for the Inbox) and its Message-ID (so an answer from Kestrel stays in the same thread).
alter table public.mail_replies add column if not exists body text check (length(body) <= 20000);
alter table public.mail_replies add column if not exists message_id text check (length(message_id) <= 300);
create or replace function public.mail_inbox_report(server_secret text, box_id uuid, validity text, last_uid bigint, items jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare m mailboxes; it jsonb; who text; k text; l campaign_leads; n_reply integer := 0; n_remove integer := 0; n_bounce integer := 0; n_auto integer := 0;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into m from mailboxes where id = box_id;
  if m.id is null then return json_build_object('ok', false); end if;
  update mailboxes set scan_uid = greatest(coalesce(case when scan_validity = validity then scan_uid end, 0), coalesce(last_uid, 0)),
    scan_validity = left(validity, 40), scanned_at = now() where id = m.id;

  for it in select value from jsonb_array_elements(case when jsonb_typeof(items) = 'array' then items else '[]'::jsonb end) limit 200 loop
    k := it ->> 'kind';
    continue when k not in ('reply', 'remove', 'bounce', 'auto');
    who := lower(trim(case when k = 'bounce' then it ->> 'bounced_to' else it ->> 'from' end));
    continue when who is null or who !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
    -- The newest campaign row for this person sent from this mailbox.
    select cl.* into l from campaign_leads cl where cl.team_id = m.team_id and cl.mailbox_id = m.id and cl.to_email = who and cl.first_sent_at is not null
      order by cl.first_sent_at desc limit 1;
    continue when l.id is null;
    -- A bounce counts only if it quotes the Message-ID of an email this mailbox really sent to that person
    -- (anyone could send a fake "undelivered" email naming a lead).
    continue when k = 'bounce' and not exists (
      select 1 from mail_events e where e.campaign_lead_id = l.id and e.kind = 'sent' and e.message_id is not null
        and e.message_id in (select jsonb_array_elements_text(case when jsonb_typeof(it -> 'refs') = 'array' then it -> 'refs' else '[]'::jsonb end)));

    insert into mail_replies (team_id, mailbox_id, campaign_id, campaign_lead_id, kind, from_email, lead_email, subject, snippet, body, message_id, message_uid, received_at)
    values (m.team_id, m.id, l.campaign_id, l.id, k, left(lower(coalesce(it ->> 'from', who)), 254), who, left(it ->> 'subject', 300), left(it ->> 'snippet', 1000),
      left(it ->> 'body', 20000), left(it ->> 'message_id', 300), nullif(it ->> 'uid', '')::bigint, coalesce((it ->> 'date')::timestamptz, now()))
    on conflict (mailbox_id, message_uid) do nothing;
    continue when not found;

    if k = 'auto' then
      n_auto := n_auto + 1;
      insert into mail_events (team_id, campaign_id, campaign_lead_id, mailbox_id, step, kind) values (m.team_id, l.campaign_id, l.id, m.id, l.next_step, 'auto');
    elsif k = 'reply' then
      n_reply := n_reply + 1;
      update campaign_leads set status = 'replied', next_at = null where id = l.id and status = 'active';
      insert into mail_events (team_id, campaign_id, campaign_lead_id, mailbox_id, step, kind) values (m.team_id, l.campaign_id, l.id, m.id, l.next_step, 'replied');
    else
      -- remove me / bounce: stop every campaign to this address and never contact it again.
      if k = 'remove' then n_remove := n_remove + 1; else n_bounce := n_bounce + 1; end if;
      update campaign_leads set status = case when k = 'remove' then 'unsubscribed' else 'bounced' end, next_at = null
        where team_id = m.team_id and to_email = who and status = 'active';
      insert into do_not_contact (team_id, entry, reason)
        values (m.team_id, who, case when k = 'remove' then 'Asked to be removed (reply)' else 'Email bounced (address not found)' end) on conflict do nothing;
      insert into mail_events (team_id, campaign_id, campaign_lead_id, mailbox_id, step, kind)
        values (m.team_id, l.campaign_id, l.id, m.id, l.next_step, case when k = 'remove' then 'unsubscribed' else 'bounced' end);
    end if;
    update campaigns c set status = 'done' where c.id = l.campaign_id and c.status = 'running'
      and not exists (select 1 from campaign_leads x where x.campaign_id = c.id and x.status = 'active');
  end loop;
  return json_build_object('ok', true, 'replies', n_reply, 'removed', n_remove, 'bounced', n_bounce, 'auto', n_auto);
end $$;

-- Before an answer is sent from the Inbox: the same gates as campaign sending (server secret, owner/manager of the team,
-- team active, mailbox ready and under its daily limit, the person not on Do-not-contact, a real reply). Returns the address.
create or replace function public.mail_answer_check(server_secret text, reply_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare r mail_replies; m mailboxes; who text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into r from mail_replies where id = reply_id;
  if r.id is null or public.my_team_id(true) is distinct from r.team_id then raise exception 'Reply not found'; end if;
  if r.kind <> 'reply' then raise exception 'This message is not a reply you can answer'; end if;
  if not public.team_active(r.team_id) then raise exception 'Your team needs an active plan to send'; end if;
  select * into m from mailboxes where id = r.mailbox_id;
  if m.id is null or m.status <> 'ok' then raise exception 'The mailbox is not ready (test it in Mailboxes)'; end if;
  if (select count(*) from mail_events e where e.mailbox_id = m.id and e.kind = 'sent' and e.at > now() - interval '24 hours') >= m.daily_limit then
    raise exception 'This mailbox reached its daily limit. Try again later'; end if;
  who := lower(coalesce(r.lead_email, r.from_email));
  if public.dnc_blocks_email(r.team_id, who) then raise exception 'This address is on Do-not-contact'; end if;
  if (select count(*) from mail_events e where e.campaign_lead_id = r.campaign_lead_id and e.kind = 'sent' and e.step is null and e.at > now() - interval '1 minute') > 0 then
    raise exception 'An answer was just sent. Wait a minute before sending another'; end if;
  return who;
end $$;

-- An answer written in Kestrel's Inbox and sent through the mailbox: recorded (counts toward the mailbox's daily limit)
-- and the reply is marked as answered. The App's server calls this after sending (server secret + an editor of the team).
create or replace function public.mail_answered(server_secret text, reply_id uuid, message_id text, body text) returns void
language plpgsql security definer set search_path = public as $$
declare r mail_replies;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into r from mail_replies where id = reply_id;
  if r.id is null or public.my_team_id(true) is distinct from r.team_id then raise exception 'Reply not found'; end if;
  insert into mail_events (team_id, campaign_id, campaign_lead_id, mailbox_id, step, kind, detail, message_id)
  values (r.team_id, r.campaign_id, r.campaign_lead_id, r.mailbox_id, null, 'sent', left('Answer: ' || coalesce(body, ''), 500), left(message_id, 300));
  update mail_replies set handled = true where id = r.id;
end $$;

revoke all on function public.my_tracking(), public.set_tracking_domain(text), public.tracking_checked(text, boolean), public.mail_open(text, integer, text, text),
  public.mail_scan_due(text, integer), public.mail_due(text, integer), public.mail_daily(integer),
  public.start_campaign(uuid, uuid[]), public.mail_inbox_report(text, uuid, text, bigint, jsonb), public.mail_answered(text, uuid, text, text),
  public.mail_answer_check(text, uuid) from public, anon, authenticated;
grant execute on function public.my_tracking(), public.set_tracking_domain(text), public.tracking_checked(text, boolean), public.mail_daily(integer),
  public.start_campaign(uuid, uuid[]), public.mail_answered(text, uuid, text, text), public.mail_answer_check(text, uuid) to authenticated;
grant execute on function public.mail_open(text, integer, text, text), public.mail_scan_due(text, integer), public.mail_due(text, integer),
  public.mail_inbox_report(text, uuid, text, bigint, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
