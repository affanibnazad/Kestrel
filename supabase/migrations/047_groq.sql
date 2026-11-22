-- Kestrel 047: Groq as an AI company, for teams (Connections → their own key, used by Score and write and the Assistant
-- with their own key) and for Kestrel (Owner → Assistant: Kestrel's own Groq key for the included Assistant).
-- Groq speaks the OpenAI chat format at https://api.groq.com/openai/v1; its keys start with gsk_.
-- Run once: node scripts/run-sql.mjs supabase/migrations/047_groq.sql  (safe to run again; only widens the allowed lists)

-- ---------- 1. the lists of allowed AI companies in tables (old checks found by their text, so their names do not matter)
do $$
declare r record;
begin
  for r in select c.conrelid::regclass as tbl, c.conname from pg_constraint c
           where c.contype = 'c' and c.conrelid in ('public.team_ai'::regclass, 'public.assistant_settings'::regclass,
             'public.assistant_kestrel_keys'::regclass, 'public.assistant_prefs'::regclass, 'public.team_keys'::regclass)
             and pg_get_constraintdef(c.oid) ilike '%openrouter%' and pg_get_constraintdef(c.oid) not ilike '%groq%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;
alter table public.team_ai drop constraint if exists team_ai_provider_ok;
alter table public.team_ai add constraint team_ai_provider_ok check (provider in ('anthropic', 'openai', 'gemini', 'openrouter', 'groq'));
alter table public.assistant_settings drop constraint if exists assistant_settings_provider_ok;
alter table public.assistant_settings add constraint assistant_settings_provider_ok check (provider in ('anthropic', 'openai', 'gemini', 'openrouter', 'groq'));
alter table public.assistant_kestrel_keys drop constraint if exists assistant_kestrel_keys_provider_ok;
alter table public.assistant_kestrel_keys add constraint assistant_kestrel_keys_provider_ok check (provider in ('openai', 'gemini', 'openrouter', 'groq'));
alter table public.assistant_prefs drop constraint if exists assistant_prefs_provider_ok;
alter table public.assistant_prefs add constraint assistant_prefs_provider_ok check (provider is null or provider in ('anthropic', 'openai', 'gemini', 'openrouter', 'groq'));
alter table public.team_keys drop constraint if exists team_keys_service_check;
alter table public.team_keys add constraint team_keys_service_check
  check (service in ('companiesHouse', 'hunter', 'listenNotes', 'anthropic', 'openai', 'gemini', 'openrouter', 'groq', 'hubspot', 'pipedrive', 'apollo', 'findymail'));

-- ---------- 2. the functions that check the company name (latest versions: 039, 027, 037, 034), with groq added
create or replace function public.ai_key_for_server(server_secret text, service text) returns text
language plpgsql stable security definer set search_path = public, vault as $$
declare t uuid; v text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  if service not in ('anthropic', 'openai', 'gemini', 'openrouter', 'groq') then raise exception 'Not an AI service'; end if;
  select m.team_id into t from members m where m.user_id = auth.uid() and m.role in ('owner', 'manager', 'researcher') order by m.joined_at limit 1;
  if t is null then raise exception 'Only people who can change leads can use AI'; end if;
  if not public.team_active(t) then raise exception 'PLAN_NEEDED: Your free trial has ended. Choose a plan to keep using AI.'; end if;
  select s.decrypted_secret into v from team_keys k join vault.decrypted_secrets s on s.id = k.secret_id where k.team_id = t and k.service = ai_key_for_server.service;
  return v;
end $$;
revoke all on function public.ai_key_for_server(text, text) from public, anon;
grant execute on function public.ai_key_for_server(text, text) to authenticated;

create or replace function public.assistant_team_key(server_secret text, service text) returns text
language plpgsql stable security definer set search_path = public, vault as $$
declare t uuid; v text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  if service not in ('anthropic', 'openai', 'gemini', 'openrouter', 'groq') then raise exception 'Not an AI service'; end if;
  select m.team_id into t from members m where m.user_id = auth.uid() and m.role in ('owner', 'manager', 'researcher') order by m.joined_at limit 1;
  if t is null then raise exception 'Only people who can change leads can use their team key'; end if;
  if not public.team_active(t) then raise exception 'Your plan has ended'; end if;
  select s.decrypted_secret into v from team_keys k join vault.decrypted_secrets s on s.id = k.secret_id where k.team_id = t and k.service = assistant_team_key.service;
  return v;
end $$;

create or replace function public.key_for_check(server_secret text, service text) returns text
language plpgsql stable security definer set search_path = public, vault as $$
declare t uuid := public.my_team_id(true); v text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  if t is null then raise exception 'Only the owner or a manager can test keys'; end if;
  if service not in ('companiesHouse', 'hunter', 'listenNotes', 'anthropic', 'openai', 'gemini', 'openrouter', 'groq', 'hubspot', 'pipedrive', 'apollo', 'findymail') then raise exception 'Unknown service'; end if;
  select s.decrypted_secret into v from team_keys k join vault.decrypted_secrets s on s.id = k.secret_id where k.team_id = t and k.service = key_for_check.service;
  return v;
end $$;

create or replace function public.set_assistant_provider_key(provider text, value text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare v text := trim(coalesce(value, '')); old uuid;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can change the Assistant keys'; end if;
  if provider not in ('openai', 'gemini', 'openrouter', 'groq') then raise exception 'Unknown AI company'; end if;
  if length(v) < 16 or length(v) > 400 or v ~ '\s' then raise exception 'That does not look like an API key'; end if;
  select secret_id into old from assistant_kestrel_keys k where k.provider = set_assistant_provider_key.provider;
  if old is not null then
    perform vault.update_secret(old, v);
    update assistant_kestrel_keys k set last4 = right(v, 4), updated_at = now(), updated_by = auth.uid(), checked_at = null, check_ok = null, check_note = null
      where k.provider = set_assistant_provider_key.provider;
  else
    insert into assistant_kestrel_keys (provider, secret_id, last4, updated_by)
    values (set_assistant_provider_key.provider, vault.create_secret(v, 'kestrel:assistant-key:' || set_assistant_provider_key.provider || ':' || gen_random_uuid(), 'Kestrel Assistant key'), right(v, 4), auth.uid());
  end if;
end $$;

notify pgrst, 'reload schema';
