-- Kestrel Assistant: one AI chat that guides people and runs the App for them (like Instantly's and ManyReach's AI).
-- Kestrel pays for it, so each team gets a daily number of messages by plan. This file only counts; the chat itself
-- runs on the server (/api/assistant) with the signed-in person's own permissions.
-- Run once, after 020: node scripts/run-sql.mjs supabase/migrations/021_assistant.sql  (safe to run again; only adds)

create table if not exists public.assistant_usage (
  team_id  uuid not null references public.teams (id) on delete cascade,
  day      date not null default (now() at time zone 'utc')::date,
  messages integer not null default 0,
  primary key (team_id, day)
);
alter table public.assistant_usage enable row level security;
revoke all on public.assistant_usage from anon, authenticated;
grant select on public.assistant_usage to authenticated;
drop policy if exists "team reads assistant usage" on public.assistant_usage;
create policy "team reads assistant usage" on public.assistant_usage for select to authenticated using (public.is_member(team_id));

-- Messages a day by plan: free trial 30, Starter 100, Pro 300, Agency 1000. Free access codes count as their plan.
create or replace function public.assistant_limit(t uuid) returns integer
language sql stable security definer set search_path = public as $$
  select case coalesce(
      (select g.plan from access_grants g where g.team_id = t and g.revoked_at is null and g.ends_at > now() order by g.ends_at desc limit 1),
      (select tm.plan from teams tm where tm.id = t), 'trial')
    when 'agency' then 1000 when 'pro' then 300 when 'starter' then 100 else 30 end;
$$;

-- Takes one message from today's allowance for the caller's team. Refuses when the plan is not active or the day's
-- messages are used up. Returns {ok, used, limit}.
create or replace function public.assistant_take() returns json
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id(false); lim integer; n integer;
begin
  if t is null then raise exception 'ASSISTANT: Join a team first.'; end if;
  if not public.team_active(t) then raise exception 'ASSISTANT: Your free trial has ended. Choose a plan to keep using the Assistant.'; end if;
  lim := public.assistant_limit(t);
  insert into assistant_usage as u (team_id, day, messages) values (t, (now() at time zone 'utc')::date, 1)
    on conflict (team_id, day) do update set messages = u.messages + 1 where u.messages < lim
    returning messages into n;
  if n is null then
    return json_build_object('ok', false, 'used', lim, 'limit', lim);
  end if;
  return json_build_object('ok', true, 'used', n, 'limit', lim);
end $$;

-- Today's use, for the counter under the chat box.
create or replace function public.assistant_today() returns json
language sql stable security definer set search_path = public as $$
  select case when public.my_team_id(false) is null then null else json_build_object(
    'used', coalesce((select messages from assistant_usage where team_id = public.my_team_id(false) and day = (now() at time zone 'utc')::date), 0),
    'limit', public.assistant_limit(public.my_team_id(false))) end;
$$;

revoke all on function public.assistant_limit(uuid), public.assistant_take(), public.assistant_today() from public, anon, authenticated;
grant execute on function public.assistant_take(), public.assistant_today() to authenticated;

notify pgrst, 'reload schema';
