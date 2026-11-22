-- Kestrel: paid plans. After the 7-day trial a team must have a paid plan, or Kestrel becomes read-only:
--   * the App can still show and export the team's leads (their own data), but nothing can be added or changed,
--   * the extension stops sending leads and its collecting is locked until a plan is paid,
--   * AI in the App stops.
-- Payments go through Lemon Squeezy (it handles cards, VAT and receipts). Lemon Squeezy tells Kestrel about each
-- payment with a signed message (webhook). The signing secret lives only in Supabase Vault; this database checks
-- every message itself, so the website never holds a payment secret.
-- Contact form messages are kept here too.
-- Run once: node scripts/run-sql.mjs supabase/migrations/008_billing.sql  (safe to run again)

-- ---------- what a team has paid for
alter table public.teams add column if not exists paid_until timestamptz;
alter table public.teams add column if not exists billing_status text;
alter table public.teams add column if not exists ls_subscription_id text;
alter table public.teams add column if not exists ls_customer_id text;
alter table public.teams add column if not exists billing_portal text;

-- The three plans in Lemon Squeezy: each plan's product variant and its checkout link (public, not secret).
create table if not exists public.billing_plans (
  plan         text primary key check (plan in ('starter', 'pro', 'agency')),
  variant_id   text not null,
  checkout_url text not null check (checkout_url like 'https://%'),
  discount     text
);
alter table public.billing_plans enable row level security;
drop policy if exists "anyone reads plans" on public.billing_plans;
create policy "anyone reads plans" on public.billing_plans for select to anon, authenticated using (true);
revoke all on public.billing_plans from anon, authenticated;
grant select on public.billing_plans to anon, authenticated;

-- Is this team allowed to add and change things? In the trial, or paid up (with 3 days' grace for a late payment).
create or replace function public.team_active(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams where id = t and (trial_ends_at > now() or (plan <> 'trial' and coalesce(paid_until, now()) + interval '3 days' > now())));
$$;
revoke all on function public.team_active(uuid) from public, anon;
grant execute on function public.team_active(uuid) to authenticated;

-- People who can change leads can do so only while the team is active. Every write rule (leads, lists, offers, AI
-- settings) already goes through can_edit, so this one change makes the whole App read-only after the trial.
create or replace function public.can_edit(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.team_active(t) and exists (select 1 from members where team_id = t and user_id = auth.uid() and role in ('owner', 'manager', 'researcher'));
$$;

-- AI in the App: only for active teams.
create or replace function public.ai_key_for_server(service text) returns text
language plpgsql stable security definer set search_path = public, vault as $$
declare t uuid; v text;
begin
  if service not in ('anthropic', 'openai', 'gemini', 'openrouter') then raise exception 'Not an AI service'; end if;
  select m.team_id into t from members m where m.user_id = auth.uid() and m.role in ('owner', 'manager', 'researcher') order by m.joined_at limit 1;
  if t is null then raise exception 'Only people who can change leads can use AI'; end if;
  if not public.team_active(t) then raise exception 'PLAN_NEEDED: Your free trial has ended. Choose a plan to keep using AI.'; end if;
  select s.decrypted_secret into v from team_keys k join vault.decrypted_secrets s on s.id = k.secret_id where k.team_id = t and k.service = ai_key_for_server.service;
  return v;
end $$;

-- ---------- the extension: a connection key works only while the team is active
create or replace function public.ext_owner(k text) returns extension_keys
language plpgsql security definer set search_path = public, extensions as $$
declare r extension_keys;
begin
  select * into r from extension_keys where key_hash = encode(extensions.digest(coalesce(k, ''), 'sha256'), 'hex');
  if r.id is null then raise exception 'This connection key is not valid any more. Connect the extension again from the App.'; end if;
  if not exists (select 1 from members where team_id = r.team_id and user_id = r.user_id and role <> 'viewer') then
    raise exception 'This account can no longer add leads to the team.';
  end if;
  if not public.team_active(r.team_id) then raise exception 'PLAN_NEEDED: Your free trial has ended. Choose a plan in the Kestrel App to keep collecting.'; end if;
  update extension_keys set last_used_at = now() where id = r.id;
  return r;
end $$;
revoke all on function public.ext_owner(text) from public, anon, authenticated;

-- Who am I, and may I collect? Answers even when the plan has ended, so the extension can say why it is locked.
create or replace function public.ext_whoami(k text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare r extension_keys;
begin
  select * into r from extension_keys where key_hash = encode(extensions.digest(coalesce(k, ''), 'sha256'), 'hex');
  if r.id is null then raise exception 'This connection key is not valid any more. Connect the extension again from the App.'; end if;
  if not exists (select 1 from members where team_id = r.team_id and user_id = r.user_id and role <> 'viewer') then
    raise exception 'This account can no longer add leads to the team.';
  end if;
  update extension_keys set last_used_at = now() where id = r.id;
  return (select json_build_object('team', t.name, 'email', u.email, 'active', public.team_active(t.id), 'plan', t.plan,
    'trial_ends_at', t.trial_ends_at, 'paid_until', t.paid_until)
    from teams t, auth.users u where t.id = r.team_id and u.id = r.user_id);
end $$;
revoke all on function public.ext_whoami(text) from public;
grant execute on function public.ext_whoami(text) to anon, authenticated;

-- ---------- the App: my_account also says whether the team is active and how it pays
create or replace function public.my_account() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'team_id', t.id, 'team_name', t.name, 'role', m.role, 'full_name', m.full_name, 'job_title', m.job_title,
    'plan', t.plan, 'chosen_plan', t.chosen_plan, 'trial_ends_at', t.trial_ends_at,
    'active', public.team_active(t.id), 'paid_until', t.paid_until, 'billing_status', t.billing_status,
    'billing_portal', case when m.role = 'owner' then t.billing_portal end,
    'website', t.website, 'team_size', t.team_size, 'country', t.country,
    'join_code', case when m.role in ('owner', 'manager') then t.join_code end,
    'members', (select json_agg(json_build_object('name', x.full_name, 'email', x.email, 'role', x.role, 'joined_at', x.joined_at) order by x.joined_at)
                from members x where x.team_id = t.id)
  )
  from members m join teams t on t.id = m.team_id
  where m.user_id = auth.uid()
  order by m.joined_at limit 1;
$$;
revoke all on function public.my_account() from public, anon;
grant execute on function public.my_account() to authenticated;

-- ---------- Lemon Squeezy webhook: checks the signature with the secret in Vault, then updates the team.
-- The checkout link carries the team id (custom data); the plan comes from the product variant actually bought.
create or replace function public.ls_webhook(payload text, signature text) returns text
language plpgsql security definer set search_path = public, vault, extensions as $$
declare
  secret text; body jsonb; a jsonb; ev text; t uuid; p text; st text; until timestamptz;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'kestrel:lemonsqueezy-webhook' limit 1;
  if secret is null then raise exception 'Payments are not set up yet'; end if;
  if signature is null or encode(extensions.hmac(convert_to(payload, 'UTF8'), convert_to(secret, 'UTF8'), 'sha256'), 'hex') <> lower(signature) then
    raise exception 'Bad signature';
  end if;
  body := payload::jsonb;
  ev := body #>> '{meta,event_name}';
  if ev not like 'subscription_%' then return 'ignored'; end if;
  a := body #> '{data,attributes}';
  begin t := (body #>> '{meta,custom_data,team_id}')::uuid; exception when others then t := null; end;
  if t is null then return 'no team'; end if;
  select plan into p from billing_plans where variant_id = a ->> 'variant_id';
  if p is null then return 'unknown variant'; end if;
  st := a ->> 'status';
  -- active / on_trial / past_due: paid until the next renewal. cancelled: paid until it ends. expired / unpaid: over now.
  until := case when st in ('active', 'on_trial', 'past_due') then coalesce((a ->> 'renews_at')::timestamptz, now() + interval '31 days')
                when st = 'cancelled' then coalesce((a ->> 'ends_at')::timestamptz, now())
                else now() end;
  update teams set plan = case when st in ('expired', 'unpaid') then plan else p end, chosen_plan = p, paid_until = until, billing_status = st,
    ls_subscription_id = coalesce(body #>> '{data,id}', ls_subscription_id), ls_customer_id = coalesce(a ->> 'customer_id', ls_customer_id),
    billing_portal = coalesce(a #>> '{urls,customer_portal}', billing_portal)
  where id = t;
  return 'ok';
end $$;
revoke all on function public.ls_webhook(text, text) from public;
grant execute on function public.ls_webhook(text, text) to anon, authenticated;

-- ---------- contact form
create table if not exists public.contact_messages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 120),
  email      text not null check (length(email) between 3 and 200 and email like '%@%'),
  topic      text not null default 'question' check (topic in ('question', 'sales', 'billing', 'privacy', 'security', 'other')),
  message    text not null check (length(message) between 5 and 5000),
  company    text check (length(company) <= 120),
  created_at timestamptz not null default now()
);
alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from anon, authenticated;

-- Saves one message. At most 3 an hour from the same email, and 60 an hour in total, to stop floods.
create or replace function public.send_contact(name text, email text, topic text, message text, company text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from contact_messages c where lower(c.email) = lower(trim(send_contact.email)) and c.created_at > now() - interval '1 hour') >= 3
     or (select count(*) from contact_messages c where c.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'TOO_MANY: Too many messages just now. Please try again in an hour.';
  end if;
  insert into contact_messages (name, email, topic, message, company)
  values (trim(send_contact.name), lower(trim(send_contact.email)), coalesce(nullif(send_contact.topic, ''), 'question'), trim(send_contact.message), nullif(trim(coalesce(send_contact.company, '')), ''));
end $$;
revoke all on function public.send_contact(text, text, text, text, text) from public;
grant execute on function public.send_contact(text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
