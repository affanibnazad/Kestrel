-- Kestrel 043: the warmup lock is removed (Affan, 14 Nov 2026: "remove the warmup system right now, I will do it later").
-- Run once: node scripts/run-sql.mjs supabase/migrations/043_no_warmup_lock.sql  (safe to run again)
--
-- Before: campaigns waited until an email account had a warmup start date at least 14 days old (019, mailbox_warm).
-- Now: every account counts as ready; new accounts still start slowly (5 a day, then 2 more each day, mailbox_limit_today
-- with ramp_up), and the daily limit, bounce auto-pause and blacklist pause stay as they are.
-- The warmup columns and set_mailbox_warmup stay (the slow start switch uses it). To bring the lock back, restore:
--   select m.warmup_override or (m.warmup_started_at is not null and m.warmup_started_at <= current_date - 14);
-- (archived plan: All Outreach Resources/Outreach Engine/kestrel-archive/warmup/README.md)
create or replace function public.mailbox_warm(m mailboxes) returns boolean
language sql stable set search_path = public as $$
  select true;
$$;
revoke all on function public.mailbox_warm(mailboxes) from public, anon, authenticated;

notify pgrst, 'reload schema';
