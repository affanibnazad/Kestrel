-- Kestrel 048: "Sign in with Google" for email accounts (Gmail / Google Workspace), instead of an app password.
-- Affan saves Kestrel's Google OAuth client (ID + secret) once in Owner → Google sign-in; both are kept in Supabase Vault.
-- A team's owner or manager clicks Sign in with Google in Email accounts; Google sends back a refresh token, which is kept in
-- Vault as the account's secret, marked "oauth2:google:" (so the existing sending and reading code passes it on unchanged;
-- the App's connector only ever uses it with Gmail's own servers). Campaigns, Unibox and reply checks work as before.
-- Only the App's server (server secret) can read the client secret or a token. Nothing here is readable from a browser.
-- Run once, after 047: node scripts/run-sql.mjs supabase/migrations/048_google_mail.sql  (safe to run again)

-- ---------- 1. Kestrel's Google OAuth client (admins only)
create table if not exists public.google_mail_settings (
  id          boolean primary key default true check (id),
  client_id   text check (client_id ~ '^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$'),
  secret_id   uuid,
  updated_at  timestamptz not null default now()
);
alter table public.google_mail_settings enable row level security;
revoke all on public.google_mail_settings from anon, authenticated;

create or replace function public.set_google_mail_client(client_id text, client_secret text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare id_in text := trim(coalesce(client_id, '')); sec text := trim(coalesce(client_secret, '')); old uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if id_in !~ '^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$' then
    raise exception 'That is not a Google client ID. It looks like 1234-abc.apps.googleusercontent.com (copy it from Google Cloud → Clients).';
  end if;
  insert into google_mail_settings (id, client_id) values (true, id_in) on conflict (id) do update set client_id = excluded.client_id, updated_at = now();
  if length(sec) > 0 then
    if length(sec) < 10 or length(sec) > 200 or sec ~ '\s' then raise exception 'That client secret does not look right. Copy it again from Google Cloud.'; end if;
    select secret_id into old from google_mail_settings where id;
    if old is not null then perform vault.update_secret(old, sec);
    else update google_mail_settings set secret_id = vault.create_secret(sec, 'kestrel:google-mail-client-secret:' || gen_random_uuid(), 'Kestrel Google OAuth client secret') where id; end if;
  end if;
end $$;

create or replace function public.google_mail_admin_status() returns json
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then coalesce((select json_build_object('client_id', s.client_id, 'has_secret', s.secret_id is not null, 'updated_at', s.updated_at)
    from google_mail_settings s where s.id), json_build_object('client_id', null, 'has_secret', false)) end;
$$;

-- For the Email accounts page: show the Google button only when Kestrel's client is set up.
create or replace function public.google_mail_ready() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from google_mail_settings s where s.id and s.client_id is not null and s.secret_id is not null);
$$;

-- For the App's server only: the client ID and secret, to start a sign-in and to renew access.
create or replace function public.google_mail_client(server_secret text) returns json
language plpgsql stable security definer set search_path = public, vault as $$
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  return (select json_build_object('client_id', s.client_id, 'client_secret', d.decrypted_secret)
          from google_mail_settings s join vault.decrypted_secrets d on d.id = s.secret_id where s.id);
end $$;

-- ---------- 2. a team's Google email account (signed-in owner or manager, through the App's server)
-- Adds the account, or renews its Google sign-in if the team already has this address (then its old secret is replaced).
-- Gmail's own servers only. Returns the account id; the server then tests it (mailbox_tested) as for any other account.
create or replace function public.save_google_mailbox(server_secret text, email text, from_name text, refresh_token text) returns uuid
language plpgsql security definer set search_path = public, vault as $$
declare t uuid := public.my_team_id(true); addr text := lower(trim(coalesce(email, ''))); tok text := trim(coalesce(refresh_token, ''));
  r mailboxes; id_out uuid; sec text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  if t is null then raise exception 'Only the owner or a manager can add email accounts'; end if;
  if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Google did not give an email address'; end if;
  if length(tok) < 10 or length(tok) > 2000 or tok ~ '\s' then raise exception 'Google did not give a sign-in token. Try again.'; end if;
  sec := 'oauth2:google:' || tok;
  select * into r from mailboxes m where m.team_id = t and m.email = addr;
  if r.id is null then
    insert into mailboxes (team_id, email, from_name, provider, smtp_host, smtp_port, imap_host, imap_port, username, secret_id, daily_limit, signature, created_by)
    values (t, addr, left(trim(coalesce(from_name, '')), 80), 'google-oauth', 'smtp.gmail.com', 465, 'imap.gmail.com', 993, addr,
      vault.create_secret(sec, 'kestrel:' || t || ':mailbox:' || gen_random_uuid(), 'Kestrel mailbox Google sign-in'), 25, '', auth.uid())
    returning id into id_out;
    return id_out;
  end if;
  -- Same address again: switch it to Google sign-in (its servers become Gmail's, the old password is replaced).
  update mailboxes m set provider = 'google-oauth', smtp_host = 'smtp.gmail.com', smtp_port = 465, imap_host = 'imap.gmail.com', imap_port = 993,
    username = addr, from_name = case when m.from_name = '' then left(trim(coalesce(save_google_mailbox.from_name, '')), 80) else m.from_name end,
    status = case when m.status = 'paused' then 'paused' else 'new' end, smtp_ok = null, imap_ok = null, last_error = null
  where m.id = r.id;
  perform vault.update_secret(r.secret_id, sec);
  return r.id;
end $$;

revoke all on function public.set_google_mail_client(text, text), public.google_mail_admin_status(), public.google_mail_ready(),
  public.google_mail_client(text), public.save_google_mailbox(text, text, text, text) from public, anon;
grant execute on function public.set_google_mail_client(text, text), public.google_mail_admin_status(), public.google_mail_ready(),
  public.save_google_mailbox(text, text, text, text) to authenticated;
-- The connector renews Gmail access from server code without a signed-in person (the sending timer): checks the server secret.
grant execute on function public.google_mail_client(text) to anon, authenticated;

notify pgrst, 'reload schema';
