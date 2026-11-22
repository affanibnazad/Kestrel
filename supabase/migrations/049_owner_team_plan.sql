-- Kestrel 049: Owner → People → Change plan. A Kestrel admin gives a team Starter, Pro or Agency for a number of days
-- (free access, like an access code but without a code), or takes it back. It replaces the team's current free access.
-- A paying team's Lemon Squeezy subscription is never changed here (that stays in Lemon Squeezy).
-- Run once: node scripts/run-sql.mjs supabase/migrations/049_owner_team_plan.sql  (safe to run again)

create or replace function public.admin_set_team_plan(t uuid, p text, days integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can change a team''s plan'; end if;
  if p not in ('starter', 'pro', 'agency') then raise exception 'Choose Starter, Pro or Agency'; end if;
  if days is null or days < 1 or days > 3650 then raise exception 'Choose 1 to 3650 days'; end if;
  if not exists (select 1 from teams where id = t) then raise exception 'Team not found'; end if;
  perform 1 from teams where id = t for update;   -- one change at a time per team
  update access_grants set revoked_at = now() where team_id = t and revoked_at is null and ends_at > now();
  insert into access_grants (team_id, code, plan, starts_at, ends_at, claimed_by) values (t, null, p, now(), now() + make_interval(days => days), auth.uid());
end $$;

create or replace function public.admin_clear_team_plan(t uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can change a team''s plan'; end if;
  update access_grants set revoked_at = now() where team_id = t and revoked_at is null and ends_at > now();
end $$;

revoke all on function public.admin_set_team_plan(uuid, text, integer), public.admin_clear_team_plan(uuid) from public, anon;
grant execute on function public.admin_set_team_plan(uuid, text, integer), public.admin_clear_team_plan(uuid) to authenticated;   -- both check is_admin()

-- The Owner panel's people list now also gives each person's team id (for Change plan). Same as 010 otherwise.
create or replace function public.admin_overview() returns json
language plpgsql stable security definer set search_path = public as $$
declare out json;
begin
  if not coalesce(public.is_admin(), false) then return null; end if;
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
        'email', m.email, 'team_id', t.id, 'name', m.full_name, 'job', m.job_title, 'role', m.role, 'team', t.name, 'state', t.state, 'plan', t.plan,
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

notify pgrst, 'reload schema';
