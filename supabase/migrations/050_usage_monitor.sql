-- Kestrel 050: Owner → Usage. Affan sees how every company uses Kestrel (searches, leads, sending, AI) and which
-- break the rules (red/amber flags), and can lock a team. Only numbers and search keywords are shown: never email text,
-- passwords or keys. Terms and Privacy say Kestrel watches use to enforce its rules (same release).
-- Locked = read-only everywhere (team_active is false): no sending, no AI, no extension sync. Only an admin can lock or
-- unlock; every lock and unlock is written to admin_actions.
-- Run once: node scripts/run-sql.mjs supabase/migrations/050_usage_monitor.sql  (safe to run again)

alter table public.teams add column if not exists locked_at timestamptz;
alter table public.teams add column if not exists locked_reason text check (length(locked_reason) <= 300);

create table if not exists public.admin_actions (
  id        bigint generated always as identity primary key,
  team_id   uuid references public.teams (id) on delete set null,
  admin_id  uuid references auth.users (id) on delete set null,
  action    text not null check (action in ('lock', 'unlock')),
  reason    text check (length(reason) <= 300),
  at        timestamptz not null default now()
);
create index if not exists admin_actions_team on public.admin_actions (team_id, at desc);
alter table public.admin_actions enable row level security;
revoke all on public.admin_actions from public, anon, authenticated;

-- Same as 009, plus: a locked team is not active.
create or replace function public.team_active(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from teams where id = t and locked_at is not null)
     and (exists (select 1 from teams where id = t and (trial_ends_at > now()
           or (plan <> 'trial' and billing_status is distinct from 'free' and coalesce(paid_until, now()) + interval '3 days' > now())))
      or exists (select 1 from access_grants where team_id = t and revoked_at is null and ends_at > now()));
$$;

-- For the App: is my team locked, and why (the App shows it instead of "choose a plan").
create or replace function public.my_team_lock() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('at', t.locked_at, 'reason', t.locked_reason)
  from teams t join members m on m.team_id = t.id
  where m.user_id = auth.uid() and t.locked_at is not null limit 1;
$$;
revoke all on function public.my_team_lock() from public, anon;
grant execute on function public.my_team_lock() to authenticated;

-- ---------- one row per team for the last `days` days, with flags
create or replace function public.admin_usage(days integer default 30) returns json
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz; out json;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can see usage'; end if;
  since := now() - make_interval(days => greatest(1, least(coalesce(days, 30), 365)));
  with
    s as (select team_id, count(*) n, max(at) last_at from progress where at > since group by team_id),
    l as (select team_id, count(*) n, max(created_at) last_at from leads where created_at > since group by team_id),
    lt as (select team_id, count(*) n from leads group by team_id),
    lmax as (select team_id, max(n) n from (select team_id, date_trunc('day', created_at) d, count(*) n from leads where created_at > since group by 1, 2) x group by team_id),
    e as (select team_id, count(*) filter (where kind = 'sent') sent, count(*) filter (where kind = 'bounced') bounced,
                 count(*) filter (where kind = 'unsubscribed') unsubs, count(*) filter (where kind = 'paused') paused, max(at) filter (where kind = 'sent') last_at
          from mail_events where at > since group by team_id),
    r as (select team_id, count(*) filter (where kind in ('reply', 'remove')) replies,
                 count(*) filter (where kind in ('reply', 'remove') and public.is_spam_complaint(concat_ws(' ', subject, snippet))) complaints
          from mail_replies where coalesce(received_at, created_at) > since group by team_id),
    d as (select cl.team_id, count(*) n from mail_events ev join campaign_leads cl on cl.id = ev.campaign_lead_id
          where ev.kind = 'sent' and ev.at > since and public.dnc_blocks_email(cl.team_id, cl.to_email) group by cl.team_id),
    a as (select team_id, sum(messages) n from assistant_usage where day > (since at time zone 'utc')::date group by team_id),
    mb as (select team_id, count(*) n from mailboxes group by team_id),
    mem as (select team_id, count(*) n, max(u.last_sign_in_at) seen from members m left join auth.users u on u.id = m.user_id group by team_id),
    own as (select distinct on (team_id) team_id, email from members where role = 'owner' order by team_id, joined_at),
    rw as (
      select t.id, t.name, own.email owner, public.team_state(t) state, t.plan, t.locked_at, t.locked_reason, t.created_at,
             coalesce(mem.n, 0) people, mem.seen, coalesce(s.n, 0) searches, coalesce(l.n, 0) leads_new, coalesce(lt.n, 0) leads_total,
             coalesce(lmax.n, 0) leads_top_day, coalesce(e.sent, 0) sent, coalesce(e.bounced, 0) bounced, coalesce(e.unsubs, 0) unsubs,
             coalesce(e.paused, 0) paused, coalesce(r.replies, 0) replies, coalesce(r.complaints, 0) complaints, coalesce(d.n, 0) dnc_sent,
             coalesce(a.n, 0) ai_messages, coalesce(mb.n, 0) mailboxes,
             greatest(s.last_at, l.last_at, e.last_at, mem.seen) last_active
      from teams t left join s on s.team_id = t.id left join l on l.team_id = t.id left join lt on lt.team_id = t.id
        left join lmax on lmax.team_id = t.id left join e on e.team_id = t.id left join r on r.team_id = t.id left join d on d.team_id = t.id
        left join a on a.team_id = t.id left join mb on mb.team_id = t.id left join mem on mem.team_id = t.id left join own on own.team_id = t.id)
  select coalesce(json_agg(json_build_object(
      'id', id, 'name', name, 'owner', owner, 'state', state, 'plan', plan, 'locked_at', locked_at, 'locked_reason', locked_reason,
      'created_at', created_at, 'people', people, 'seen', seen, 'searches', searches, 'leads_new', leads_new, 'leads_total', leads_total,
      'leads_top_day', leads_top_day, 'sent', sent, 'bounced', bounced, 'unsubs', unsubs, 'paused', paused, 'replies', replies,
      'complaints', complaints, 'dnc_sent', dnc_sent, 'ai_messages', ai_messages, 'mailboxes', mailboxes, 'last_active', last_active,
      'flags', (select coalesce(json_agg(f), '[]'::json) from (
        select json_build_object('level', 'red', 'text', format('%s spam complaint(s)', complaints)) f where complaints > 0
        union all select json_build_object('level', 'red', 'text', format('%s emails to Do-not-contact', dnc_sent)) where dnc_sent > 0
        union all select json_build_object('level', 'red', 'text', format('Bounces %s%%', round(bounced * 100.0 / sent, 1))) where sent >= 20 and bounced * 100.0 / sent > 5
        union all select json_build_object('level', 'amber', 'text', format('Unsubscribes %s%%', round(unsubs * 100.0 / sent, 1))) where sent >= 40 and unsubs * 100.0 / sent > 5
        union all select json_build_object('level', 'amber', 'text', format('Kestrel paused sending %s time(s)', paused)) where paused > 0
        union all select json_build_object('level', 'amber', 'text', format('%s leads in one day', leads_top_day)) where leads_top_day > 5000
        union all select json_build_object('level', 'amber', 'text', format('%s email accounts', mailboxes)) where mailboxes > 20
      ) x)) order by last_active desc nulls last), '[]'::json)
  into out from rw;
  return out;
end $$;

-- ---------- one team in detail: searches (keywords and places), leads by day and source, sending by day, email accounts,
-- members, and the lock history. No email text.
create or replace function public.admin_team_usage(t uuid, days integer default 30) returns json
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can see usage'; end if;
  since := now() - make_interval(days => greatest(1, least(coalesce(days, 30), 365)));
  return json_build_object(
    'searches', (select coalesce(json_agg(x order by x.at desc), '[]'::json) from (
        select p.key, p.status, p.found, p.saved, p.at, m.email who from progress p left join members m on m.user_id = p.by_user and m.team_id = p.team_id
        where p.team_id = t and p.at > since order by p.at desc limit 300) x),
    'leads_by_day', (select coalesce(json_agg(x order by x.day desc), '[]'::json) from (
        select (created_at at time zone 'utc')::date as day, count(*) n from leads where team_id = t and created_at > since group by 1) x),
    'leads_by_source', (select coalesce(json_agg(x order by x.n desc), '[]'::json) from (
        select coalesce(source, 'other') source, count(*) n from leads where team_id = t and created_at > since group by 1) x),
    'mail_by_day', (select coalesce(json_agg(x order by x.day desc), '[]'::json) from (
        select (at at time zone 'utc')::date as day, count(*) filter (where kind = 'sent') sent, count(*) filter (where kind = 'bounced') bounced,
               count(*) filter (where kind = 'unsubscribed') unsubs from mail_events where team_id = t and at > since group by 1) x),
    'mailboxes', (select coalesce(json_agg(json_build_object('email', email, 'status', status, 'note', last_error)), '[]'::json) from mailboxes where team_id = t),
    'members', (select coalesce(json_agg(json_build_object('email', m.email, 'role', m.role, 'joined_at', m.joined_at, 'seen', u.last_sign_in_at) order by m.joined_at), '[]'::json)
        from members m left join auth.users u on u.id = m.user_id where m.team_id = t),
    'actions', (select coalesce(json_agg(json_build_object('action', a.action, 'reason', a.reason, 'at', a.at, 'by', u.email) order by a.at desc), '[]'::json)
        from admin_actions a left join auth.users u on u.id = a.admin_id where a.team_id = t));
end $$;

-- ---------- lock / unlock
create or replace function public.admin_lock_team(t uuid, reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can lock a team'; end if;
  if coalesce(length(trim(reason)), 0) < 3 then raise exception 'Write a short reason (the team sees it)'; end if;
  update teams set locked_at = now(), locked_reason = left(trim(reason), 300) where id = t;
  if not found then raise exception 'Team not found'; end if;
  insert into admin_actions (team_id, admin_id, action, reason) values (t, auth.uid(), 'lock', left(trim(reason), 300));
end $$;

create or replace function public.admin_unlock_team(t uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can unlock a team'; end if;
  update teams set locked_at = null, locked_reason = null where id = t and locked_at is not null;
  if found then insert into admin_actions (team_id, admin_id, action) values (t, auth.uid(), 'unlock'); end if;
end $$;

revoke all on function public.admin_usage(integer), public.admin_team_usage(uuid, integer), public.admin_lock_team(uuid, text), public.admin_unlock_team(uuid) from public, anon;
grant execute on function public.admin_usage(integer), public.admin_team_usage(uuid, integer), public.admin_lock_team(uuid, text), public.admin_unlock_team(uuid) to authenticated;   -- all check is_admin()

notify pgrst, 'reload schema';
