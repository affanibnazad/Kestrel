-- scripts/read-staging-functions.sql
-- Run this script in the Supabase STAGING SQL Editor (kestrel-staging).
-- It reads and prints the complete function definition (pg_get_functiondef)
-- for all functions introduced or modified by migrations 070-077:
--   070/074: Direct Send, sending limits, mailbox checks
--   071/077: Team Credits, credit ledger, server deduction
--   072/076: Team Files, file management, deletion security
--   073/075: Automations, Outside Bots (Discord/Telegram), White-label RPCs

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
    -- Specific 070-073 known function names
    p.proname in (
      'ensure_direct_campaign',
      'mail_direct_prepare',
      'mail_direct_sent',
      'get_team_credits',
      'use_team_credits',
      'save_team_file'
    )
    -- Or any function matching 074-077 security-fix patterns
    or p.proname ilike '%direct%'
    or p.proname ilike '%credit%'
    or p.proname ilike '%file%'
    or p.proname ilike '%media%'
    or p.proname ilike '%outside_bot%'
    or p.proname ilike '%white_label%'
    or p.proname ilike '%automation%'
  )
order by p.proname, arguments;
