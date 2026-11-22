-- Warmup with an outside service (Affan's choice, 13 Nov 2026: a warmup service now, Kestrel's own pool later).
-- Each email account records which service warms it, so the Email accounts page can show it and guide the setup.
-- Run once, after 028: node scripts/run-sql.mjs supabase/migrations/029_warmup_service.sql  (safe to run again; only adds)

alter table public.mailboxes add column if not exists warmup_service text
  check (warmup_service is null or warmup_service in ('lemwarm', 'mailreach', 'warmupinbox', 'warmy', 'trulyinbox', 'instantly', 'smartlead', 'other', 'none'));
grant select (warmup_service) on public.mailboxes to authenticated;

-- Owners and managers set the service for one of their team's email accounts.
create or replace function public.set_mailbox_warmup_service(box_id uuid, service text) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id(true);
begin
  if t is null then raise exception 'Only the owner or a manager can change email accounts'; end if;
  if service is not null and service not in ('lemwarm', 'mailreach', 'warmupinbox', 'warmy', 'trulyinbox', 'instantly', 'smartlead', 'other', 'none') then raise exception 'Unknown warmup service'; end if;
  update mailboxes set warmup_service = service where id = box_id and team_id = t;
  if not found then raise exception 'Email account not found'; end if;
end $$;

revoke all on function public.set_mailbox_warmup_service(uuid, text) from public, anon;
grant execute on function public.set_mailbox_warmup_service(uuid, text) to authenticated;

notify pgrst, 'reload schema';
