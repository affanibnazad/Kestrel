-- Kestrel 057: Kestrel's own name for each AI model (Affan, 18 Nov 2026). People see "Answered by Kestrel Pro" instead of
-- the AI company and model; each model keeps its own name, so switching models in Owner → Assistant switches the name.
-- Only Kestrel admins set names (Owner panel). The App's server reads the chosen model's name with the server secret.
-- Run once: node scripts/run-sql.mjs supabase/migrations/057_model_names.sql  (safe to run again)

create table if not exists public.assistant_model_names (
  model        text primary key check (length(model) between 1 and 120 and model ~ '^[A-Za-z0-9._:/-]+$'),
  display_name text not null check (length(display_name) between 2 and 40 and display_name ~ '^[A-Za-z0-9][A-Za-z0-9 .+&-]*$'),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null
);
alter table public.assistant_model_names enable row level security;
revoke all on public.assistant_model_names from anon, authenticated;   -- read and written only through the functions below

-- Admins: set (or with an empty name, clear) the name people see for one model.
create or replace function public.set_model_display_name(model text, display_name text) returns void
language plpgsql security definer set search_path = public as $$
declare m text := trim(coalesce(model, '')); n text := regexp_replace(trim(coalesce(display_name, '')), '\s+', ' ', 'g');
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can name the AI models'; end if;
  if m = '' or length(m) > 120 or m !~ '^[A-Za-z0-9._:/-]+$' then raise exception 'Unknown model'; end if;
  if n = '' then delete from assistant_model_names x where x.model = m; return; end if;
  if length(n) < 2 or length(n) > 40 or n !~ '^[A-Za-z0-9][A-Za-z0-9 .+&-]*$' then
    raise exception 'Use 2 to 40 letters, numbers, spaces or . + & -';
  end if;
  insert into assistant_model_names (model, display_name, updated_by) values (m, n, auth.uid())
  on conflict on constraint assistant_model_names_pkey do update set display_name = excluded.display_name, updated_at = now(), updated_by = auth.uid();
end $$;

-- What the Owner panel shows (034's, plus every model's name; never a key).
create or replace function public.assistant_admin_providers() returns json
language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then null else json_build_object(
    'provider', (select s.provider from assistant_settings s where s.id),
    'model', (select s.model from assistant_settings s where s.id),
    'claude_key', (select s.secret_id is not null from assistant_settings s where s.id),
    'keys', coalesce((select json_agg(json_build_object('provider', k.provider, 'last4', k.last4, 'updated_at', k.updated_at,
      'checked_at', k.checked_at, 'check_ok', k.check_ok, 'check_note', k.check_note)) from assistant_kestrel_keys k), '[]'::json),
    'names', coalesce((select json_object_agg(x.model, x.display_name) from assistant_model_names x), '{}'::json)) end;
$$;

-- For the App's server only: the included AI's company, model, switch, key (027's) and now the name people see.
create or replace function public.assistant_included(server_secret text) returns json
language plpgsql stable security definer set search_path = public, vault as $$
declare s assistant_settings; k text; nm text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into s from assistant_settings where id;
  if coalesce(s.provider, 'anthropic') = 'anthropic' then
    if s.secret_id is not null then select decrypted_secret into k from vault.decrypted_secrets where id = s.secret_id; end if;
  else
    select d.decrypted_secret into k from assistant_kestrel_keys x join vault.decrypted_secrets d on d.id = x.secret_id where x.provider = s.provider;
  end if;
  select x.display_name into nm from assistant_model_names x where x.model = coalesce(s.model, 'auto');
  return json_build_object('provider', coalesce(s.provider, 'anthropic'), 'model', coalesce(s.model, 'auto'), 'enabled', coalesce(s.enabled, true), 'key', k, 'name', nm);
end $$;

revoke all on function public.set_model_display_name(text, text), public.assistant_admin_providers(), public.assistant_included(text) from public, anon;
grant execute on function public.set_model_display_name(text, text), public.assistant_admin_providers() to authenticated;   -- each checks is_admin()
grant execute on function public.assistant_included(text) to authenticated;                                                   -- needs the server secret

notify pgrst, 'reload schema';
