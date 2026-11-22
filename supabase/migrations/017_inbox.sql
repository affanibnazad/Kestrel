-- Kestrel Mail, phase 4 (exact data only): the App reads each campaign mailbox (IMAP) every few minutes and finds
--   * replies from campaign leads: shown in the App (Mail → Campaigns → Replies), the lead stops getting follow-ups;
--   * "remove me" / unsubscribe replies: stop at once and add to Do-not-contact;
--   * bounces (address does not exist): stop and add to Do-not-contact;
--   * out-of-office answers: shown, but they do not stop the follow-ups.
-- No tracking pixels or tracked links: emails stay plain text (best for inbox placement). Opens/clicks = phase 4b later.
-- Run once: node scripts/run-sql.mjs supabase/migrations/017_inbox.sql  (safe to run again; only adds)

-- New statuses and event kinds: bounced, auto (out of office).
alter table public.campaign_leads drop constraint if exists campaign_leads_status_check;
alter table public.campaign_leads add constraint campaign_leads_status_check
  check (status in ('active', 'done', 'replied', 'unsubscribed', 'blocked', 'failed', 'stopped', 'bounced'));
alter table public.mail_events drop constraint if exists mail_events_kind_check;
alter table public.mail_events add constraint mail_events_kind_check
  check (kind in ('sent', 'failed', 'replied', 'unsubscribed', 'blocked', 'test', 'bounced', 'auto'));

-- Where each mailbox's reading got to (IMAP UIDs are only valid with the same UIDVALIDITY).
alter table public.mailboxes add column if not exists scan_uid bigint;
alter table public.mailboxes add column if not exists scan_validity text;
alter table public.mailboxes add column if not exists scanned_at timestamptz;

-- ---------- what came back
create table if not exists public.mail_replies (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  mailbox_id    uuid references public.mailboxes (id) on delete set null,
  campaign_id   uuid references public.campaigns (id) on delete set null,
  campaign_lead_id uuid references public.campaign_leads (id) on delete set null,
  kind          text not null check (kind in ('reply', 'remove', 'bounce', 'auto')),
  from_email    text not null check (length(from_email) <= 254),
  lead_email    text check (length(lead_email) <= 254),
  subject       text check (length(subject) <= 300),
  snippet       text check (length(snippet) <= 1000),
  message_uid   bigint,
  received_at   timestamptz,
  handled       boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (mailbox_id, message_uid)
);
create index if not exists mail_replies_team_time on public.mail_replies (team_id, received_at desc);
alter table public.mail_replies enable row level security;
revoke all on public.mail_replies from anon, authenticated;
grant select on public.mail_replies to authenticated;
grant update (handled) on public.mail_replies to authenticated;
drop policy if exists "team reads replies" on public.mail_replies;
create policy "team reads replies" on public.mail_replies for select to authenticated using (public.is_member(team_id));
drop policy if exists "team marks replies" on public.mail_replies;
create policy "team marks replies" on public.mail_replies for update to authenticated using (public.can_block(team_id)) with check (public.can_block(team_id));

-- ---------- the timer: which mailboxes to read now (with their login). A mailbox is read every 10 minutes while
-- it has campaign emails sent in the last 30 days. Needs the server secret.
create or replace function public.mail_scan_due(server_secret text, max_n integer) returns json
language plpgsql security definer set search_path = public, vault as $$
declare out jsonb := '[]'::jsonb; b record; pw text; since timestamptz;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  for b in
    select m.* from mailboxes m
    where m.imap_host is not null and m.status in ('ok', 'paused')
      and coalesce(m.scanned_at, '-infinity') < now() - interval '10 minutes'
      and exists (select 1 from campaign_leads cl where cl.mailbox_id = m.id and cl.first_sent_at > now() - interval '30 days')
    order by coalesce(m.scanned_at, '-infinity')
    limit greatest(1, least(max_n, 5))
    for update skip locked
  loop
    select min(cl.first_sent_at) into since from campaign_leads cl where cl.mailbox_id = b.id and cl.first_sent_at > now() - interval '30 days';
    update mailboxes set scanned_at = now() where id = b.id;   -- claimed: the next call skips it for 10 minutes
    select decrypted_secret into pw from vault.decrypted_secrets where id = b.secret_id;
    out := out || jsonb_build_array(jsonb_build_object('id', b.id, 'email', b.email, 'imap_host', b.imap_host, 'imap_port', b.imap_port,
      'username', b.username, 'password', pw, 'scan_uid', b.scan_uid, 'scan_validity', b.scan_validity, 'since', since));
  end loop;
  return out;
end $$;

-- The server reports what it found in one mailbox: [{uid, from, subject, snippet, date, kind, bounced_to, refs}]
-- kind: reply | remove | bounce | auto. Only messages from (or bouncing for) this team's campaign leads are kept.
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

    insert into mail_replies (team_id, mailbox_id, campaign_id, campaign_lead_id, kind, from_email, lead_email, subject, snippet, message_uid, received_at)
    values (m.team_id, m.id, l.campaign_id, l.id, k, left(lower(coalesce(it ->> 'from', who)), 254), who, left(it ->> 'subject', 300), left(it ->> 'snippet', 1000),
      nullif(it ->> 'uid', '')::bigint, coalesce((it ->> 'date')::timestamptz, now()))
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

-- The Daily Tracker from the class: per day, first emails, follow-ups, replies, bounces, unsubscribes (team only).
create or replace function public.mail_daily(days integer) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(r order by r.day desc), '[]'::json) from (
    select to_char(date_trunc('day', e.at), 'YYYY-MM-DD') as day,
      count(*) filter (where e.kind = 'sent' and e.step = 0) as first_sent,
      count(*) filter (where e.kind = 'sent' and e.step > 0) as follow_ups,
      count(*) filter (where e.kind = 'replied') as replies,
      count(*) filter (where e.kind = 'bounced') as bounces,
      count(*) filter (where e.kind = 'unsubscribed') as unsubscribes,
      count(*) filter (where e.kind = 'auto') as auto_replies
    from mail_events e
    where e.team_id = public.my_team_id(false) and e.at > now() - make_interval(days => greatest(1, least(days, 90)))
    group by 1) r;
$$;

revoke all on function public.mail_scan_due(text, integer), public.mail_inbox_report(text, uuid, text, bigint, jsonb), public.mail_daily(integer) from public, anon, authenticated;
grant execute on function public.mail_scan_due(text, integer), public.mail_inbox_report(text, uuid, text, bigint, jsonb) to anon, authenticated;  -- checked by the server secret
grant execute on function public.mail_daily(integer) to authenticated;

-- The timer also runs while there is something to read: campaign emails sent in the last 30 days.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'kestrel-mail-tick') then perform cron.unschedule('kestrel-mail-tick'); end if;
  perform cron.schedule('kestrel-mail-tick', '* * * * *', $job$
    select net.http_post(
      url := 'https://kestrelleads.com/api/mail/tick',
      headers := jsonb_build_object('content-type', 'application/json',
        'x-kestrel-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'kestrel:mail-server-secret' limit 1)),
      body := '{}'::jsonb, timeout_milliseconds := 55000)
    where exists (select 1 from public.campaigns where status = 'running')
       or exists (select 1 from public.campaign_leads where first_sent_at > now() - interval '30 days');
  $job$);
end $$;

notify pgrst, 'reload schema';
