-- Team size per plan (Pricing: Starter 1 person, Pro up to 3, Agency up to 10; the free trial is Pro, so 3).
-- Before this, a join link let anyone join any team. Now the join link works only while the team has a free seat.
-- If the team is full, the person still gets their own account and free trial (a sign-up never fails), and the
-- sign-up page tells them first so they can ask the owner to upgrade. People already in a team are never removed.
-- Run once, after 035: node scripts/run-sql.mjs supabase/migrations/036_team_seats.sql  (safe to run again)

-- Seats a team may have now: a valid access code's plan, else a paid plan, else the trial (Pro).
create or replace function public.team_seat_limit(t uuid) returns integer
language sql stable security definer set search_path = public as $$
  select case coalesce((public.team_access(t)).plan, case when x.plan in ('starter', 'pro', 'agency') then x.plan end, 'pro')
           when 'starter' then 1 when 'agency' then 10 else 3 end
  from teams x where x.id = t;
$$;
revoke all on function public.team_seat_limit(uuid) from public, anon, authenticated;

-- For the sign-up page (anyone holding the join link): the team's name and whether a seat is free.
create or replace function public.team_join_info(code text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('name', t.name, 'full', (select count(*) from members m where m.team_id = t.id) >= public.team_seat_limit(t.id))
  from teams t where t.join_code = nullif(trim(code), '') limit 1;
$$;
revoke all on function public.team_join_info(text) from public;
grant execute on function public.team_join_info(text) to anon, authenticated;

-- For the Team page: seats used and allowed in my team.
create or replace function public.my_team_seats() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('used', (select count(*) from members m where m.team_id = t), 'limit', public.team_seat_limit(t))
  from (select public.my_team_id(false) as t) s where t is not null;
$$;
revoke all on function public.my_team_seats() from public, anon;
grant execute on function public.my_team_seats() to authenticated;

-- New account (010's function, plus the seat check before joining a team).
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
    -- Lock the team row so two sign-ups with the same link take turns (no race past the seat limit).
    select id into t from teams where join_code = code for update;
    -- A full team: the person gets their own team and trial instead (the sign-up page warned them).
    if t is not null and (select count(*) from members m where m.team_id = t) >= public.team_seat_limit(t) then t := null; end if;
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

notify pgrst, 'reload schema';
