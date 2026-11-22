-- Kestrel: Find Emails in the App. The App's server reads the team's Hunter.io key (encrypted in Vault) to look up emails.
-- Run once: node scripts/run-sql.mjs supabase/migrations/013_find_emails.sql  (safe to run again)

create or replace function public.source_key_for_server(service text) returns text
language plpgsql stable security definer set search_path = public, vault as $$
declare t uuid; v text;
begin
  if service not in ('hunter') then raise exception 'Not a data source'; end if;
  select m.team_id into t from members m where m.user_id = auth.uid() and m.role in ('owner', 'manager', 'researcher') order by m.joined_at limit 1;
  if t is null then raise exception 'Only people who can change leads can find emails'; end if;
  if not public.team_active(t) then raise exception 'PLAN_NEEDED: Your free trial has ended. Choose a plan to keep finding emails.'; end if;
  select s.decrypted_secret into v from team_keys k join vault.decrypted_secrets s on s.id = k.secret_id where k.team_id = t and k.service = source_key_for_server.service;
  return v;
end $$;
revoke all on function public.source_key_for_server(text) from public, anon;
grant execute on function public.source_key_for_server(text) to authenticated;

notify pgrst, 'reload schema';
