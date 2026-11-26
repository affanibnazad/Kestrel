-- 078_ai_allowance.sql
-- Monthly Kestrel-paid AI allowance usage counter.
-- One AI action = one ai_runs row with source = 'kestrel', status in ('ok', 'fallback'), task <> 'chat'.
-- Callable by team members for their own team or by is_admin(). Never returns model or provider.

create or replace function public.ai_usage_this_month(p_team_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if p_team_id is null then
    raise exception 'Not allowed';
  end if;

  if not (coalesce(public.is_admin(), false) or public.is_member(p_team_id)) then
    raise exception 'Not allowed';
  end if;

  select count(*)::int into v_count
  from public.ai_runs
  where team_id = p_team_id
    and source = 'kestrel'
    and status in ('ok', 'fallback')
    and task <> 'chat'
    and created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc');

  return coalesce(v_count, 0);
end $$;

revoke all on function public.ai_usage_this_month(uuid) from public, anon;
grant execute on function public.ai_usage_this_month(uuid) to authenticated;

notify pgrst, 'reload schema';
