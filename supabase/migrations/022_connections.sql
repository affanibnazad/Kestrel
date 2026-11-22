-- Connections page, done properly: every team key (Claude, ChatGPT, Gemini, OpenRouter, Hunter, Companies House,
-- Listen Notes) can be tested from the App, and the result is kept so everyone sees "Working" or "Not working".
-- Keys stay in Supabase Vault; the App still sees only the last four characters.
-- Run once, after 021: node scripts/run-sql.mjs supabase/migrations/022_connections.sql  (safe to run again; only adds)

alter table public.team_keys add column if not exists checked_at timestamptz;
alter table public.team_keys add column if not exists check_ok boolean;
alter table public.team_keys add column if not exists check_note text check (check_note is null or length(check_note) <= 200);

-- Saving a key (same as 005) now also clears the last test, because the new key has not been tested yet.
create or replace function public.set_team_key(service text, value text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare t uuid := public.my_team_id(true); v text := trim(coalesce(value, '')); old uuid;
begin
  if t is null then raise exception 'Only the owner or a manager can change keys'; end if;
  if length(v) < 8 or length(v) > 400 then raise exception 'That does not look like a key'; end if;
  select secret_id into old from team_keys k where k.team_id = t and k.service = set_team_key.service;
  if old is not null then
    perform vault.update_secret(old, v);
    update team_keys k set last4 = right(v, 4), updated_by = auth.uid(), updated_at = now(), checked_at = null, check_ok = null, check_note = null
      where k.team_id = t and k.service = set_team_key.service;
  else
    insert into team_keys (team_id, service, secret_id, last4, updated_by)
    values (t, set_team_key.service, vault.create_secret(v, 'kestrel:' || t || ':' || set_team_key.service || ':' || gen_random_uuid(), 'Kestrel team key'), right(v, 4), auth.uid());
  end if;
end $$;

-- The list the Connections page shows: never the key, only its last four characters and the last test.
create or replace function public.list_team_keys() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('service', service, 'last4', last4, 'updated_at', updated_at,
    'checked_at', checked_at, 'check_ok', check_ok, 'check_note', check_note) order by service), '[]'::json)
  from team_keys where team_id = public.my_team_id(false);
$$;

-- For the App's server only, to test one key: needs Kestrel's server secret (the same check as the mail server) AND
-- the signed-in owner or manager. A person calling the database directly does not have the secret, so the plain key
-- never reaches a browser.
create or replace function public.key_for_check(server_secret text, service text) returns text
language plpgsql stable security definer set search_path = public, vault as $$
declare t uuid := public.my_team_id(true); v text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  if t is null then raise exception 'Only the owner or a manager can test keys'; end if;
  if service not in ('companiesHouse', 'hunter', 'listenNotes', 'anthropic', 'openai', 'gemini', 'openrouter') then raise exception 'Unknown service'; end if;
  select s.decrypted_secret into v from team_keys k join vault.decrypted_secrets s on s.id = k.secret_id where k.team_id = t and k.service = key_for_check.service;
  return v;
end $$;
drop function if exists public.key_for_check(text);

-- Keeps the result of a test (owner or manager only).
create or replace function public.record_key_check(service text, ok boolean, note text) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id(true);
begin
  if t is null then raise exception 'Only the owner or a manager can test keys'; end if;
  update team_keys k set checked_at = now(), check_ok = ok, check_note = left(nullif(trim(coalesce(note, '')), ''), 200)
    where k.team_id = t and k.service = record_key_check.service;
end $$;

revoke all on function public.key_for_check(text, text), public.record_key_check(text, boolean, text) from public, anon;
grant execute on function public.key_for_check(text, text), public.record_key_check(text, boolean, text) to authenticated;  -- key_for_check also needs the server secret
revoke all on function public.set_team_key(text, text), public.list_team_keys() from public, anon;
grant execute on function public.set_team_key(text, text), public.list_team_keys() to authenticated;

notify pgrst, 'reload schema';
