-- 055: send an answer later (Affan, 18 Nov 2026: the Replies answer box's clock only snoozed). Safe to run twice.
-- An owner or manager writes an answer to a reply and picks a time (1 minute to 30 days ahead). The mail timer
-- (/api/mail/tick, every minute) sends it then, through the same mailbox and email thread, after checking every gate
-- again at that moment: the person who scheduled it is still the team's owner or manager, the plan is active, the
-- mailbox is ready and under its daily limit, and nobody on Do-not-contact (lead, Cc, Bcc) is emailed. A failed gate
-- marks the answer failed with the reason; it is never sent blind. Attachments travel inside the row (3 MB in all,
-- checked by the App) and are cleared once the answer is sent, failed or cancelled.

create table if not exists public.scheduled_answers (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams (id) on delete cascade,
  reply_id     uuid not null references public.mail_replies (id) on delete cascade,
  created_by   uuid not null references auth.users (id) on delete cascade,
  send_at      timestamptz not null,
  payload      jsonb not null,                 -- { text, cc[], bcc[], size, align, files[{name,type,data}] }
  preview      text not null default '',
  status       text not null default 'waiting' check (status in ('waiting', 'sending', 'sent', 'failed', 'cancelled')),
  error        text,
  attempts     integer not null default 0,
  locked_until timestamptz,
  sent_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists scheduled_answers_due on public.scheduled_answers (send_at) where status = 'waiting';
create index if not exists scheduled_answers_reply on public.scheduled_answers (reply_id);
alter table public.scheduled_answers enable row level security;
revoke all on public.scheduled_answers from public, anon, authenticated;
-- The team sees when answers are scheduled and what happened; the text and files stay inside the database functions.
grant select (id, team_id, reply_id, created_by, send_at, preview, status, error, sent_at, created_at) on public.scheduled_answers to authenticated;
drop policy if exists "team reads its scheduled answers" on public.scheduled_answers;
create policy "team reads its scheduled answers" on public.scheduled_answers for select to authenticated using (public.is_member(team_id));

-- Schedule (owner or manager of the reply's team, active plan). One waiting answer per reply: a new one replaces it.
create or replace function public.schedule_answer(reply uuid, send_at timestamptz, payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r mail_replies; new_id uuid; txt text := coalesce(payload ->> 'text', ''); e text; f jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into r from mail_replies where id = reply;
  if r.id is null or public.my_team_id(true) is distinct from r.team_id then raise exception 'Only the owner or a manager can answer from the team mailbox'; end if;
  if r.kind <> 'reply' then raise exception 'This message is not a reply you can answer'; end if;
  if not public.team_active(r.team_id) then raise exception 'Your team needs an active plan to send'; end if;
  if send_at < now() + interval '1 minute' or send_at > now() + interval '30 days' then raise exception 'Pick a time between a minute and 30 days from now'; end if;
  if length(txt) < 2 or length(txt) > 5000 then raise exception 'Write your answer first'; end if;
  if octet_length(payload::text) > 4500000 then raise exception 'Attachments can be 3 MB in all'; end if;
  -- The same limits as the App's answer box (lib/reply-format.ts), also for a direct call that skips the App.
  if jsonb_typeof(coalesce(payload -> 'cc', '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(payload -> 'bcc', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(payload -> 'files', '[]'::jsonb)) <> 'array' then raise exception 'Cc, Bcc and files must be lists'; end if;
  if jsonb_array_length(coalesce(payload -> 'cc', '[]'::jsonb)) > 5 or jsonb_array_length(coalesce(payload -> 'bcc', '[]'::jsonb)) > 5 then
    raise exception 'Cc and Bcc can have 5 addresses each'; end if;
  for e in select value from jsonb_array_elements_text(coalesce(payload -> 'cc', '[]'::jsonb) || coalesce(payload -> 'bcc', '[]'::jsonb)) loop
    if e !~ '^[^@[:space:]<>"'',;]{1,64}@[a-z0-9.-]{1,200}\.[a-z]{2,24}$' then raise exception 'Check this address: %', left(e, 80); end if;
  end loop;
  if coalesce(payload ->> 'size', 'normal') not in ('small', 'normal', 'large') or coalesce(payload ->> 'align', 'left') not in ('left', 'center', 'right', 'justify') then
    raise exception 'Unknown text size or alignment'; end if;
  if jsonb_array_length(coalesce(payload -> 'files', '[]'::jsonb)) > 3 then raise exception 'Attach at most 3 files'; end if;
  for f in select value from jsonb_array_elements(coalesce(payload -> 'files', '[]'::jsonb)) loop
    if coalesce(f ->> 'name', '') ~* '\.(exe|bat|cmd|com|scr|msi|js|jse|vbs|vbe|wsf|ps1|jar|app|dmg|pkg|sh|apk|iso|lnk|hta|cpl|reg)$'
       or coalesce(f ->> 'data', '') !~ '^[A-Za-z0-9+/=]*$' then raise exception 'Programs and scripts can not be attached'; end if;
  end loop;
  update scheduled_answers set status = 'cancelled', payload = '{}'::jsonb where reply_id = r.id and status = 'waiting';
  insert into scheduled_answers (team_id, reply_id, created_by, send_at, payload, preview)
  values (r.team_id, r.id, auth.uid(), send_at, payload, left(regexp_replace(txt, '\s+', ' ', 'g'), 140))
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.schedule_answer(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.schedule_answer(uuid, timestamptz, jsonb) to authenticated;

create or replace function public.cancel_scheduled_answer(answer uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a scheduled_answers;
begin
  select * into a from scheduled_answers where id = answer;
  if a.id is null or public.my_team_id(true) is distinct from a.team_id then raise exception 'Scheduled answer not found'; end if;
  if a.status <> 'waiting' then raise exception 'It is already being sent or has been sent'; end if;
  update scheduled_answers set status = 'cancelled', payload = '{}'::jsonb where id = a.id;
end $$;
revoke all on function public.cancel_scheduled_answer(uuid) from public, anon;
grant execute on function public.cancel_scheduled_answer(uuid) to authenticated;

-- The mail timer (server secret): claim due answers, check every gate now, and return what to send with the mailbox login.
create or replace function public.scheduled_answers_due(server_secret text, max_n integer) returns json
language plpgsql security definer set search_path = public, vault as $$
declare a scheduled_answers; r mail_replies; m mailboxes; who text; pw text; why text; e text; out jsonb := '[]'::jsonb;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  for a in select * from scheduled_answers s
           where s.status = 'waiting' and s.send_at <= now() and coalesce(s.locked_until, '-infinity') < now()
           order by s.send_at limit greatest(1, least(coalesce(max_n, 5), 20)) for update skip locked loop
    why := null;
    select * into r from mail_replies where id = a.reply_id;
    select * into m from mailboxes where id = r.mailbox_id;
    who := lower(coalesce(r.lead_email, r.from_email));
    if r.id is null or m.id is null then why := 'The reply or its mailbox no longer exists';
    elsif not exists (select 1 from members x where x.team_id = a.team_id and x.user_id = a.created_by and x.role in ('owner', 'manager')) then why := 'The person who scheduled it is no longer an owner or manager of the team';
    elsif not public.team_active(a.team_id) then why := 'The team needs an active plan to send';
    elsif m.status <> 'ok' then why := 'The mailbox is not ready (test it in Email accounts)';
    elsif public.dnc_blocks_email(a.team_id, who) then why := 'This address is on Do-not-contact';
    else
      for e in select lower(value) from jsonb_array_elements_text(coalesce(a.payload -> 'cc', '[]'::jsonb) || coalesce(a.payload -> 'bcc', '[]'::jsonb)) loop
        if public.dnc_blocks_email(a.team_id, e) then why := 'A Cc or Bcc address is on Do-not-contact: ' || e; exit; end if;
      end loop;
    end if;
    if why is null and (select count(*) from mail_events v where v.mailbox_id = m.id and v.kind = 'sent' and v.at > now() - interval '24 hours') >= m.daily_limit then
      -- Over today's limit: try again in an hour (not a failure).
      update scheduled_answers set send_at = now() + interval '1 hour' where id = a.id;
      continue;
    end if;
    if why is not null then
      update scheduled_answers set status = 'failed', error = why, payload = '{}'::jsonb where id = a.id;
      continue;
    end if;
    update scheduled_answers set status = 'sending', attempts = attempts + 1, locked_until = now() + interval '10 minutes' where id = a.id;
    select decrypted_secret into pw from vault.decrypted_secrets where id = m.secret_id;
    out := out || jsonb_build_array(jsonb_build_object('id', a.id, 'reply_id', r.id, 'to', who, 'subject', r.subject, 'message_id', r.message_id, 'payload', a.payload,
      'box', jsonb_build_object('email', m.email, 'from_name', m.from_name, 'smtp_host', m.smtp_host, 'smtp_port', m.smtp_port, 'username', m.username, 'password', pw, 'signature', m.signature)));
  end loop;
  return out::json;
end $$;
revoke all on function public.scheduled_answers_due(text, integer) from public, anon, authenticated;
grant execute on function public.scheduled_answers_due(text, integer) to anon, authenticated;

-- The timer reports back. Sent: recorded like an answer from the App (counts toward the daily limit, reply handled).
-- Not sent: tried again in 10 minutes, up to 3 times, then failed with the reason.
create or replace function public.scheduled_answer_done(server_secret text, answer uuid, ok boolean, message_id text, err text) returns void
language plpgsql security definer set search_path = public as $$
declare a scheduled_answers; r mail_replies;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into a from scheduled_answers where id = answer and status = 'sending';
  if a.id is null then return; end if;
  if ok then
    select * into r from mail_replies where id = a.reply_id;
    insert into mail_events (team_id, campaign_id, campaign_lead_id, mailbox_id, step, kind, detail, message_id)
    values (r.team_id, r.campaign_id, r.campaign_lead_id, r.mailbox_id, null, 'sent', left('Answer (scheduled): ' || coalesce(a.payload ->> 'text', ''), 500), left(message_id, 300));
    update mail_replies set handled = true where id = r.id;
    update scheduled_answers set status = 'sent', sent_at = now(), error = null, payload = '{}'::jsonb, locked_until = null where id = a.id;
  elsif a.attempts < 3 then
    update scheduled_answers set status = 'waiting', send_at = now() + interval '10 minutes', error = left(err, 300), locked_until = null where id = a.id;
  else
    update scheduled_answers set status = 'failed', error = left(err, 300), payload = '{}'::jsonb, locked_until = null where id = a.id;
  end if;
end $$;
revoke all on function public.scheduled_answer_done(text, uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.scheduled_answer_done(text, uuid, boolean, text, text) to anon, authenticated;

-- ---------- timer: also run when a scheduled answer is due (032's condition plus one line)
do $$ begin
  if exists (select 1 from cron.job where jobname = 'kestrel-mail-tick') then perform cron.unschedule('kestrel-mail-tick'); end if;
  perform cron.schedule('kestrel-mail-tick', '* * * * *', $job$
    select net.http_post(
      url := 'https://kestrelleads.com/api/mail/tick',
      headers := jsonb_build_object('content-type', 'application/json',
        'x-kestrel-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'kestrel:mail-server-secret' limit 1)),
      body := '{}'::jsonb, timeout_milliseconds := 55000)
    where exists (select 1 from public.campaigns where status = 'running')
       or exists (select 1 from public.campaign_leads where first_sent_at > now() - interval '30 days')
       or exists (select 1 from public.scheduled_answers where status = 'waiting' and send_at <= now())
       or exists (select 1 from public.mailboxes m where m.status in ('ok', 'paused')
                  and not exists (select 1 from public.domain_monitor dm where dm.team_id = m.team_id
                                  and dm.domain = lower(split_part(m.email, '@', 2)) and dm.checked_at > now() - interval '23 hours'));
  $job$);
end $$;

notify pgrst, 'reload schema';
