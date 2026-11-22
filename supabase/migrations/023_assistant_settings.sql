-- Kestrel Assistant settings in the Owner panel: Kestrel's own Claude key (encrypted in Supabase Vault), the model,
-- and an on/off switch. Only Kestrel admins can change them; the App's server reads the key with the server secret.
-- Run once, after 022: node scripts/run-sql.mjs supabase/migrations/023_assistant_settings.sql  (safe to run again; only adds)

create table if not exists public.assistant_settings (
  id          boolean primary key default true check (id),            -- exactly one row
  secret_id   uuid,
  last4       text,
  model       text not null default 'claude-opus-5-5' check (model in ('claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5')),
  enabled     boolean not null default true,
  updated_at  timestamptz,
  updated_by  uuid references auth.users (id) on delete set null,
  checked_at  timestamptz,
  check_ok    boolean,
  check_note  text check (check_note is null or length(check_note) <= 200)
);
alter table public.assistant_settings enable row level security;
revoke all on public.assistant_settings from anon, authenticated;
insert into public.assistant_settings (id) values (true) on conflict (id) do nothing;

-- Save or replace Kestrel's Claude key (admins only). The old test result is cleared.
create or replace function public.set_assistant_key(value text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare v text := trim(coalesce(value, '')); old uuid;
begin
  if not public.is_admin() then raise exception 'Only Kestrel admins can change the Assistant key'; end if;
  if length(v) < 20 or length(v) > 400 or v !~ '^sk-ant-' then raise exception 'That does not look like a Claude API key (it starts with sk-ant-).'; end if;
  select secret_id into old from assistant_settings where id;
  if old is not null then perform vault.update_secret(old, v);
  else update assistant_settings set secret_id = vault.create_secret(v, 'kestrel:assistant-claude-key:' || gen_random_uuid(), 'Kestrel Assistant Claude key') where id;
  end if;
  update assistant_settings set last4 = right(v, 4), updated_at = now(), updated_by = auth.uid(), checked_at = null, check_ok = null, check_note = null where id;
end $$;

create or replace function public.remove_assistant_key() returns void
language plpgsql security definer set search_path = public, vault as $$
declare old uuid;
begin
  if not public.is_admin() then raise exception 'Only Kestrel admins can change the Assistant key'; end if;
  select secret_id into old from assistant_settings where id;
  update assistant_settings set secret_id = null, last4 = null, updated_at = now(), updated_by = auth.uid(), checked_at = null, check_ok = null, check_note = null where id;
  if old is not null then delete from vault.secrets where id = old; end if;
end $$;

create or replace function public.set_assistant_options(model text, enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only Kestrel admins can change the Assistant'; end if;
  update assistant_settings s set model = set_assistant_options.model, enabled = set_assistant_options.enabled, updated_at = now(), updated_by = auth.uid() where s.id;
end $$;

create or replace function public.record_assistant_check(ok boolean, note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only Kestrel admins can test the Assistant key'; end if;
  update assistant_settings set checked_at = now(), check_ok = ok, check_note = left(nullif(trim(coalesce(note, '')), ''), 200) where id;
end $$;

-- What the Owner panel shows (never the key): status, model, switch, and today's use across all teams.
create or replace function public.assistant_admin_status() returns json
language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then null else (
    select json_build_object('has_key', s.secret_id is not null, 'last4', s.last4, 'model', s.model, 'enabled', s.enabled,
      'updated_at', s.updated_at, 'checked_at', s.checked_at, 'check_ok', s.check_ok, 'check_note', s.check_note,
      'messages_today', coalesce((select sum(u.messages) from assistant_usage u where u.day = (now() at time zone 'utc')::date), 0),
      'teams_today', (select count(*) from assistant_usage u where u.day = (now() at time zone 'utc')::date),
      'messages_30d', coalesce((select sum(u.messages) from assistant_usage u where u.day > (now() at time zone 'utc')::date - 30), 0))
    from assistant_settings s where s.id) end;
$$;

-- For the App's server only (needs Kestrel's server secret): the key, model and switch.
create or replace function public.assistant_config(server_secret text) returns json
language plpgsql stable security definer set search_path = public, vault as $$
declare s assistant_settings; k text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into s from assistant_settings where id;
  if s.secret_id is not null then select decrypted_secret into k from vault.decrypted_secrets where id = s.secret_id; end if;
  return json_build_object('key', k, 'model', coalesce(s.model, 'claude-opus-5-5'), 'enabled', coalesce(s.enabled, true));
end $$;

revoke all on function public.set_assistant_key(text), public.remove_assistant_key(), public.set_assistant_options(text, boolean),
  public.record_assistant_check(boolean, text), public.assistant_admin_status(), public.assistant_config(text) from public, anon, authenticated;
grant execute on function public.set_assistant_key(text), public.remove_assistant_key(), public.set_assistant_options(text, boolean),
  public.record_assistant_check(boolean, text), public.assistant_admin_status() to authenticated;   -- each checks is_admin()
grant execute on function public.assistant_config(text) to authenticated;                           -- needs the server secret

notify pgrst, 'reload schema';
