-- Kestrel: why is the database slow? READ ONLY: changes nothing, shows no lead details (19 Nov 2026).
-- Run: node scripts/run-sql.mjs scripts/diag-slow.sql
with
busy as (
  select 'busy query' as what,
         round(extract(epoch from now() - query_start))::text || 's ' || coalesce(state, '') || ' ' || coalesce(wait_event_type || ':' || wait_event, '') as value,
         left(regexp_replace(query, '\s+', ' ', 'g'), 160) as detail
    from pg_stat_activity
   where pid <> pg_backend_pid() and state <> 'idle' and query_start < now() - interval '2 seconds'
   order by query_start limit 15),
conns as (
  select 'connections' as what, count(*)::text || ' ' || coalesce(state, 'none') as value, coalesce(usename, '') as detail
    from pg_stat_activity group by state, usename),
sizes as (
  select 'big table' as what, pg_size_pretty(pg_total_relation_size(c.oid)) as value, n.nspname || '.' || c.relname as detail
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'r' order by pg_total_relation_size(c.oid) desc limit 10),
jobs as (
  select 'cron last hour' as what,
         count(*)::text || ' runs, ' || count(*) filter (where status <> 'succeeded')::text || ' failed, avg ' ||
         coalesce(round(avg(extract(epoch from end_time - start_time))::numeric, 1)::text, '?') || 's, max ' ||
         coalesce(round(max(extract(epoch from end_time - start_time))::numeric, 1)::text, '?') || 's' as value,
         j.jobname as detail
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
   where d.start_time > now() - interval '1 hour' group by j.jobname),
rows as (
  select 'rows' as what, (select count(*) from cron.job_run_details)::text as value, 'cron.job_run_details' as detail
  union all select 'rows', (select count(*) from net._http_response)::text, 'net._http_response'
  union all select 'rows', (select count(*) from public.leads)::text, 'public.leads (all teams)'
  union all select 'database size', pg_size_pretty(pg_database_size(current_database())), current_database())
select * from busy union all select * from conns union all select * from jobs union all select * from rows union all select * from sizes;
