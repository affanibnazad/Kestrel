-- Kestrel: the team's Do-not-contact list (emails and whole domains), shared by the App and every connected extension.
-- Leads that match are never exported, never get AI emails, and are marked in the App.
-- Run once: node scripts/run-sql.mjs supabase/migrations/011_do_not_contact.sql  (safe to run again)

create table if not exists public.do_not_contact (
  team_id    uuid not null references public.teams (id) on delete cascade,
  entry      text not null check (length(entry) between 3 and 254 and entry = lower(entry) and entry !~ '\s'),
  reason     text check (length(reason) <= 200),
  added_by   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (team_id, entry)
);
alter table public.do_not_contact enable row level security;
revoke all on public.do_not_contact from anon, authenticated;

-- Everyone in the team can read the list. People who can change leads can add and remove entries.
-- Adding stays possible after the trial ends: saying "do not contact" must always work.
create or replace function public.can_block(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where team_id = t and user_id = auth.uid() and role in ('owner', 'manager', 'researcher'));
$$;
revoke all on function public.can_block(uuid) from public, anon;
grant execute on function public.can_block(uuid) to authenticated;

drop policy if exists "team reads dnc" on public.do_not_contact;
create policy "team reads dnc" on public.do_not_contact for select to authenticated using (public.is_member(team_id));
drop policy if exists "team adds dnc" on public.do_not_contact;
create policy "team adds dnc" on public.do_not_contact for insert to authenticated
  with check (public.can_block(team_id) and (added_by is null or added_by = auth.uid()));
drop policy if exists "team removes dnc" on public.do_not_contact;
create policy "team removes dnc" on public.do_not_contact for delete to authenticated using (public.can_edit(team_id));
grant select, insert, delete on public.do_not_contact to authenticated;

-- For a connected extension: send its own entries (added, never removed), and get the whole team list back.
-- Works after the trial too, so a "no" is never lost.
create or replace function public.ext_sync_dnc(k text, rows json) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare r extension_keys;
begin
  -- Same key check as ext_owner, but without the plan check.
  select * into r from extension_keys where key_hash = encode(extensions.digest(coalesce(k, ''), 'sha256'), 'hex');
  if r.id is null then raise exception 'This connection key is not valid any more. Connect the extension again from the App.'; end if;
  if not exists (select 1 from members where team_id = r.team_id and user_id = r.user_id and role <> 'viewer') then
    raise exception 'This account can no longer change the team.';
  end if;
  update extension_keys set last_used_at = now() where id = r.id;
  insert into do_not_contact (team_id, entry, reason)
  select r.team_id, lower(trim(x->>'entry')), left(nullif(trim(x->>'reason'), ''), 200)
  from json_array_elements(coalesce(rows, '[]'::json)) x
  where lower(trim(x->>'entry')) ~ '^([^@\s]+@)?[a-z0-9.-]+\.[a-z]{2,}$' and length(trim(x->>'entry')) <= 254
  limit 5000
  on conflict do nothing;
  return coalesce((select json_agg(json_build_object('entry', entry, 'reason', reason, 'at', created_at)) from do_not_contact where team_id = r.team_id), '[]'::json);
end $$;
revoke all on function public.ext_sync_dnc(text, json) from public;
grant execute on function public.ext_sync_dnc(text, json) to anon, authenticated;

notify pgrst, 'reload schema';
