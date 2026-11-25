-- 075_ai_runs.sql
-- Kestrel AI Router: central execution log for all AI tasks.
-- Records latency, tokens, cost, status, and truncated error messages.
-- Never records prompts, emails, leads, or API keys.

create table if not exists public.ai_runs (
  id          bigint generated always as identity primary key,
  team_id     uuid not null references public.teams (id) on delete cascade,
  user_id     uuid references auth.users (id) on delete set null,
  task        text not null check (length(task) between 1 and 50),
  provider    text not null check (length(provider) between 1 and 30),
  model       text not null check (length(model) between 1 and 80),
  source      text not null check (source in ('kestrel', 'team_key')),
  attempt     integer not null default 1 check (attempt >= 1),
  ms          integer not null check (ms >= 0),
  tokens_in   integer not null default 0 check (tokens_in >= 0),
  tokens_out  integer not null default 0 check (tokens_out >= 0),
  cost_usd    numeric(10, 6),
  status      text not null check (status in ('ok', 'timeout', 'error', 'fallback', 'skipped')),
  error       text check (error is null or length(error) <= 300),
  created_at  timestamptz not null default now()
);

create index if not exists ai_runs_team_created_idx on public.ai_runs (team_id, created_at desc);

alter table public.ai_runs enable row level security;
revoke all on public.ai_runs from anon, authenticated;

-- Direct inserts from anon or authenticated are strictly forbidden.
-- Inserts must only happen via log_ai_run using the server secret.
drop policy if exists "team owners admins read ai runs" on public.ai_runs;
create policy "team owners admins read ai runs" on public.ai_runs
  for select to authenticated
  using (
    public.is_admin() or exists (
      select 1 from public.members m
      where m.team_id = ai_runs.team_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'manager')
    )
  );

grant select on public.ai_runs to authenticated;

create or replace function public.log_ai_run(
  server_secret text,
  p_team_id     uuid,
  p_user_id     uuid,
  p_task        text,
  p_provider    text,
  p_model       text,
  p_source      text,
  p_attempt     integer,
  p_ms          integer,
  p_tokens_in   integer,
  p_tokens_out  integer,
  p_cost_usd    numeric,
  p_status      text,
  p_error       text
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  if not public.mail_server_ok(server_secret) then
    raise exception 'Not allowed';
  end if;

  insert into public.ai_runs (
    team_id,
    user_id,
    task,
    provider,
    model,
    source,
    attempt,
    ms,
    tokens_in,
    tokens_out,
    cost_usd,
    status,
    error
  ) values (
    p_team_id,
    p_user_id,
    p_task,
    p_provider,
    p_model,
    p_source,
    coalesce(p_attempt, 1),
    greatest(coalesce(p_ms, 0), 0),
    greatest(coalesce(p_tokens_in, 0), 0),
    greatest(coalesce(p_tokens_out, 0), 0),
    p_cost_usd,
    p_status,
    left(nullif(trim(p_error), ''), 300)
  ) returning id into v_id;

  return json_build_object('ok', true, 'id', v_id);
end $$;

revoke all on function public.log_ai_run(text, uuid, uuid, text, text, text, text, integer, integer, integer, integer, numeric, text, text) from public, anon, authenticated;
grant execute on function public.log_ai_run(text, uuid, uuid, text, text, text, text, integer, integer, integer, integer, numeric, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- AFTER CHECK: verify columns and functions exist
-- ============================================================================
SELECT
  count(*) AS column_count
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ai_runs';

SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ai_runs'
ORDER BY ordinal_position;

SELECT
  count(*) AS function_count
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'log_ai_run';

SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'log_ai_run';
