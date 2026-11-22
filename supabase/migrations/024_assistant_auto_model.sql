-- Kestrel Assistant: "auto" model choice. Auto = Claude Sonnet 5.5 for normal questions, Claude Opus 5.5 for big tasks
-- (plans, comparisons, reviews, long or many-step requests). The App's server picks per message (src/lib/ai-models.ts).
-- Fixed models (Opus, Sonnet, Haiku) stay available in Owner → Assistant.
-- Run once, after 023: node scripts/run-sql.mjs supabase/migrations/024_assistant_auto_model.sql  (safe to run again)

-- Allow 'auto' and make it the default.
alter table public.assistant_settings drop constraint if exists assistant_settings_model_check;
alter table public.assistant_settings add constraint assistant_settings_model_check
  check (model in ('auto', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'));
alter table public.assistant_settings alter column model set default 'auto';

-- The single settings row still has the old default (nobody has saved a choice yet): move it to auto.
-- A model an admin chose (updated_by set) is never changed.
update public.assistant_settings set model = 'auto'
  where id and model = 'claude-opus-5-5' and updated_by is null;

-- set_assistant_options: same as 023, plus a clear message for an unknown model (the check constraint also guards it).
create or replace function public.set_assistant_options(model text, enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only Kestrel admins can change the Assistant'; end if;
  if set_assistant_options.model not in ('auto', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5') then
    raise exception 'Unknown model';
  end if;
  update assistant_settings s set model = set_assistant_options.model, enabled = set_assistant_options.enabled, updated_at = now(), updated_by = auth.uid() where s.id;
end $$;
revoke all on function public.set_assistant_options(text, boolean) from public, anon;
grant execute on function public.set_assistant_options(text, boolean) to authenticated;

notify pgrst, 'reload schema';
