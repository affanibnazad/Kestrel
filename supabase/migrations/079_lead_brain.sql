-- 079_lead_brain.sql
-- AI-4b: Background job queue (ai_jobs) + Lead Brain Realtime event stream (lead_brain_events).
--
-- TODO (depends on 078_ai_allowance.sql):
-- Once 078_ai_allowance.sql is applied, add a server_secret overload for ai_usage_this_month(server_secret text, p_team_id uuid)
-- gated by mail_server_ok(server_secret) so /api/mail/tick (which has no auth.uid()) can check AI-4a allowance.

begin;

-- 1. Job queue for background AI & lead collection work
create table if not exists public.ai_jobs (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  user_id       uuid references auth.users (id) on delete set null,
  lead_id       uuid references public.leads (id) on delete cascade,
  offer_id      uuid references public.offer_profiles (id) on delete set null,
  sequence_id   uuid references public.sequences (id) on delete set null,
  kind          text not null check (kind in ('find_emails', 'research', 'score', 'write', 'qc')),
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'error', 'skipped')),
  attempts      integer not null default 0 check (attempts >= 0),
  max_attempts  integer not null default 3 check (max_attempts >= 1),
  run_after     timestamptz not null default now(),
  locked_until  timestamptz,
  payload       jsonb not null default '{}'::jsonb,
  last_error    text check (last_error is null or length(last_error) <= 300),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Fast queue claim: queued or expired-lease jobs due now
create index if not exists ai_jobs_claim_idx
  on public.ai_jobs (status, run_after, created_at)
  where status in ('queued', 'running');

-- Team progress & deduplication
create index if not exists ai_jobs_team_status_idx
  on public.ai_jobs (team_id, status, created_at desc);

create unique index if not exists ai_jobs_active_lead_kind_uidx
  on public.ai_jobs (team_id, lead_id, kind)
  where lead_id is not null and status in ('queued', 'running');

alter table public.ai_jobs enable row level security;
revoke all on public.ai_jobs from anon, authenticated;

drop policy if exists "team members read ai_jobs" on public.ai_jobs;
create policy "team members read ai_jobs" on public.ai_jobs
  for select to authenticated
  using (public.is_member(team_id) or coalesce(public.is_admin(), false));

-- No direct client insert on ai_jobs; all enqueues go through enqueue_ai_jobs()
grant select on public.ai_jobs to authenticated;

-- 2. Lead Brain live events (matches PR 8 LeadBrainView.tsx)
create table if not exists public.lead_brain_events (
  id          bigint generated always as identity primary key,
  team_id     uuid not null references public.teams (id) on delete cascade,
  lead_id     uuid references public.leads (id) on delete cascade,
  job_id      uuid references public.ai_jobs (id) on delete set null,
  agent       text not null check (length(agent) between 1 and 40),
  from_agent  text check (from_agent is null or length(from_agent) between 1 and 40),
  status      text not null check (status in ('started', 'ok', 'error', 'skipped')),
  ms          integer not null default 0 check (ms >= 0),
  ai_run_id   bigint references public.ai_runs (id) on delete set null,
  summary     text not null default '' check (length(summary) <= 200),
  created_at  timestamptz not null default now()
);

create index if not exists lead_brain_events_team_created_idx
  on public.lead_brain_events (team_id, created_at desc);

alter table public.lead_brain_events enable row level security;
revoke all on public.lead_brain_events from anon, authenticated;

-- Team members only see their own team's events; never model/provider names
drop policy if exists "team members read lead_brain_events" on public.lead_brain_events;
create policy "team members read lead_brain_events" on public.lead_brain_events
  for select to authenticated
  using (public.is_member(team_id) or coalesce(public.is_admin(), false));

grant select on public.lead_brain_events to authenticated;

-- Enable Supabase Realtime for Lead Brain
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'lead_brain_events'
  ) then
    alter publication supabase_realtime add table public.lead_brain_events;
  end if;
end $$;

-- 3. Authenticated enqueue RPC (checks can_edit + verifies all leads belong to p_team_id)
create or replace function public.enqueue_ai_jobs(
  p_team_id uuid,
  p_lead_ids uuid[],
  p_kind text,
  p_offer_id uuid default null,
  p_sequence_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_valid_count integer := 0;
begin
  if p_team_id is null or not public.can_edit(p_team_id) then
    raise exception 'Not allowed';
  end if;
  if p_kind not in ('find_emails', 'research', 'score', 'write', 'qc') then
    raise exception 'Invalid job kind';
  end if;
  if p_lead_ids is null or array_length(p_lead_ids, 1) is null then
    return 0;
  end if;

  -- Verify every lead_id belongs to p_team_id
  select count(*) into v_valid_count
  from public.leads l
  where l.id = any(p_lead_ids) and l.team_id = p_team_id;

  if v_valid_count <> (select count(distinct x) from unnest(p_lead_ids) as x) then
    raise exception 'Not allowed: lead does not belong to team';
  end if;

  insert into public.ai_jobs (team_id, user_id, lead_id, offer_id, sequence_id, kind)
  select distinct p_team_id, auth.uid(), l.id, p_offer_id, p_sequence_id, p_kind
  from public.leads l
  where l.id = any(p_lead_ids) and l.team_id = p_team_id
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.enqueue_ai_jobs(uuid, uuid[], text, uuid, uuid) from public, anon;
grant execute on function public.enqueue_ai_jobs(uuid, uuid[], text, uuid, uuid) to authenticated;

-- 4. Server-only RPCs gated by mail_server_ok(server_secret)
create or replace function public.claim_ai_jobs(server_secret text, max_n integer default 2)
returns setof public.ai_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.mail_server_ok(server_secret) then
    raise exception 'Not allowed';
  end if;

  -- Mark expired-lease jobs that already hit max_attempts as error
  update public.ai_jobs
  set status = 'error',
      locked_until = null,
      last_error = coalesce(last_error, 'Max attempts reached after lease expiry'),
      updated_at = now()
  where status = 'running'
    and locked_until < now()
    and attempts >= max_attempts;

  return query
  with picked as (
    select j.id
    from public.ai_jobs j
    where j.attempts < j.max_attempts
      and (
        (j.status = 'queued' and j.run_after <= now())
        or (j.status = 'running' and j.locked_until < now())
      )
      and public.team_active(j.team_id)
    order by j.run_after asc, j.created_at asc
    limit greatest(1, least(max_n, 4))
    for update skip locked
  )
  update public.ai_jobs j
  set status = 'running',
      attempts = j.attempts + 1,
      locked_until = now() + interval '90 seconds',
      updated_at = now()
  from picked
  where j.id = picked.id
  returning j.*;
end $$;

create or replace function public.finish_ai_job(
  server_secret text,
  p_job_id uuid,
  p_status text,
  p_error text default null,
  p_retry_after_sec integer default 60
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.ai_jobs;
begin
  if not public.mail_server_ok(server_secret) then
    raise exception 'Not allowed';
  end if;

  select * into v_job from public.ai_jobs where id = p_job_id;
  if v_job.id is null then return; end if;

  if p_status = 'retry' and v_job.attempts < v_job.max_attempts then
    update public.ai_jobs
    set status = 'queued',
        locked_until = null,
        run_after = now() + make_interval(secs => greatest(30, p_retry_after_sec * v_job.attempts)),
        last_error = left(nullif(trim(p_error), ''), 300),
        updated_at = now()
    where id = p_job_id;
  else
    update public.ai_jobs
    set status = case when p_status = 'retry' then 'error' else p_status end,
        locked_until = null,
        last_error = left(nullif(trim(p_error), ''), 300),
        updated_at = now()
    where id = p_job_id;
  end if;
end $$;

create or replace function public.log_lead_brain_event(
  server_secret text,
  p_team_id uuid,
  p_lead_id uuid,
  p_job_id uuid,
  p_agent text,
  p_from_agent text,
  p_status text,
  p_ms integer,
  p_ai_run_id bigint,
  p_summary text
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if not public.mail_server_ok(server_secret) then
    raise exception 'Not allowed';
  end if;

  insert into public.lead_brain_events (
    team_id, lead_id, job_id, agent, from_agent, status, ms, ai_run_id, summary
  ) values (
    p_team_id, p_lead_id, p_job_id, p_agent, p_from_agent, p_status,
    greatest(coalesce(p_ms, 0), 0), p_ai_run_id, left(coalesce(p_summary, ''), 200)
  ) returning id into v_id;

  return v_id;
end $$;

create or replace function public.cleanup_ai_jobs_and_events(server_secret text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.mail_server_ok(server_secret) then
    raise exception 'Not allowed';
  end if;

  delete from public.lead_brain_events
  where created_at < now() - interval '30 days';

  delete from public.ai_jobs
  where status in ('done', 'skipped')
    and updated_at < now() - interval '7 days';
end $$;

revoke all on function public.claim_ai_jobs(text, integer),
  public.finish_ai_job(text, uuid, text, text, integer),
  public.log_lead_brain_event(text, uuid, uuid, uuid, text, text, text, integer, bigint, text),
  public.cleanup_ai_jobs_and_events(text)
  from public, anon, authenticated;

grant execute on function public.claim_ai_jobs(text, integer),
  public.finish_ai_job(text, uuid, text, text, integer),
  public.log_lead_brain_event(text, uuid, uuid, uuid, text, text, text, integer, bigint, text),
  public.cleanup_ai_jobs_and_events(text)
  to anon, authenticated;

notify pgrst, 'reload schema';
commit;
