-- Kestrel: free access you give and take back. No team is free forever.
--   * Affan (admin) makes an access code: how many days of free access it gives, how many teams may use it, and
--     until when it can be claimed. He shares it as a code or as an invitation link (kestrelleads.com/redeem?code=…).
--   * A team owner claims it in the App. The team is then active (like a paid plan) until the days run out.
--   * Affan can take access back at any time: per team, or for a whole code (every team that used it).
-- Also ends the earlier "free for good" setting (free-team.mjs). Admins are listed in public.admins.
-- Run once: node scripts/run-sql.mjs supabase/migrations/009_access.sql  (safe to run again)

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.access_codes (
  code        text primary key check (code ~ '^[A-Z0-9-]{6,40}$'),
  label       text not null default '' check (length(label) <= 80),
  plan        text not null default 'pro' check (plan in ('starter', 'pro', 'agency')),
  days        integer not null check (days between 1 and 366),
  max_uses    integer not null default 1 check (max_uses between 1 and 1000),
  claim_until timestamptz,
  revoked_at  timestamptz,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create table if not exists public.access_grants (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  code        text references public.access_codes (code) on delete set null,
  plan        text not null default 'pro',
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz not null,
  revoked_at  timestamptz,
  claimed_by  uuid references auth.users (id) on delete set null,
  unique (team_id, code)
);
create index if not exists access_grants_team_idx on public.access_grants (team_id);
alter table public.access_codes enable row level security;
alter table public.access_grants enable row level security;
revoke all on public.access_codes, public.access_grants from anon, authenticated;

-- Free access this team has right now (the latest end), or null.
create or replace function public.team_access(t uuid) returns public.access_grants
language sql stable security definer set search_path = public as $$
  select * from access_grants where team_id = t and revoked_at is null and ends_at > now() order by ends_at desc limit 1;
$$;
revoke all on function public.team_access(uuid) from public, anon, authenticated;

-- Active = trial running, or a paid plan (3 days' grace), or free access given with a code.
create or replace function public.team_active(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams where id = t and (trial_ends_at > now()
           or (plan <> 'trial' and billing_status is distinct from 'free' and coalesce(paid_until, now()) + interval '3 days' > now())))
      or exists (select 1 from access_grants where team_id = t and revoked_at is null and ends_at > now());
$$;

-- End "free for good" (it was set with free-team.mjs): those teams go back to trial rules.
update public.teams set plan = 'trial', paid_until = null, billing_status = null where billing_status = 'free';

-- ---------- a team owner claims a code
create or replace function public.redeem_access(code text) returns json
language plpgsql security definer set search_path = public as $$
declare c access_codes; t uuid; used integer; g access_grants; until timestamptz;
begin
  select m.team_id into t from members m where m.user_id = auth.uid() and m.role = 'owner' order by m.joined_at limit 1;
  if t is null then raise exception 'ACCESS: Only a team owner can use an access code.'; end if;
  select * into c from access_codes a where a.code = upper(trim(redeem_access.code));
  if c.code is null then raise exception 'ACCESS: That code was not found. Check it and try again.'; end if;
  if c.revoked_at is not null then raise exception 'ACCESS: That code has been switched off.'; end if;
  if c.claim_until is not null and c.claim_until < now() then raise exception 'ACCESS: That code can no longer be claimed.'; end if;
  if exists (select 1 from access_grants x where x.team_id = t and x.code = c.code) then raise exception 'ACCESS: Your team has already used this code.'; end if;
  select count(*) into used from access_grants x where x.code = c.code;
  if used >= c.max_uses then raise exception 'ACCESS: That code has been used up.'; end if;
  -- Free days start now, or after access the team already has (they add up).
  until := greatest(now(), coalesce((public.team_access(t)).ends_at, now())) + make_interval(days => c.days);
  insert into access_grants (team_id, code, plan, ends_at, claimed_by) values (t, c.code, c.plan, until, auth.uid()) returning * into g;
  return json_build_object('plan', g.plan, 'ends_at', g.ends_at, 'days', c.days);
end $$;
revoke all on function public.redeem_access(text) from public, anon;
grant execute on function public.redeem_access(text) to authenticated;

-- ---------- admin: make, list and take back
create or replace function public.admin_new_code(label text, plan text, days integer, max_uses integer, claim_days integer) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare k text;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  k := 'KST-' || upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 4)) || '-' || upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 4));
  insert into access_codes (code, label, plan, days, max_uses, claim_until, created_by)
  values (k, left(coalesce(admin_new_code.label, ''), 80), coalesce(admin_new_code.plan, 'pro'), admin_new_code.days, coalesce(admin_new_code.max_uses, 1),
          case when coalesce(claim_days, 0) > 0 then now() + make_interval(days => claim_days) end, auth.uid());
  return k;
end $$;

create or replace function public.admin_access() returns json
language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then null else json_build_object(
    'codes', (select coalesce(json_agg(json_build_object('code', c.code, 'label', c.label, 'plan', c.plan, 'days', c.days, 'max_uses', c.max_uses,
                'used', (select count(*) from access_grants g where g.code = c.code), 'claim_until', c.claim_until, 'revoked_at', c.revoked_at, 'created_at', c.created_at)
                order by c.created_at desc), '[]'::json) from access_codes c),
    'grants', (select coalesce(json_agg(json_build_object('id', g.id, 'team', t.name, 'owner', u.email, 'code', g.code, 'plan', g.plan,
                'starts_at', g.starts_at, 'ends_at', g.ends_at, 'revoked_at', g.revoked_at) order by g.starts_at desc), '[]'::json)
               from access_grants g join teams t on t.id = g.team_id left join auth.users u on u.id = g.claimed_by)
  ) end;
$$;

-- Take back one team's access (grant), or a whole code (stops new claims and ends every team's access from it).
create or replace function public.admin_revoke_grant(grant_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update access_grants set revoked_at = now() where id = grant_id and revoked_at is null;
end $$;
create or replace function public.admin_revoke_code(code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update access_codes a set revoked_at = now() where a.code = admin_revoke_code.code and a.revoked_at is null;
  update access_grants g set revoked_at = now() where g.code = admin_revoke_code.code and g.revoked_at is null;
end $$;
-- Give more days to one team's access.
create or replace function public.admin_extend_grant(grant_id uuid, days integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if days not between 1 and 366 then raise exception 'Between 1 and 366 days'; end if;
  update access_grants set ends_at = greatest(ends_at, now()) + make_interval(days => admin_extend_grant.days), revoked_at = null where id = grant_id;
end $$;
revoke all on function public.admin_new_code(text, text, integer, integer, integer), public.admin_access(), public.admin_revoke_grant(uuid),
  public.admin_revoke_code(text), public.admin_extend_grant(uuid, integer) from public, anon;
grant execute on function public.admin_new_code(text, text, integer, integer, integer), public.admin_access(), public.admin_revoke_grant(uuid),
  public.admin_revoke_code(text), public.admin_extend_grant(uuid, integer) to authenticated;

-- ---------- my_account: also free access, and whether I am an admin
create or replace function public.my_account() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'team_id', t.id, 'team_name', t.name, 'role', m.role, 'full_name', m.full_name, 'job_title', m.job_title,
    'plan', t.plan, 'chosen_plan', t.chosen_plan, 'trial_ends_at', t.trial_ends_at,
    'active', public.team_active(t.id), 'paid_until', t.paid_until, 'billing_status', t.billing_status,
    'billing_portal', case when m.role = 'owner' then t.billing_portal end,
    'access_until', (public.team_access(t.id)).ends_at, 'access_plan', (public.team_access(t.id)).plan,
    'is_admin', public.is_admin(),
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

-- The extension also hears about free access.
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
  return (select json_build_object('team', t.name, 'email', u.email, 'active', public.team_active(t.id),
    'plan', coalesce((public.team_access(t.id)).plan, t.plan), 'trial_ends_at', t.trial_ends_at, 'paid_until', t.paid_until,
    'access_until', (public.team_access(t.id)).ends_at)
    from teams t, auth.users u where t.id = r.team_id and u.id = r.user_id);
end $$;
revoke all on function public.ext_whoami(text) from public;
grant execute on function public.ext_whoami(text) to anon, authenticated;

notify pgrst, 'reload schema';
