-- Kestrel: the owner panel (admins only). Numbers, every person using Kestrel, and contact messages.
-- Also asks people for permission before sending them news and offers (UK/EU email law: no marketing emails
-- without a yes). New sign-ups tick a box; anyone can change it later in Your profile.
-- Run once: node scripts/run-sql.mjs supabase/migrations/010_owner.sql  (safe to run again)

alter table public.members add column if not exists marketing_ok boolean not null default false;
alter table public.members add column if not exists marketing_at timestamptz;

-- Sign-up: also saves the "news and offers" choice.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta   jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  code   text := nullif(trim(meta ->> 'join_code'), '');
  person text := coalesce(nullif(trim(meta ->> 'full_name'), ''), split_part(new.email, '@', 1));
  firm   text := nullif(trim(meta ->> 'company'), '');
  terms  timestamptz := nullif(meta ->> 'accepted_terms_at', '')::timestamptz;
  job    text := left(nullif(trim(meta ->> 'job_title'), ''), 80);
  pick   text := case when meta ->> 'plan' in ('starter', 'pro', 'agency') then meta ->> 'plan' end;
  news   boolean := coalesce(meta ->> 'marketing', '') = 'true';
  t      uuid;
begin
  if code is not null then
    select id into t from teams where join_code = code;
  end if;
  if t is not null then
    insert into members (team_id, user_id, role, full_name, email, accepted_terms_at, job_title, marketing_ok, marketing_at)
    values (t, new.id, 'researcher', person, new.email, terms, job, news, case when news then now() end) on conflict do nothing;
  else
    insert into teams (name, created_by, chosen_plan, website, team_size, country, heard_from)
    values (coalesce(firm, person || '''s team'), new.id, pick,
            left(nullif(trim(meta ->> 'website'), ''), 200), left(nullif(trim(meta ->> 'team_size'), ''), 20),
            left(nullif(trim(meta ->> 'country'), ''), 80), left(nullif(trim(meta ->> 'heard_from'), ''), 80))
    returning id into t;
    insert into members (team_id, user_id, role, full_name, email, accepted_terms_at, job_title, marketing_ok, marketing_at)
    values (t, new.id, 'owner', person, new.email, terms, job, news, case when news then now() end);
  end if;
  return new;
end $$;

-- Your profile: change the news and offers choice.
create or replace function public.set_marketing(ok boolean) returns void
language sql security definer set search_path = public as $$
  update members set marketing_ok = ok, marketing_at = now() where user_id = auth.uid();
$$;
revoke all on function public.set_marketing(boolean) from public, anon;
grant execute on function public.set_marketing(boolean) to authenticated;

-- Each team's state in one word: paid, free (access code), trial, ended.
create or replace function public.team_state(t teams) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from access_grants g where g.team_id = t.id and g.revoked_at is null and g.ends_at > now()) then 'free'
    when t.plan <> 'trial' and t.billing_status is distinct from 'free' and coalesce(t.paid_until, now()) + interval '3 days' > now() then 'paid'
    when t.trial_ends_at > now() then 'trial'
    else 'ended' end;
$$;
revoke all on function public.team_state(teams) from public, anon, authenticated;

-- ---------- the owner panel
create or replace function public.admin_overview() returns json
language plpgsql stable security definer set search_path = public as $$
declare out json;
begin
  if not public.is_admin() then return null; end if;
  with t as (select x.*, public.team_state(x) as state from teams x),
       lc as (select team_id, count(*) as n, max(created_at) as last_at from leads group by team_id)
  select json_build_object(
    'totals', json_build_object(
      'people', (select count(*) from members),
      'teams', (select count(*) from t),
      'trial', (select count(*) from t where state = 'trial'),
      'ended', (select count(*) from t where state = 'ended'),
      'paid', (select count(*) from t where state = 'paid'),
      'free', (select count(*) from t where state = 'free'),
      'starter', (select count(*) from t where state = 'paid' and plan = 'starter'),
      'pro', (select count(*) from t where state = 'paid' and plan = 'pro'),
      'agency', (select count(*) from t where state = 'paid' and plan = 'agency'),
      'mrr', (select coalesce(sum(case plan when 'starter' then 9 when 'pro' then 19 when 'agency' then 49 else 0 end), 0) from t where state = 'paid'),
      'new7', (select count(*) from members where joined_at > now() - interval '7 days'),
      'new30', (select count(*) from members where joined_at > now() - interval '30 days'),
      'leads', (select count(*) from leads),
      'news_ok', (select count(*) from members where marketing_ok),
      'extensions', (select count(*) from extension_keys where last_used_at > now() - interval '7 days'),
      'messages', (select count(*) from contact_messages where created_at > now() - interval '7 days')),
    'people', (select coalesce(json_agg(json_build_object(
        'email', m.email, 'name', m.full_name, 'job', m.job_title, 'role', m.role, 'team', t.name, 'state', t.state, 'plan', t.plan,
        'trial_ends_at', t.trial_ends_at, 'paid_until', t.paid_until, 'billing_status', t.billing_status,
        'access_until', (public.team_access(t.id)).ends_at, 'joined_at', m.joined_at, 'last_seen', u.last_sign_in_at,
        'leads', coalesce(lc.n, 0), 'last_lead', lc.last_at, 'country', t.country, 'size', t.team_size, 'website', t.website,
        'heard_from', t.heard_from, 'news_ok', m.marketing_ok) order by m.joined_at desc), '[]'::json)
      from members m join t on t.id = m.team_id left join auth.users u on u.id = m.user_id left join lc on lc.team_id = t.id),
    'messages', (select coalesce(json_agg(json_build_object('name', c.name, 'email', c.email, 'company', c.company, 'topic', c.topic,
        'message', c.message, 'at', c.created_at) order by c.created_at desc), '[]'::json)
      from (select * from contact_messages order by created_at desc limit 300) c)
  ) into out;
  return out;
end $$;
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

-- my_account also returns the news and offers choice.
create or replace function public.my_account() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'team_id', t.id, 'team_name', t.name, 'role', m.role, 'full_name', m.full_name, 'job_title', m.job_title,
    'plan', t.plan, 'chosen_plan', t.chosen_plan, 'trial_ends_at', t.trial_ends_at,
    'active', public.team_active(t.id), 'paid_until', t.paid_until, 'billing_status', t.billing_status,
    'billing_portal', case when m.role = 'owner' then t.billing_portal end,
    'access_until', (public.team_access(t.id)).ends_at, 'access_plan', (public.team_access(t.id)).plan,
    'is_admin', public.is_admin(), 'news_ok', m.marketing_ok,
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

notify pgrst, 'reload schema';
