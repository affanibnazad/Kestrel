-- Kestrel 066: keep only 2 days of scheduled-job history (19 Nov 2026). The mail and placement jobs run every minute,
-- and pg_cron keeps a row for every run forever: 18,800 rows / 30 MB, half of the whole database. Deletes old run
-- history only (never Kestrel data), once a day at 03:17.
-- Run once: node scripts/run-sql.mjs supabase/migrations/066_cron_history_trim.sql  (safe to run again)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'kestrel-cron-history-trim') then perform cron.unschedule('kestrel-cron-history-trim'); end if;
    perform cron.schedule('kestrel-cron-history-trim', '17 3 * * *',
      $job$ delete from cron.job_run_details where end_time < now() - interval '2 days' $job$);
    delete from cron.job_run_details where end_time < now() - interval '2 days';
  end if;
end $$;
