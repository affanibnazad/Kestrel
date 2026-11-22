-- Kestrel 045: Owner → Email verifier. Kestrel's own verifier server (quarry-cloud/verifier) is set up from the App:
-- the admin types the server's address, Kestrel makes the shared secret (kept in Vault), shows the install line, and
-- tests the server. /api/verify reads the address and secret here with the server secret (database 044 labels).
-- Run once: node scripts/run-sql.mjs supabase/migrations/045_verifier_settings.sql  (safe to run again; only adds)

create table if not exists public.verifier_settings (
  id          boolean primary key default true check (id),          -- exactly one row
  host        text check (host is null or (host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' and length(host) <= 200)),
  secret_id   uuid,
  enabled     boolean not null default true,
  updated_at  timestamptz,
  updated_by  uuid references auth.users (id) on delete set null,
  checked_at  timestamptz,
  check_ok    boolean,
  check_note  text check (check_note is null or length(check_note) <= 300)
);
alter table public.verifier_settings enable row level security;
revoke all on public.verifier_settings from anon, authenticated;
insert into public.verifier_settings (id) values (true) on conflict (id) do nothing;

-- The server's address, e.g. check.kestrelverify.site (no https://, no path).
create or replace function public.set_verifier_host(host text, enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare h text := lower(regexp_replace(regexp_replace(trim(coalesce(host, '')), '^https?://', ''), '/.*$', ''));
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can change the email verifier'; end if;
  if h <> '' and h !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
    raise exception 'Type the server address like check.yourdomain.com';
  end if;
  update verifier_settings set host = nullif(h, ''), enabled = coalesce(set_verifier_host.enabled, true), updated_at = now(), updated_by = auth.uid(),
    checked_at = null, check_ok = null, check_note = null where id;
end $$;

-- A new shared secret (32 random bytes, hex). The old one stops working at once; the server must be given the new one.
create or replace function public.new_verifier_secret() returns void
language plpgsql security definer set search_path = public, vault, extensions as $$
declare v text := encode(extensions.gen_random_bytes(32), 'hex'); old uuid;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can change the email verifier'; end if;
  select secret_id into old from verifier_settings where id;
  if old is not null then perform vault.update_secret(old, v);
  else update verifier_settings set secret_id = vault.create_secret(v, 'kestrel:verifier-secret:' || gen_random_uuid(), 'Kestrel email verifier secret') where id;
  end if;
  update verifier_settings set updated_at = now(), updated_by = auth.uid(), checked_at = null, check_ok = null, check_note = null where id;
end $$;

-- For the install line in the Owner panel (admins only).
create or replace function public.verifier_install_secret() returns text
language plpgsql stable security definer set search_path = public, vault as $$
declare s uuid; v text;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can see the verifier secret'; end if;
  select secret_id into s from verifier_settings where id;
  if s is not null then select decrypted_secret into v from vault.decrypted_secrets where id = s; end if;
  return v;
end $$;

create or replace function public.verifier_admin_status() returns json
language sql stable security definer set search_path = public as $$
  select case when not coalesce(public.is_admin(), false) then null else (
    select json_build_object('host', v.host, 'has_secret', v.secret_id is not null, 'enabled', v.enabled, 'updated_at', v.updated_at,
      'checked_at', v.checked_at, 'check_ok', v.check_ok, 'check_note', v.check_note)
    from verifier_settings v where v.id) end;
$$;

create or replace function public.record_verifier_check(ok boolean, note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can test the email verifier'; end if;
  update verifier_settings set checked_at = now(), check_ok = ok, check_note = left(nullif(trim(coalesce(note, '')), ''), 300) where id;
end $$;

-- For the App's server only (the server secret): the address and secret, when the verifier is switched on.
create or replace function public.verifier_config(server_secret text) returns json
language plpgsql stable security definer set search_path = public, vault as $$
declare v verifier_settings; k text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into v from verifier_settings where id;
  if v.host is null or v.secret_id is null or not v.enabled then return json_build_object('url', null, 'secret', null); end if;
  select decrypted_secret into k from vault.decrypted_secrets where id = v.secret_id;
  return json_build_object('url', 'https://' || v.host, 'secret', k);
end $$;

revoke all on function public.set_verifier_host(text, boolean), public.new_verifier_secret(), public.verifier_install_secret(),
  public.verifier_admin_status(), public.record_verifier_check(boolean, text), public.verifier_config(text) from public, anon;
grant execute on function public.set_verifier_host(text, boolean), public.new_verifier_secret(), public.verifier_install_secret(),
  public.verifier_admin_status(), public.record_verifier_check(boolean, text) to authenticated;
grant execute on function public.verifier_config(text) to anon, authenticated;   -- checked by the server secret

notify pgrst, 'reload schema';
