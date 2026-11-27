-- 080_ai_jobs_rate_limit_retries.sql
-- Rate-limit (429) requeues must not consume ai_jobs.attempts.
-- Track rate_limit_retries separately (cap 10) with growing backoff.

alter table public.ai_jobs
  add column if not exists rate_limit_retries integer not null default 0;

create or replace function public.finish_ai_job(
  server_secret text,
  p_job_id uuid,
  p_status text,
  p_error text default null,
  p_retry_after_sec integer default 60,
  p_rate_limited boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.ai_jobs;
  v_next_rl integer;
begin
  if not public.mail_server_ok(server_secret) then
    raise exception 'Not allowed';
  end if;
  if p_status not in ('done', 'error', 'skipped', 'retry') then
    raise exception 'Invalid status';
  end if;

  select * into v_job from public.ai_jobs where id = p_job_id;
  if v_job.id is null or v_job.status <> 'running' then return; end if;

  if p_status = 'retry' and coalesce(p_rate_limited, false) then
    if coalesce(v_job.rate_limit_retries, 0) < 10 then
      v_next_rl := coalesce(v_job.rate_limit_retries, 0) + 1;
      update public.ai_jobs
      set status = 'queued',
          locked_until = null,
          attempts = greatest(0, v_job.attempts - 1),
          rate_limit_retries = v_next_rl,
          run_after = now() + make_interval(secs => least(600, greatest(30, p_retry_after_sec * v_next_rl))),
          last_error = left(nullif(trim(p_error), ''), 300),
          updated_at = now()
      where id = p_job_id
        and status = 'running';
    else
      update public.ai_jobs
      set status = 'error',
          locked_until = null,
          last_error = left(nullif(trim(p_error), ''), 300),
          updated_at = now()
      where id = p_job_id
        and status = 'running';
    end if;
  elsif p_status = 'retry' and v_job.attempts < v_job.max_attempts then
    update public.ai_jobs
    set status = 'queued',
        locked_until = null,
        run_after = now() + make_interval(secs => greatest(30, p_retry_after_sec * v_job.attempts)),
        last_error = left(nullif(trim(p_error), ''), 300),
        updated_at = now()
    where id = p_job_id
      and status = 'running';
  else
    update public.ai_jobs
    set status = case when p_status = 'retry' then 'error' else p_status end,
        locked_until = null,
        last_error = left(nullif(trim(p_error), ''), 300),
        updated_at = now()
    where id = p_job_id
      and status = 'running';
  end if;
end $$;

revoke all on function public.finish_ai_job(text, uuid, text, text, integer, boolean) from public;
grant execute on function public.finish_ai_job(text, uuid, text, text, integer, boolean) to anon, authenticated, service_role;
