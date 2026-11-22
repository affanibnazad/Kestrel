-- Kestrel accounts: teams, members, plans and a 7-day free trial.
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to run once.
--
-- How it works
--   * Anyone can sign up. A new person gets their own team (they are its owner) on a 7-day trial.
--   * A person who signs up with a team's join link joins that team instead (role: researcher).
--   * Every table has row-level security: people only ever see their own team.
--   * The owner picks a plan (Starter, Pro, Agency). Card payments are added later; until then the
--     choice is stored and the trial runs out after 7 days.

create table if not exists public.teams (
  id            uuid primary key default gen_random_uuid(),
  name          text not null default 'My team',
  plan          text not null default 'trial' check (plan in ('trial', 'starter', 'pro', 'agency')),
  chosen_plan   text check (chosen_plan in ('starter', 'pro', 'agency')),
  trial_ends_at timestamptz not null default (now() + interval '7 days'),
  join_code     text not null unique default encode(extensions.gen_random_bytes(9), 'hex'),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists public.members (
  team_id    uuid not null references public.teams (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'researcher' check (role in ('owner', 'manager', 'researcher', 'viewer')),
  full_name  text,
  email      text,
  accepted_terms_at timestamptz,
  joined_at  timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index if not exists members_user_idx on public.members (user_id);

alter table public.teams enable row level security;
alter table public.members enable row level security;

-- Is the signed-in person in this team? (security definer so policies don't loop)
create or replace function public.is_member(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where team_id = t and user_id = auth.uid());
$$;

drop policy if exists "members see their team" on public.teams;
create policy "members see their team" on public.teams for select to authenticated using (public.is_member(id));
drop policy if exists "members see teammates" on public.members;
create policy "members see teammates" on public.members for select to authenticated using (public.is_member(team_id));
-- No insert/update/delete from the browser: changes go through the functions below.

-- New account: join a team by code, or create a new team on a 7-day trial.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  code   text := nullif(trim(new.raw_user_meta_data ->> 'join_code'), '');
  person text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));
  firm   text := nullif(trim(new.raw_user_meta_data ->> 'company'), '');
  terms  timestamptz := nullif(new.raw_user_meta_data ->> 'accepted_terms_at', '')::timestamptz;
  t      uuid;
begin
  if code is not null then
    select id into t from teams where join_code = code;
  end if;
  if t is not null then
    insert into members (team_id, user_id, role, full_name, email, accepted_terms_at)
    values (t, new.id, 'researcher', person, new.email, terms) on conflict do nothing;
  else
    insert into teams (name, created_by) values (coalesce(firm, person || '''s team'), new.id) returning id into t;
    insert into members (team_id, user_id, role, full_name, email, accepted_terms_at)
    values (t, new.id, 'owner', person, new.email, terms);
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- People who signed up before this file ran (for example the owner) get their own team now.
insert into public.teams (name, created_by)
select coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)) || '''s team', u.id
from auth.users u where not exists (select 1 from public.members m where m.user_id = u.id);
insert into public.members (team_id, user_id, role, full_name, email)
select t.id, t.created_by, 'owner', split_part(u.email, '@', 1), u.email
from public.teams t join auth.users u on u.id = t.created_by
where not exists (select 1 from public.members m where m.user_id = t.created_by);

-- Everything the App needs about the signed-in person's team, in one call.
create or replace function public.my_account() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'team_id', t.id, 'team_name', t.name, 'role', m.role, 'full_name', m.full_name,
    'plan', t.plan, 'chosen_plan', t.chosen_plan, 'trial_ends_at', t.trial_ends_at,
    'join_code', case when m.role in ('owner', 'manager') then t.join_code end,
    'members', (select json_agg(json_build_object('name', x.full_name, 'email', x.email, 'role', x.role, 'joined_at', x.joined_at) order by x.joined_at)
                from members x where x.team_id = t.id)
  )
  from members m join teams t on t.id = m.team_id
  where m.user_id = auth.uid()
  order by m.joined_at limit 1;
$$;

-- Owner picks a plan. Payment is added later; for now the choice is saved.
create or replace function public.choose_plan(p text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p not in ('starter', 'pro', 'agency') then raise exception 'Unknown plan'; end if;
  update teams set chosen_plan = p
  where id = (select team_id from members where user_id = auth.uid() and role = 'owner' order by joined_at limit 1);
  if not found then raise exception 'Only the team owner can choose the plan'; end if;
end $$;

-- Owner or manager makes a new join link (the old one stops working).
create or replace function public.new_join_code() returns text
language plpgsql security definer set search_path = public as $$
declare c text := encode(extensions.gen_random_bytes(9), 'hex');
begin
  update teams set join_code = c
  where id = (select team_id from members where user_id = auth.uid() and role in ('owner', 'manager') order by joined_at limit 1);
  if not found then raise exception 'Only the owner or a manager can do this'; end if;
  return c;
end $$;

revoke all on function public.my_account(), public.choose_plan(text), public.new_join_code(), public.is_member(uuid) from public, anon;
grant execute on function public.my_account(), public.choose_plan(text), public.new_join_code(), public.is_member(uuid) to authenticated;

-- The Sign up page shows which team a join link belongs to (name only, needs the exact random code).
create or replace function public.team_for_code(code text) returns text
language sql stable security definer set search_path = public as $$
  select name from teams where join_code = code limit 1;
$$;
revoke all on function public.team_for_code(text) from public;
grant execute on function public.team_for_code(text) to anon, authenticated;
