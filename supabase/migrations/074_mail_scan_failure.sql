-- 074_mail_scan_failure.sql
-- When an inbox cannot be read (IMAP socket timeout / connection refused) 3 times in a row,
-- mark the mailbox with status = 'error' and last_error = 'Problem: can''t read inbox (<error>)'.
create or replace function public.mail_scan_failure(server_secret text, box_id uuid, err text) returns json
language plpgsql security definer set search_path = public as $$
declare m mailboxes;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into m from mailboxes where id = box_id;
  if m.id is null then return json_build_object('ok', false, 'error', 'not found'); end if;

  update mailboxes
  set status = case when status = 'paused' then 'paused' else 'error' end,
      imap_ok = false,
      last_error = left('Problem: can''t read inbox (' || coalesce(nullif(err, ''), 'timeout') || ')', 500)
  where id = box_id;

  return json_build_object('ok', true, 'status', 'error');
end $$;

revoke all on function public.mail_scan_failure(text, uuid, text) from public, anon, authenticated;
grant execute on function public.mail_scan_failure(text, uuid, text) to anon, authenticated;
