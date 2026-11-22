-- Kestrel 062: AI activity log hardening (security review of 061, 19 Nov 2026).
-- The App records each confirmed AI action itself, so the database now decides the parts a person must not choose:
-- who wrote the row (always the signed-in person) and when (always now). Only people who can change leads (not
-- viewers) may add rows, and still nobody can edit or delete one. Rows written by Kestrel's own server (the bots, from
-- Phase 4) come through a server-secret function instead and are marked by='server'.
-- Run once: node scripts/run-sql.mjs supabase/migrations/062_ai_activity_harden.sql  (safe to run again)

alter table public.ai_activity add column if not exists by text not null default 'app' check (by in ('app', 'server'));

-- Runs with the writer's own rights (not security definer), so current_user tells a signed-in person from the server.
create or replace function public.ai_activity_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.user_id := auth.uid();
    new.created_at := now();
    new.by := 'app';
  end if;
  return new;
end $$;
drop trigger if exists ai_activity_stamp on public.ai_activity;
create trigger ai_activity_stamp before insert on public.ai_activity for each row execute function public.ai_activity_stamp();

drop policy if exists "member adds own ai activity" on public.ai_activity;
create policy "member adds own ai activity" on public.ai_activity for insert to authenticated
  with check (public.can_edit(team_id) and user_id = auth.uid());

notify pgrst, 'reload schema';
