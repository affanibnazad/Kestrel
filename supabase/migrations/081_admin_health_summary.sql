-- Admin health tab: SQL sum/count for AI runs (no 1,000-row cap) and AI jobs queue counts.
create or replace function public.admin_health_ai(days integer default 30) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  since30d timestamptz;
  since24h timestamptz;
  ai_json json;
  jobs_json json := null;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can see health'; end if;
  since30d := now() - make_interval(days => greatest(1, least(coalesce(days, 30), 365)));
  since24h := now() - interval '24 hours';

  select json_build_object(
    'runs24h', count(*) filter (where created_at >= since24h),
    'ok24h', count(*) filter (where created_at >= since24h and status in ('ok', 'fallback')),
    'errors24h', count(*) filter (where created_at >= since24h and status in ('error', 'timeout')),
    'cost24h', round(coalesce(sum(cost_usd) filter (where created_at >= since24h), 0)::numeric, 4),
    'runs30d', count(*),
    'cost30d', round(coalesce(sum(cost_usd), 0)::numeric, 4),
    'recentErrors', coalesce((
      select json_agg(e) from (
        select id, task, slot, source, status, left(error, 140) as error, created_at
        from ai_runs
        where created_at >= since30d and status in ('error', 'timeout')
        order by created_at desc
        limit 15
      ) e
    ), '[]'::json)
  ) into ai_json
  from ai_runs
  where created_at >= since30d;

  if to_regclass('public.ai_jobs') is not null then
    execute $q$
      select json_build_object(
        'queued', count(*) filter (where status = 'queued'),
        'running', count(*) filter (where status = 'running'),
        'done', count(*) filter (where status = 'done'),
        'error', count(*) filter (where status = 'error'),
        'skipped', count(*) filter (where status = 'skipped')
      ) from ai_jobs
    $q$ into jobs_json;
  end if;

  return json_build_object('ai', ai_json, 'jobs', jobs_json);
end $$;

revoke all on function public.admin_health_ai(integer) from public, anon;
grant execute on function public.admin_health_ai(integer) to authenticated;
