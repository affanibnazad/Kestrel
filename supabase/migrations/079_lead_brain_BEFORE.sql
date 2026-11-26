-- 079_lead_brain_BEFORE.sql — read only pre-flight check.
-- Expect before 079: 0 | 0 | none | none | 0 | 0 | 0 | 0 | 0 | 0
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'ai_jobs') as ai_jobs_table,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'lead_brain_events') as lead_brain_events_table,
  (select coalesce(string_agg(privilege_type, ',' order by privilege_type), 'none') from information_schema.role_table_grants where table_schema = 'public' and table_name = 'ai_jobs' and grantee = 'authenticated') as ai_jobs_grants,
  (select coalesce(string_agg(privilege_type, ',' order by privilege_type), 'none') from information_schema.role_table_grants where table_schema = 'public' and table_name = 'lead_brain_events' and grantee = 'authenticated') as lead_brain_events_grants,
  (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lead_brain_events') as realtime_enabled,
  (select count(*) from information_schema.routines where routine_schema = 'public' and routine_name = 'enqueue_ai_jobs') as enqueue_ai_jobs_fn,
  (select count(*) from information_schema.routines where routine_schema = 'public' and routine_name = 'claim_ai_jobs') as claim_ai_jobs_fn,
  (select count(*) from information_schema.routines where routine_schema = 'public' and routine_name = 'finish_ai_job') as finish_ai_job_fn,
  (select count(*) from information_schema.routines where routine_schema = 'public' and routine_name = 'log_lead_brain_event') as log_lead_brain_event_fn,
  (select count(*) from information_schema.routines where routine_schema = 'public' and routine_name = 'cleanup_ai_jobs_and_events') as cleanup_ai_jobs_and_events_fn;
