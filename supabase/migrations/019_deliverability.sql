-- Kestrel Mail Pro, M1: deliverability foundation (plan 09-kestrel-mail-pro-plan.md).
--   * Warmup status per mailbox: campaigns send only from mailboxes warmed for 14+ days (your warmup service),
--     unless you choose "Send anyway". Mailboxes connected before this change keep sending (marked "Send anyway").
--   * Ramp-up: a new mailbox starts at 5 emails a day and adds 2 a day up to its daily limit.
--   * Auto-pause: a mailbox pauses itself above 3% bounces (last 7 days, 30+ sent); a campaign pauses above 5% (20+ sent).
--   * Verification before the first email (Hunter, the team's key, optional per campaign): invalid addresses are skipped.
-- Run once, after 018: node scripts/run-sql.mjs supabase/migrations/019_deliverability.sql  (safe to run again; only adds)

alter table public.mailboxes add column if not exists warmup_started_at date;
alter table public.mailboxes add column if not exists warmup_override boolean not null default false;
alter table public.mailboxes add column if not exists ramp_up boolean not null default true;
grant select (warmup_started_at, warmup_override, ramp_up, next_send_at) on public.mailboxes to authenticated;
-- Mailboxes connected before M1 keep working as they did.
do $$ begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.mailboxes'::regclass and attname = 'm1_seen') then
    update public.mailboxes set warmup_override = true, ramp_up = false;
    alter table public.mailboxes add column m1_seen boolean not null default true;
  end if;
end $$;

alter table public.campaigns add column if not exists verify_emails boolean not null default false;
alter table public.campaigns add column if not exists paused_reason text check (length(paused_reason) <= 300);
grant insert (verify_emails) on public.campaigns to authenticated;
grant update (verify_emails) on public.campaigns to authenticated;

alter table public.campaign_leads drop constraint if exists campaign_leads_status_check;
alter table public.campaign_leads add constraint campaign_leads_status_check
  check (status in ('active', 'done', 'replied', 'unsubscribed', 'blocked', 'failed', 'stopped', 'bounced', 'invalid'));
alter table public.mail_events drop constraint if exists mail_events_kind_check;
alter table public.mail_events add constraint mail_events_kind_check
  check (kind in ('sent', 'failed', 'replied', 'unsubscribed', 'blocked', 'test', 'bounced', 'auto', 'opened', 'invalid', 'paused'));

-- Is this mailbox warm enough to send campaigns?
create or replace function public.mailbox_warm(m mailboxes) returns boolean
language sql stable set search_path = public as $$
  select m.warmup_override or (m.warmup_started_at is not null and m.warmup_started_at <= current_date - 14);
$$;
-- Today's limit with ramp-up: 5 on the first sending day, +2 each day after, never above the mailbox's own limit.
create or replace function public.mailbox_limit_today(m mailboxes) returns integer
language sql stable security definer set search_path = public as $$
  select case when not m.ramp_up then m.daily_limit else least(m.daily_limit, 5 + 2 * coalesce(
    (select (current_date - min(e.at)::date) from mail_events e where e.mailbox_id = m.id and e.kind = 'sent'), 0)) end;
$$;
revoke all on function public.mailbox_warm(mailboxes), public.mailbox_limit_today(mailboxes) from public, anon, authenticated;

-- Owners and managers set warmup and ramp-up.
create or replace function public.set_mailbox_warmup(box_id uuid, started date, override boolean, ramp boolean) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id(true);
begin
  if t is null then raise exception 'Only the owner or a manager can change mailboxes'; end if;
  if started is not null and (started > current_date or started < current_date - 3650) then raise exception 'Choose a real start date'; end if;
  update mailboxes set warmup_started_at = started, warmup_override = coalesce(override, false), ramp_up = coalesce(ramp, true) where id = box_id and team_id = t;
  if not found then raise exception 'Mailbox not found'; end if;
end $$;

-- What each mailbox may send today (for the App).
create or replace function public.mailbox_today() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', m.id, 'warm', public.mailbox_warm(m), 'limit_today', public.mailbox_limit_today(m),
    'sent_24h', (select count(*) from mail_events e where e.mailbox_id = m.id and e.kind = 'sent' and e.at > now() - interval '24 hours'),
    'bounce_rate_7d', (select round(100.0 * count(*) filter (where e.kind = 'bounced') / greatest(count(*) filter (where e.kind = 'sent'), 1), 1)
       from mail_events e where e.mailbox_id = m.id and e.at > now() - interval '7 days'))), '[]'::json)
  from mailboxes m where m.team_id = public.my_team_id(false);
$$;

-- Auto-pause on bounces (called after each send result and each bounce).
create or replace function public.mail_health(box uuid, campaign uuid) returns void
language plpgsql security definer set search_path = public as $$
declare sent integer; bounced integer;
begin
  select count(*) filter (where kind = 'sent'), count(*) filter (where kind in ('bounced', 'invalid')) into sent, bounced
    from mail_events where mailbox_id = box and at > now() - interval '7 days';
  if sent >= 30 and bounced * 100.0 / sent > 3 then
    update mailboxes set status = 'paused', last_error = left(format('Paused by Kestrel: %s%% of emails bounced in 7 days (limit 3%%). Clean the list, then resume.', round(bounced * 100.0 / sent, 1)), 500)
      where id = box and status = 'ok';
    if found then insert into mail_events (team_id, mailbox_id, kind, detail) select team_id, id, 'paused', 'Mailbox auto-paused (bounces)' from mailboxes where id = box; end if;
  end if;
  if campaign is not null then
    select count(*) filter (where kind = 'sent'), count(*) filter (where kind in ('bounced', 'invalid')) into sent, bounced from mail_events where campaign_id = campaign;
    if sent >= 20 and bounced * 100.0 / sent > 5 then
      update campaigns set status = 'paused', paused_reason = format('Paused by Kestrel: %s%% bounced (limit 5%%). Check the list, then resume.', round(bounced * 100.0 / sent, 1))
        where id = campaign and status = 'running';
      if found then insert into mail_events (team_id, campaign_id, kind, detail) select team_id, id, 'paused', 'Campaign auto-paused (bounces)' from campaigns where id = campaign; end if;
    end if;
  end if;
end $$;
revoke all on function public.mail_health(uuid, uuid) from public, anon, authenticated;

-- Resuming clears the auto-pause note.
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
    update campaigns set status = 'running', paused_reason = null where id = c.id;
  end if;
end $$;

-- ---------- sending with the new gates
create or replace function public.mail_due(server_secret text, max_n integer) returns json
language plpgsql security definer set search_path = public, vault as $$
declare out jsonb := '[]'::jsonb; b record; l record; pw text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  for b in
    select m.* from mailboxes m
    where m.status = 'ok' and coalesce(m.next_send_at, '-infinity') <= now()
      and public.team_active(m.team_id)
      and public.mailbox_warm(m)
      and (select count(*) from mail_events e where e.mailbox_id = m.id and e.kind = 'sent' and e.at > now() - interval '24 hours') < public.mailbox_limit_today(m)
    order by coalesce(m.next_send_at, '-infinity')
    for update skip locked
  loop
    exit when jsonb_array_length(out) >= greatest(1, least(max_n, 20));
    select cl.*, c.time_zone, c.track_opens, c.verify_emails, t.tracking_domain, t.tracking_ok into l
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
      -- Verify the address before the first email (Hunter, the team's key), when the campaign asks for it.
      'verify_key', case when l.verify_emails and l.next_step = 0 then (select s.decrypted_secret from team_keys k join vault.decrypted_secrets s on s.id = k.secret_id
        where k.team_id = l.team_id and k.service = 'hunter') end,
      'box', jsonb_build_object('id', b.id, 'email', b.email, 'from_name', b.from_name, 'smtp_host', b.smtp_host, 'smtp_port', b.smtp_port,
        'imap_host', b.imap_host, 'imap_port', b.imap_port, 'username', b.username, 'password', pw)));
  end loop;
  return out;
end $$;

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
  elsif kind = 'invalid' then
    -- The address failed verification: never sent, never tried again, kept on Do-not-contact.
    update campaign_leads set status = 'invalid', next_at = null, locked_until = null, last_error = left(err, 500) where id = l.id;
    insert into do_not_contact (team_id, entry, reason) values (l.team_id, l.to_email, 'Email failed verification') on conflict do nothing;
    insert into mail_events (team_id, campaign_id, campaign_lead_id, mailbox_id, step, kind, detail) values (l.team_id, l.campaign_id, l.id, l.mailbox_id, l.next_step, 'invalid', left(err, 500));
  else
    update campaign_leads set attempts = attempts + 1, locked_until = null, last_error = left(err, 500),
      status = case when attempts + 1 >= 3 then 'failed' else status end,
      next_at = case when attempts + 1 >= 3 then null else now() + interval '30 minutes' end
    where id = l.id;
    if box_error then update mailboxes set status = 'error', last_error = left(err, 500) where id = l.mailbox_id; end if;
    insert into mail_events (team_id, campaign_id, campaign_lead_id, mailbox_id, step, kind, detail) values (l.team_id, l.campaign_id, l.id, l.mailbox_id, l.next_step, 'failed', left(err, 500));
  end if;
  perform public.mail_health(l.mailbox_id, l.campaign_id);
  -- A campaign with nothing left to send is done.
  update campaigns c set status = 'done' where c.id = l.campaign_id and c.status = 'running'
    and not exists (select 1 from campaign_leads x where x.campaign_id = c.id and x.status = 'active');
end $$;

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
    if k = 'bounce' then perform public.mail_health(m.id, l.campaign_id); end if;
    update campaigns c set status = 'done' where c.id = l.campaign_id and c.status = 'running'
      and not exists (select 1 from campaign_leads x where x.campaign_id = c.id and x.status = 'active');
  end loop;
  return json_build_object('ok', true, 'replies', n_reply, 'removed', n_remove, 'bounced', n_bounce, 'auto', n_auto);
end $$;

revoke all on function public.set_mailbox_warmup(uuid, date, boolean, boolean), public.mailbox_today(), public.mail_due(text, integer),
  public.mail_result(text, uuid, text, text, text, boolean), public.mail_inbox_report(text, uuid, text, bigint, jsonb), public.pause_campaign(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_mailbox_warmup(uuid, date, boolean, boolean), public.mailbox_today(), public.pause_campaign(uuid, boolean) to authenticated;
grant execute on function public.mail_due(text, integer), public.mail_result(text, uuid, text, text, text, boolean), public.mail_inbox_report(text, uuid, text, bigint, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
