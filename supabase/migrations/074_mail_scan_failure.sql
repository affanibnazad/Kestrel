-- 074_mail_scan_failure.sql
-- Separate inbox reading issues from mailbox sending status.
-- Reading failures increment scan_failures and set scan_error without touching status.
-- Successful scans reset scan_failures = 0 and scan_error = null.

alter table public.mailboxes add column if not exists scan_failures integer not null default 0;
alter table public.mailboxes add column if not exists scan_error text;

create or replace function public.mail_scan_failure(server_secret text, box_id uuid, err text) returns json
language plpgsql security definer set search_path = public as $$
declare m mailboxes;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into m from mailboxes where id = box_id;
  if m.id is null then return json_build_object('ok', false, 'error', 'not found'); end if;

  update mailboxes
  set scan_failures = coalesce(scan_failures, 0) + 1,
      scan_error = left('Can''t read inbox (' || coalesce(nullif(err, ''), 'timeout') || ')', 500)
  where id = box_id;

  return json_build_object('ok', true, 'scan_failures', coalesce(m.scan_failures, 0) + 1);
end $$;

revoke all on function public.mail_scan_failure(text, uuid, text) from public, anon, authenticated;
grant execute on function public.mail_scan_failure(text, uuid, text) to anon, authenticated;

-- On successful scan, reset scan_failures = 0 and scan_error = null
create or replace function public.mail_inbox_report(server_secret text, box_id uuid, validity text, last_uid bigint, items jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare m mailboxes; it jsonb; who text; k text; l campaign_leads; n_reply integer := 0; n_remove integer := 0; n_bounce integer := 0; n_auto integer := 0;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into m from mailboxes where id = box_id;
  if m.id is null then return json_build_object('ok', false); end if;

  update mailboxes set
    scan_uid = greatest(coalesce(case when scan_validity = validity then scan_uid end, 0), coalesce(last_uid, 0)),
    scan_validity = left(validity, 40),
    scanned_at = now(),
    scan_failures = 0,
    scan_error = null
  where id = m.id;

  for it in select value from jsonb_array_elements(case when jsonb_typeof(items) = 'array' then items else '[]'::jsonb end) limit 200 loop
    k := it ->> 'kind';
    continue when k not in ('reply', 'remove', 'bounce', 'auto');
    who := lower(trim(case when k = 'bounce' then it ->> 'bounced_to' else it ->> 'from' end));
    continue when who is null or who !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
    select cl.* into l from campaign_leads cl where cl.team_id = m.team_id and cl.mailbox_id = m.id and cl.to_email = who and cl.first_sent_at is not null
      order by cl.first_sent_at desc limit 1;
    continue when l.id is null;
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
      if k = 'remove' then n_remove := n_remove + 1; else n_bounce := n_bounce + 1; end if;
      update campaign_leads set status = case when k = 'remove' then 'unsubscribed' else 'bounced' end, next_at = null
        where team_id = m.team_id and to_email = who and status = 'active';
      insert into do_not_contact (team_id, entry, reason)
        values (m.team_id, who, case when k = 'remove' then 'Asked to be removed (reply)' else 'Email bounced (address not found)' end) on conflict do nothing;
    end if;
  end loop;

  return json_build_object('ok', true, 'replied', n_reply, 'removed', n_remove, 'bounced', n_bounce, 'auto', n_auto);
end $$;

revoke all on function public.mail_inbox_report(text, uuid, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.mail_inbox_report(text, uuid, text, bigint, jsonb) to anon, authenticated;
