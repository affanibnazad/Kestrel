-- Kestrel sequences: manual task steps (like lemlist and Instantly): a step can be an email (as before) or a task for a
-- person on the team: a LinkedIn message, a call or any other task. When a task step is due it is never sent: it becomes a
-- task on the Tasks page, and the sequence goes on to its next step on schedule (it does not wait for the task).
-- The first step is always an email. Replies, unsubscribes and Do-not-contact stop tasks the same way they stop emails.
-- Run once, after 037: node scripts/run-sql.mjs supabase/migrations/038_task_steps.sql  (safe to run again; only adds)

alter table public.mail_events drop constraint if exists mail_events_kind_check;
alter table public.mail_events add constraint mail_events_kind_check
  check (kind in ('sent', 'failed', 'replied', 'unsubscribed', 'blocked', 'test', 'bounced', 'auto', 'opened', 'paused', 'invalid', 'task'));

create or replace function public.sequence_steps_ok(steps jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare s jsonb; i integer := 0; prev integer := -1; d integer;
begin
  if steps is null or jsonb_typeof(steps) <> 'array' or jsonb_array_length(steps) not between 1 and 4 then return false; end if;
  for s in select value from jsonb_array_elements(steps) loop
    -- coalesce: a missing key gives null, which must count as wrong (not slip through).
    if jsonb_typeof(s) <> 'object' or coalesce(jsonb_typeof(s->'day'), '') <> 'number' or coalesce(jsonb_typeof(s->'subject'), '') <> 'string'
      or coalesce(jsonb_typeof(s->'body'), '') <> 'string' then return false; end if;
    d := (s->>'day')::numeric::integer;
    if (s->>'day')::numeric <> d or d < 0 or d > 90 or (i = 0 and d <> 0) or (i > 0 and d <= prev) then return false; end if;
    -- 038: a step is an email (default) or a manual task (linkedin, call, task); the first step is always an email.
    if coalesce(s->>'kind', 'email') not in ('email', 'linkedin', 'call', 'task') or (i = 0 and coalesce(s->>'kind', 'email') <> 'email') then return false; end if;
    if length(s->>'subject') > 200 or length(s->>'body') not between 1 and 4000 or (i = 0 and length(trim(s->>'subject')) = 0) then return false; end if;
    prev := d; i := i + 1;
  end loop;
  return true;
end $$;

create table if not exists public.campaign_tasks (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references public.teams (id) on delete cascade,
  campaign_id      uuid references public.campaigns (id) on delete cascade,
  campaign_lead_id uuid references public.campaign_leads (id) on delete cascade,
  lead_id          uuid references public.leads (id) on delete set null,
  step             integer not null,
  kind             text not null check (kind in ('linkedin', 'call', 'task')),
  instruction      text not null check (length(instruction) <= 4000),
  to_email         text,
  lead_name        text,
  due_at           timestamptz not null default now(),
  state            text not null default 'open' check (state in ('open', 'done', 'skipped', 'cancelled')),
  done_at          timestamptz,
  done_by          uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (campaign_lead_id, step)
);
create index if not exists campaign_tasks_open on public.campaign_tasks (team_id, state, due_at);
alter table public.campaign_tasks enable row level security;
revoke all on public.campaign_tasks from anon, authenticated;
grant select on public.campaign_tasks to authenticated;
drop policy if exists "team reads tasks" on public.campaign_tasks;
create policy "team reads tasks" on public.campaign_tasks for select to authenticated using (public.is_member(team_id));

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
      -- 038: only email steps are sent; LinkedIn, call and other task steps become tasks (mail_task_steps).
      and coalesce(cl.steps -> cl.next_step ->> 'kind', 'email') = 'email'
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

-- For the mail timer: turns due task steps into tasks and moves each lead on to its next step (never sends anything).
create or replace function public.mail_task_steps(server_secret text, max_n integer) returns integer
language plpgsql security definer set search_path = public as $$
declare l record; gap integer; n integer := 0;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  for l in
    select cl.* from campaign_leads cl join campaigns c on c.id = cl.campaign_id
    where cl.status = 'active' and cl.next_at <= now() and coalesce(cl.locked_until, '-infinity') < now() and c.status = 'running'
      and coalesce(cl.steps -> cl.next_step ->> 'kind', 'email') in ('linkedin', 'call', 'task')
      and public.team_active(cl.team_id)
    order by cl.next_at
    limit greatest(1, least(max_n, 200))
    for update of cl skip locked
  loop
    if public.dnc_blocks_email(l.team_id, l.to_email) then
      update campaign_leads set status = 'blocked', next_at = null where id = l.id;
      insert into mail_events (team_id, campaign_id, campaign_lead_id, mailbox_id, step, kind, detail) values (l.team_id, l.campaign_id, l.id, l.mailbox_id, l.next_step, 'blocked', 'On Do-not-contact');
      continue;
    end if;
    insert into campaign_tasks (team_id, campaign_id, campaign_lead_id, lead_id, step, kind, instruction, to_email, lead_name)
    values (l.team_id, l.campaign_id, l.id, l.lead_id, l.next_step, l.steps -> l.next_step ->> 'kind', left(coalesce(l.steps -> l.next_step ->> 'body', ''), 4000), l.to_email, l.lead_name)
    on conflict (campaign_lead_id, step) do nothing;
    gap := coalesce(floor((l.steps -> (l.next_step + 1) ->> 'day')::numeric)::integer - floor((l.steps -> l.next_step ->> 'day')::numeric)::integer, 0);
    update campaign_leads set next_step = next_step + 1, attempts = 0, locked_until = null, last_error = null,
      next_at = case when next_step + 1 < jsonb_array_length(steps) then now() + make_interval(days => greatest(gap, 1)) end,
      status = case when next_step + 1 < jsonb_array_length(steps) then 'active' else 'done' end
    where id = l.id;
    insert into mail_events (team_id, campaign_id, campaign_lead_id, mailbox_id, step, kind, detail)
    values (l.team_id, l.campaign_id, l.id, l.mailbox_id, l.next_step, 'task', l.steps -> l.next_step ->> 'kind');
    n := n + 1;
  end loop;
  -- A reply, unsubscribe or Do-not-contact closes the lead's open tasks.
  update campaign_tasks t set state = 'cancelled' from campaign_leads cl
  where t.campaign_lead_id = cl.id and t.state = 'open' and cl.status in ('replied', 'unsubscribed', 'blocked', 'bounced', 'stopped');
  update campaigns c set status = 'done' where c.status = 'running'
    and exists (select 1 from campaign_leads x where x.campaign_id = c.id)
    and not exists (select 1 from campaign_leads x where x.campaign_id = c.id and x.status = 'active');
  return n;
end $$;

-- Done or Skip on the Tasks page (anyone who can change leads).
create or replace function public.complete_task(task_id uuid, outcome text) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if outcome not in ('done', 'skipped', 'open') then raise exception 'Unknown outcome'; end if;
  select team_id into t from campaign_tasks where id = task_id;
  if t is null or not public.can_edit(t) then raise exception 'Task not found'; end if;
  update campaign_tasks set state = outcome, done_at = case when outcome = 'open' then null else now() end,
    done_by = case when outcome = 'open' then null else auth.uid() end
  where id = task_id;
end $$;

revoke all on function public.mail_task_steps(text, integer), public.complete_task(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_task(uuid, text) to authenticated;
grant execute on function public.mail_task_steps(text, integer) to anon, authenticated;   -- checked by the server secret

notify pgrst, 'reload schema';
