-- scripts/check-lockdown.sql
-- Read-only verification script to run in Supabase SQL Editor.
-- Run BEFORE and AFTER applying 20261123d_live_lockdown.sql to verify changes.

-- 1. Check EXECUTE permission on locked-down functions
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  r.rolname as role_name,
  has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_execute
from pg_proc p
cross join (values ('anon'), ('authenticated'), ('public')) as r(rolname)
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'ensure_direct_campaign',
    'mail_direct_prepare',
    'mail_direct_sent',
    'get_team_credits',
    'use_team_credits',
    'save_team_file'
  )
order by p.proname, arguments, r.rolname;

-- 2. Check table privileges on target tables
select
  t.relname as table_name,
  r.rolname as role_name,
  has_table_privilege(r.rolname, t.oid, 'SELECT') as can_select,
  has_table_privilege(r.rolname, t.oid, 'INSERT') as can_insert,
  has_table_privilege(r.rolname, t.oid, 'UPDATE') as can_update,
  has_table_privilege(r.rolname, t.oid, 'DELETE') as can_delete
from pg_class t
cross join (values ('anon'), ('authenticated')) as r(rolname)
where t.relnamespace = 'public'::regnamespace
  and t.relname in ('team_files', 'team_automations', 'team_outside_bots')
order by t.relname, r.rolname;
