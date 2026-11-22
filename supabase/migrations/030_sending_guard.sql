-- Kestrel Spam Guard, part D: extra sending guard (plan Outreach Engine/11-kestrel-spam-guard-plan.md).
--   * A campaign pauses itself when unsubscribes pass 5% of the people it contacted (after 20+ contacted).
--   * An email account pauses itself when unsubscribes pass 5% of its emails in 7 days (after 40+ sent), or when 2
--     replies in 7 days call its emails spam or say they reported it (spam complaints hurt the whole domain).
--   * At most 2 first emails a day to the same company domain across the team (gmail.com and other free mail excluded),
--     so one company never gets a burst from several of your inboxes.
-- Runs on its own: triggers on new unsubscribes and replies, and a check inside mail_due. Resuming works as before.
-- Run once, after 029: node scripts/run-sql.mjs supabase/migrations/030_sending_guard.sql  (safe to run again; only adds)

-- Free mail providers: their domains are shared by millions of people, so the company-domain cap does not apply.
create or replace function public.is_free_mail(d text) returns boolean
language sql immutable set search_path = public as $$
  select lower(coalesce(d, '')) ~ '^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|yandex|zoho|hey|fastmail|tutanota|qq|163|126|rediffmail|web|t-online|orange|free|libero|seznam|wp|o2)\.([a-z]{2,3})(\.[a-z]{2})?$';
$$;

-- First emails sent to one domain by this team in the last 24 hours.
create or replace function public.domain_firsts_today(team uuid, d text) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from mail_events e join campaign_leads x on x.id = e.campaign_lead_id
  where e.team_id = team and e.kind = 'sent' and e.step = 0 and e.at > now() - interval '24 hours'
    and lower(split_part(x.to_email, '@', 2)) = lower(d);
$$;
create index if not exists mail_events_team_sent on public.mail_events (team_id, at) where kind = 'sent';

-- Words in a reply that mean "this is spam" (a complaint, not just "no thanks").
create or replace function public.is_spam_complaint(t text) returns boolean
language sql immutable set search_path = public as $$
  select regexp_replace(coalesce(t, ''), '(not|isn.?t|is not|no|wasn.?t) (a )?spam', ' ', 'gi') ~* '(\mspam\M|spamming|reported (you|this|it)|report(ing)? (you|this) (as|for)|marked (as|this as) spam|abuse|stop harass|harassment)';
$$;

-- The guard itself: checks one mailbox and one campaign and pauses them when a limit is passed.
create or replace function public.mail_guard(box uuid, campaign uuid) returns void
language plpgsql security definer set search_path = public as $$
declare sent integer; firsts integer; unsubs integer; complaints integer;
begin
  if box is not null then
    select count(*) filter (where kind = 'sent'), count(*) filter (where kind = 'unsubscribed') into sent, unsubs
      from mail_events where mailbox_id = box and at > now() - interval '7 days';
    select count(*) into complaints from mail_replies r
      where r.mailbox_id = box and r.received_at > now() - interval '7 days' and r.kind in ('reply', 'remove') and public.is_spam_complaint(concat_ws(' ', r.subject, r.snippet));
    if complaints >= 2 then
      update mailboxes set status = 'paused', last_error = left(format('Paused by Kestrel: %s replies in 7 days called your emails spam. Read them in the Unibox, fix the emails and the list, then resume.', complaints), 500)
        where id = box and status = 'ok';
      if found then insert into mail_events (team_id, mailbox_id, kind, detail) select team_id, id, 'paused', 'Email account auto-paused (spam complaints)' from mailboxes where id = box; end if;
    elsif sent >= 40 and unsubs * 100.0 / sent > 5 then
      update mailboxes set status = 'paused', last_error = left(format('Paused by Kestrel: %s%% of emails in 7 days led to an unsubscribe (limit 5%%). Check who you email and what you say, then resume.', round(unsubs * 100.0 / sent, 1)), 500)
        where id = box and status = 'ok';
      if found then insert into mail_events (team_id, mailbox_id, kind, detail) select team_id, id, 'paused', 'Email account auto-paused (unsubscribes)' from mailboxes where id = box; end if;
    end if;
  end if;
  if campaign is not null then
    select count(*) filter (where kind = 'sent' and step = 0), count(*) filter (where kind = 'unsubscribed') into firsts, unsubs
      from mail_events where campaign_id = campaign;
    if firsts >= 20 and unsubs * 100.0 / firsts > 5 then
      update campaigns set status = 'paused', paused_reason = format('Paused by Kestrel: %s%% of the people contacted unsubscribed (limit 5%%). Check the leads and the emails, then resume.', round(unsubs * 100.0 / firsts, 1))
        where id = campaign and status = 'running';
      if found then insert into mail_events (team_id, campaign_id, kind, detail) select team_id, id, 'paused', 'Campaign auto-paused (unsubscribes)' from campaigns where id = campaign; end if;
    end if;
  end if;
end $$;
revoke all on function public.mail_guard(uuid, uuid), public.domain_firsts_today(uuid, text) from public, anon, authenticated;

-- Run the guard on every new unsubscribe and every new reply.
create or replace function public.mail_guard_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'unsubscribed' then perform public.mail_guard(new.mailbox_id, new.campaign_id); end if;
  return null;
end $$;
drop trigger if exists mail_guard_on_event on public.mail_events;
create trigger mail_guard_on_event after insert on public.mail_events for each row execute function public.mail_guard_event();

create or replace function public.mail_guard_reply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('reply', 'remove') then perform public.mail_guard(new.mailbox_id, new.campaign_id); end if;
  return null;
end $$;
drop trigger if exists mail_guard_on_reply on public.mail_replies;
create trigger mail_guard_on_reply after insert on public.mail_replies for each row execute function public.mail_guard_reply();
revoke all on function public.mail_guard_event(), public.mail_guard_reply() from public, anon, authenticated;

-- ---------- sending (same as 026) plus the company-domain cap
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
      -- M2: the lead's own time zone when the campaign asks for it (and Kestrel could tell it), else the campaign's.
      and extract(hour from now() at time zone coalesce(case when c.lead_time_zone then cl.time_zone end, c.time_zone)) >= c.window_start
      and extract(hour from now() at time zone coalesce(case when c.lead_time_zone then cl.time_zone end, c.time_zone)) < c.window_end
      and (not c.weekdays_only or extract(isodow from now() at time zone coalesce(case when c.lead_time_zone then cl.time_zone end, c.time_zone)) < 6)
      -- Spam Guard D (030): at most 2 first emails a day to one company domain, across the team (free mail domains excluded).
      and (cl.next_step > 0 or public.is_free_mail(split_part(cl.to_email, '@', 2)) or public.domain_firsts_today(cl.team_id, split_part(cl.to_email, '@', 2)) < 2)
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

revoke all on function public.mail_due(text, integer) from public, anon, authenticated;
grant execute on function public.mail_due(text, integer) to anon, authenticated;  -- checked by the server secret (as in 016/019/026)

notify pgrst, 'reload schema';
