-- Kestrel: which queries take the database's time? READ ONLY (19 Nov 2026). Shows query shapes ($1 placeholders), no lead details.
-- Run: node scripts/run-sql.mjs scripts/diag-slow2.sql --full
select round(total_exec_time)::text || ' ms total' as total, calls::text || ' calls' as calls, round(mean_exec_time)::text || ' ms each' as mean,
       r.rolname as who, left(regexp_replace(query, '\s+', ' ', 'g'), 220) as query
  from extensions.pg_stat_statements s join pg_roles r on r.oid = s.userid
 order by total_exec_time desc limit 25;
