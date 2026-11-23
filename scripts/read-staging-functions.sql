-- scripts/read-staging-functions.sql
-- Run this script in the Supabase STAGING SQL Editor (kestrel-staging).
-- 
-- Query 1: Prints function definitions (pg_get_functiondef)
-- for functions introduced or modified by migrations 070-077.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  case when p.prosecdef then 'SECURITY DEFINER' else 'INVOKER' end as security_mode,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    p.proname in (
      'ensure_direct_campaign',
      'mail_direct_prepare',
      'mail_direct_sent',
      'get_team_credits',
      'use_team_credits',
      'save_team_file'
    )
    or p.proname ilike '%direct%'
    or p.proname ilike '%credit%'
    or p.proname ilike '%file%'
    or p.proname ilike '%media%'
    or p.proname ilike '%outside_bot%'
    or p.proname ilike '%white_label%'
    or p.proname ilike '%automation%'
  )
order by p.proname, arguments;

-- Query 2: Lists RLS policies on key tables from pg_policies.
select
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'team_files',
    'team_automations',
    'team_outside_bots',
    'team_credits',
    'team_credit_ledger',
    'campaigns',
    'campaign_leads',
    'mailboxes'
  )
order by tablename, policyname;
