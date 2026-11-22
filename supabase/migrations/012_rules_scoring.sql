-- Kestrel: the team's Rules and scoring (score weights, tier cut-offs, custom rules, collection filters).
-- Set in the App, used by the App's Rescore and by every connected extension (which keeps any change typed in it).
-- Run once: node scripts/run-sql.mjs supabase/migrations/012_rules_scoring.sql  (safe to run again)

create table if not exists public.team_rules (
  team_id    uuid primary key references public.teams (id) on delete cascade,
  weights    jsonb not null default '{}'::jsonb check (jsonb_typeof(weights) = 'object'),
  tiers      jsonb not null default '{}'::jsonb check (jsonb_typeof(tiers) = 'object'),
  rules      jsonb not null default '[]'::jsonb check (jsonb_typeof(rules) = 'array' and jsonb_array_length(rules) <= 200),
  refine     jsonb not null default '{}'::jsonb check (jsonb_typeof(refine) = 'object'),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.team_rules enable row level security;
revoke all on public.team_rules from anon, authenticated;

drop policy if exists "team reads rules" on public.team_rules;
create policy "team reads rules" on public.team_rules for select to authenticated using (public.is_member(team_id));
drop policy if exists "team adds rules" on public.team_rules;
create policy "team adds rules" on public.team_rules for insert to authenticated with check (public.can_edit(team_id));
drop policy if exists "team changes rules" on public.team_rules;
create policy "team changes rules" on public.team_rules for update to authenticated using (public.can_edit(team_id)) with check (public.can_edit(team_id));
grant select, insert, update on public.team_rules to authenticated;

-- Rescore in the App: save new scores and tiers for many leads at once (only this team's leads, only people who can edit).
create or replace function public.set_scores(rows jsonb) returns integer
language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  update leads l set score = (x->>'score')::int, tier = x->>'tier',
         data = jsonb_set(jsonb_set(coalesce(l.data, '{}'::jsonb), '{score}', to_jsonb((x->>'score')::int)), '{tier}', to_jsonb(x->>'tier'))
  from jsonb_array_elements(coalesce(rows, '[]'::jsonb)) x
  where l.id = (x->>'id')::uuid and (x->>'score') ~ '^\d{1,3}$' and (x->>'tier') in ('A', 'B', 'C');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.set_scores(jsonb) from public, anon;
grant execute on function public.set_scores(jsonb) to authenticated;

-- For a connected extension: the team's rules (or null when the team has not set any).
create or replace function public.ext_team_rules(k text) returns json
language plpgsql security definer set search_path = public as $$
declare r extension_keys;
begin
  r := ext_owner(k);
  return (select json_build_object('weights', weights, 'tiers', tiers, 'rules', rules, 'refine', refine, 'at', updated_at) from team_rules where team_id = r.team_id);
end $$;
revoke all on function public.ext_team_rules(text) from public;
grant execute on function public.ext_team_rules(text) to anon, authenticated;

notify pgrst, 'reload schema';
