-- Kestrel integrations: booking link, webhooks (Zapier, Make, n8n…), HubSpot and Pipedrive sync, more email finders.
-- 1. team_ai.booking_link: the team's Calendly / Cal.com page, used as {{BOOKING_LINK}} and in Unibox answers.
-- 2. New team keys: hubspot, pipedrive (CRM) and apollo, findymail (email finders after Hunter). Extensions never get them.
-- 3. Webhooks: a team posts events (reply received, lead stage changed, unsubscribed, bounced, email sent) to its own https
--    URLs, signed with a per-webhook secret. One shared outbox, filled by triggers, delivered by the mail timer with retries.
-- 4. CRM sync: when a lead becomes Interested, Meeting booked or Won, it is sent to HubSpot / Pipedrive (contact + deal).
-- Run once, after 036: node scripts/run-sql.mjs supabase/migrations/037_integrations.sql  (safe to run again; only adds)

-- ---------- 1. booking link
alter table public.team_ai add column if not exists booking_link text not null default ''
  check (booking_link = '' or (booking_link ~ '^https://[^\s<>"]+$' and length(booking_link) <= 300));

-- ---------- 2. more key types
alter table public.team_keys drop constraint if exists team_keys_service_check;
alter table public.team_keys add constraint team_keys_service_check
  check (service in ('companiesHouse', 'hunter', 'listenNotes', 'anthropic', 'openai', 'gemini', 'openrouter', 'hubspot', 'pipedrive', 'apollo', 'findymail'));

create or replace function public.key_for_check(server_secret text, service text) returns text
language plpgsql stable security definer set search_path = public, vault as $$
declare t uuid := public.my_team_id(true); v text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  if t is null then raise exception 'Only the owner or a manager can test keys'; end if;
  if service not in ('companiesHouse', 'hunter', 'listenNotes', 'anthropic', 'openai', 'gemini', 'openrouter', 'hubspot', 'pipedrive', 'apollo', 'findymail') then raise exception 'Unknown service'; end if;
  select s.decrypted_secret into v from team_keys k join vault.decrypted_secrets s on s.id = k.secret_id where k.team_id = t and k.service = key_for_check.service;
  return v;
end $$;

-- Extensions get only the keys they use to collect leads, never CRM or finder keys.
create or replace function public.ext_team_keys(k text) returns json
language plpgsql security definer set search_path = public, vault as $$
declare r extension_keys;
begin
  r := ext_owner(k);
  return coalesce((select json_object_agg(t.service, s.decrypted_secret) from team_keys t join vault.decrypted_secrets s on s.id = t.secret_id
    where t.team_id = r.team_id and t.service in ('companiesHouse', 'hunter', 'listenNotes', 'anthropic', 'openai', 'gemini', 'openrouter')), '{}'::json);
end $$;

-- Email finders after Hunter (the Find emails step tries Hunter, then these, in order). Same rules as 013.
create or replace function public.finder_keys_for_server(server_secret text) returns json
language plpgsql stable security definer set search_path = public, vault as $$
declare t uuid;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select m.team_id into t from members m where m.user_id = auth.uid() and m.role in ('owner', 'manager', 'researcher') order by m.joined_at limit 1;
  if t is null then raise exception 'Only people who can change leads can find emails'; end if;
  if not public.team_active(t) then raise exception 'PLAN_NEEDED: Your free trial has ended. Choose a plan to keep finding emails.'; end if;
  return coalesce((select json_object_agg(k.service, s.decrypted_secret) from team_keys k join vault.decrypted_secrets s on s.id = k.secret_id
    where k.team_id = t and k.service in ('hunter', 'apollo', 'findymail')), '{}'::json);
end $$;
revoke all on function public.finder_keys_for_server(text) from public, anon;
grant execute on function public.finder_keys_for_server(text) to authenticated;

-- ---------- 3. webhooks
create table if not exists public.team_webhooks (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  url         text not null check (url ~ '^https://[^\s<>"]+$' and length(url) <= 500),
  events      text[] not null check (cardinality(events) between 1 and 5
                and events <@ array['reply.received', 'lead.stage_changed', 'lead.unsubscribed', 'email.bounced', 'email.sent']),
  secret_id   uuid not null,
  active      boolean not null default true,
  last_status integer,
  last_error  text check (length(last_error) <= 300),
  last_at     timestamptz,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.team_webhooks enable row level security;
revoke all on public.team_webhooks from anon, authenticated;
grant select (id, team_id, url, events, active, last_status, last_error, last_at, created_at) on public.team_webhooks to authenticated;
drop policy if exists "team reads webhooks" on public.team_webhooks;
-- Webhook addresses work like passwords (anyone with a Zapier/Make URL can post to it): only owners and managers see them.
create policy "team reads webhooks" on public.team_webhooks for select to authenticated using (team_id = public.my_team_id(true));

create or replace function public.save_webhook(hook_id uuid, url text, events text[], active boolean) returns uuid
language plpgsql security definer set search_path = public, vault, extensions as $$
declare t uuid := public.my_team_id(true); u text := trim(coalesce(url, '')); id_out uuid;
begin
  if t is null then raise exception 'Only the owner or a manager can change webhooks'; end if;
  if u !~ '^https://[^\s<>"]+$' or length(u) > 500 then raise exception 'The webhook address must start with https://'; end if;
  if hook_id is null then
    if (select count(*) from team_webhooks w where w.team_id = t) >= 5 then raise exception 'At most 5 webhooks'; end if;
    insert into team_webhooks (team_id, url, events, secret_id, active, created_by)
    values (t, u, events, vault.create_secret('whsec_' || encode(extensions.gen_random_bytes(24), 'hex'), 'kestrel:' || t || ':webhook:' || gen_random_uuid(), 'Kestrel webhook signing secret'),
      coalesce(active, true), auth.uid())
    returning id into id_out;
    return id_out;
  end if;
  update team_webhooks w set url = u, events = save_webhook.events, active = coalesce(save_webhook.active, true)
  where w.id = hook_id and w.team_id = t returning w.id into id_out;
  if id_out is null then raise exception 'Webhook not found'; end if;
  return id_out;
end $$;

create or replace function public.remove_webhook(hook_id uuid) returns void
language plpgsql security definer set search_path = public, vault as $$
declare t uuid := public.my_team_id(true); old uuid;
begin
  if t is null then raise exception 'Only the owner or a manager can change webhooks'; end if;
  delete from team_webhooks where id = hook_id and team_id = t returning secret_id into old;
  if old is not null then delete from vault.secrets where id = old; end if;
end $$;

-- The signing secret, for the owner or a manager to paste into their tool (shown on request, like Stripe's).
create or replace function public.webhook_secret(hook_id uuid) returns text
language plpgsql stable security definer set search_path = public, vault as $$
declare t uuid := public.my_team_id(true); v text;
begin
  if t is null then raise exception 'Only the owner or a manager can see webhook secrets'; end if;
  select s.decrypted_secret into v from team_webhooks w join vault.decrypted_secrets s on s.id = w.secret_id where w.id = hook_id and w.team_id = t;
  return v;
end $$;

-- ---------- the shared outbox (webhooks and CRM), filled only by triggers and the test function
create table if not exists public.integration_outbox (
  id          bigserial primary key,
  team_id     uuid not null references public.teams (id) on delete cascade,
  target      text not null check (target in ('webhook', 'hubspot', 'pipedrive')),
  hook_id     uuid references public.team_webhooks (id) on delete cascade,
  event       text not null check (length(event) <= 40),
  payload     jsonb not null check (pg_column_size(payload) < 16000),
  tries       integer not null default 0,
  next_at     timestamptz not null default now(),
  locked_until timestamptz,
  done        boolean not null default false,
  ok          boolean,
  created_at  timestamptz not null default now()
);
create index if not exists integration_outbox_due on public.integration_outbox (next_at) where not done;
alter table public.integration_outbox enable row level security;
revoke all on public.integration_outbox from anon, authenticated;

-- Puts one event in the outbox for every active webhook that wants it, and (for good stages) for each connected CRM.
create or replace function public.integration_enqueue(team uuid, ev text, body jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into integration_outbox (team_id, target, hook_id, event, payload)
    select team, 'webhook', w.id, ev, body from team_webhooks w where w.team_id = team and w.active and ev = any(w.events);
  if ev = 'lead.stage_changed' and body ->> 'stage' in ('interested', 'meeting', 'won') then
    insert into integration_outbox (team_id, target, event, payload)
      select team, k.service, 'crm.sync', body from team_keys k where k.team_id = team and k.service in ('hubspot', 'pipedrive');
  end if;
end $$;
revoke all on function public.integration_enqueue(uuid, text, jsonb) from public, anon, authenticated;

-- The lead part of every event.
create or replace function public.integration_lead(cl uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('email', c.to_email, 'name', coalesce(l.name, c.lead_name), 'website', l.website, 'phone', l.phone, 'location', l.location,
    'category', l.category, 'contact', l.data -> 'contacts' -> 0 -> 'name', 'lead_id', c.lead_id, 'campaign', jsonb_build_object('id', p.id, 'name', p.name),
    'stage', c.stage, 'status', c.status)
  from campaign_leads c left join leads l on l.id = c.lead_id left join campaigns p on p.id = c.campaign_id where c.id = cl;
$$;
revoke all on function public.integration_lead(uuid) from public, anon, authenticated;

create or replace function public.integration_on_reply() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text := case new.kind when 'reply' then 'reply.received' when 'remove' then 'lead.unsubscribed' when 'bounce' then 'email.bounced' end;
begin
  if ev is null then return new; end if;
  perform public.integration_enqueue(new.team_id, ev, jsonb_build_object('event', ev, 'at', coalesce(new.received_at, now()),
    'lead', coalesce(public.integration_lead(new.campaign_lead_id), jsonb_build_object('email', coalesce(new.lead_email, new.from_email))),
    'reply', jsonb_build_object('subject', new.subject, 'snippet', left(new.snippet, 500), 'from', new.from_email)));
  return new;
exception when others then return new;   -- an integration must never block reading replies
end $$;
drop trigger if exists integration_on_reply on public.mail_replies;
create trigger integration_on_reply after insert on public.mail_replies for each row execute function public.integration_on_reply();

create or replace function public.integration_on_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text := case when new.kind = 'sent' then 'email.sent' when new.kind = 'unsubscribed' then 'lead.unsubscribed' end;
begin
  if ev is null or new.campaign_lead_id is null then return new; end if;
  if not exists (select 1 from team_webhooks w where w.team_id = new.team_id and w.active and ev = any(w.events)) then return new; end if;
  perform public.integration_enqueue(new.team_id, ev, jsonb_build_object('event', ev, 'at', new.at, 'step', new.step + 1,
    'lead', public.integration_lead(new.campaign_lead_id)));
  return new;
exception when others then return new;
end $$;
drop trigger if exists integration_on_event on public.mail_events;
create trigger integration_on_event after insert on public.mail_events for each row execute function public.integration_on_event();

create or replace function public.integration_on_stage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stage is not distinct from old.stage or new.stage is null then return new; end if;
  perform public.integration_enqueue(new.team_id, 'lead.stage_changed', jsonb_build_object('event', 'lead.stage_changed', 'at', now(),
    'stage', new.stage, 'previous_stage', old.stage, 'lead', public.integration_lead(new.id)));
  return new;
exception when others then return new;
end $$;
drop trigger if exists integration_on_stage on public.campaign_leads;
create trigger integration_on_stage after update of stage on public.campaign_leads for each row execute function public.integration_on_stage();

-- A test event to one webhook, now (owner or manager). Delivered by the next timer run, or at once by /api/integrations/test.
create or replace function public.test_webhook(hook_id uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id(true); n bigint;
begin
  if t is null then raise exception 'Only the owner or a manager can test webhooks'; end if;
  if not exists (select 1 from team_webhooks where id = hook_id and team_id = t) then raise exception 'Webhook not found'; end if;
  if (select count(*) from integration_outbox where team_id = t and event = 'test' and created_at > now() - interval '1 hour') >= 20 then raise exception 'Too many tests. Try again later'; end if;
  insert into integration_outbox (team_id, target, hook_id, event, payload)
  values (t, 'webhook', hook_id, 'test', jsonb_build_object('event', 'test', 'at', now(), 'lead', jsonb_build_object('email', 'sam@example.com', 'name', 'Example Studio',
    'website', 'https://example.com', 'contact', 'Sam Example', 'stage', 'interested', 'campaign', jsonb_build_object('name', 'Example campaign')),
    'reply', jsonb_build_object('subject', 'Re: quick question', 'snippet', 'Sounds interesting, can you send examples?')))
  returning id into n;
  return n;
end $$;

-- ---------- delivery (the mail timer, or the test route; both need the server secret)
create or replace function public.integration_due(server_secret text, max_n integer, only_id bigint default null) returns json
language plpgsql security definer set search_path = public, vault as $$
declare out json;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  delete from integration_outbox where done and created_at < now() - interval '30 days';
  with picked as (
    select o.id from integration_outbox o
    where not o.done and o.next_at <= now() and (o.locked_until is null or o.locked_until < now()) and (only_id is null or o.id = only_id)
    order by o.next_at limit greatest(1, least(max_n, 25)) for update skip locked
  ), locked as (
    update integration_outbox o set locked_until = now() + interval '2 minutes' from picked where o.id = picked.id returning o.*
  )
  select coalesce(json_agg(json_build_object('id', l.id, 'target', l.target, 'event', l.event, 'payload', l.payload, 'tries', l.tries,
    'url', w.url, 'secret', case when l.target = 'webhook' then (select decrypted_secret from vault.decrypted_secrets where id = w.secret_id)
      else (select s.decrypted_secret from team_keys k join vault.decrypted_secrets s on s.id = k.secret_id where k.team_id = l.team_id and k.service = l.target) end)), '[]'::json)
  into out
  from locked l left join team_webhooks w on w.id = l.hook_id;
  return out;
end $$;

-- Result of one delivery. Failures are tried again after 1, 2, 4, 8 and 16 minutes, then given up.
create or replace function public.integration_report(server_secret text, item bigint, success boolean, http_status integer, err text) returns void
language plpgsql security definer set search_path = public as $$
declare o integration_outbox;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  update integration_outbox x set tries = x.tries + 1, locked_until = null,
    done = success or x.tries + 1 >= 6, ok = case when success then true when x.tries + 1 >= 6 then false end,
    next_at = now() + make_interval(mins => power(2, x.tries)::int)
  where x.id = item and not x.done returning * into o;
  if o.hook_id is not null then
    update team_webhooks set last_status = http_status, last_error = case when success then null else left(nullif(err, ''), 300) end, last_at = now() where id = o.hook_id;
  end if;
end $$;

revoke all on function public.save_webhook(uuid, text, text[], boolean), public.remove_webhook(uuid), public.webhook_secret(uuid), public.test_webhook(uuid),
  public.integration_due(text, integer, bigint), public.integration_report(text, bigint, boolean, integer, text) from public, anon;
grant execute on function public.save_webhook(uuid, text, text[], boolean), public.remove_webhook(uuid), public.webhook_secret(uuid), public.test_webhook(uuid) to authenticated;
-- The timer's server call has no signed-in person: these check the server secret instead.
grant execute on function public.integration_due(text, integer, bigint), public.integration_report(text, bigint, boolean, integer, text) to anon, authenticated;

notify pgrst, 'reload schema';
