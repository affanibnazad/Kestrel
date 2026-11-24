-- 074_mail_scan_failure.sql
-- Separate inbox reading issues from mailbox sending status.
-- Reading failures increment scan_failures and set scan_error without touching status.
-- Successful scans reset scan_failures = 0 and scan_error = null via mail_scan_ok.

alter table public.mailboxes add column if not exists scan_failures integer not null default 0;
alter table public.mailboxes add column if not exists scan_error text;

grant select (scan_failures, scan_error) on public.mailboxes to authenticated;

create or replace function public.mail_scan_failure(server_secret text, box_id uuid, err text) returns json
language plpgsql security definer set search_path = public as $$
declare m mailboxes;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into m from mailboxes where id = box_id;
  if m.id is null then return json_build_object('ok', false, 'error', 'not found'); end if;

  update mailboxes
  set scan_failures = coalesce(scan_failures, 0) + 1,
      scan_error = left('Can''t read inbox (' || coalesce(nullif(err, ''), 'timeout') || ')', 500)
  where id = box_id;

  return json_build_object('ok', true, 'scan_failures', coalesce(m.scan_failures, 0) + 1);
end $$;

revoke all on function public.mail_scan_failure(text, uuid, text) from public, anon, authenticated;
grant execute on function public.mail_scan_failure(text, uuid, text) to anon, authenticated;

create or replace function public.mail_scan_ok(server_secret text, box_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare m mailboxes;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into m from mailboxes where id = box_id;
  if m.id is null then return json_build_object('ok', false, 'error', 'not found'); end if;

  update mailboxes
  set scan_failures = 0,
      scan_error = null
  where id = box_id;

  return json_build_object('ok', true);
end $$;

revoke all on function public.mail_scan_ok(text, uuid) from public, anon, authenticated;
grant execute on function public.mail_scan_ok(text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- AFTER CHECK: verify columns and functions exist
-- ============================================================================
SELECT
  count(*) AS column_count
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'mailboxes'
  AND column_name IN ('scan_failures', 'scan_error');

SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'mailboxes'
  AND column_name IN ('scan_failures', 'scan_error')
ORDER BY column_name;

SELECT
  count(*) AS function_count
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('mail_scan_failure', 'mail_scan_ok');

SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('mail_scan_failure', 'mail_scan_ok')
ORDER BY routine_name;
