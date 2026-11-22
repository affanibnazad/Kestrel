-- Kestrel Mail, phase 1: the team's sending mailboxes (SMTP to send, IMAP to read replies later).
-- Passwords (app passwords) are stored encrypted in Supabase Vault. Nobody can read them back from the App:
-- only the App's server can, with a server secret that browsers never see (scripts/setup-mail.mjs makes it).
-- Run once: node scripts/run-sql.mjs supabase/migrations/014_mailboxes.sql  (safe to run again)

create table if not exists public.mailboxes (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  email       text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and email = lower(email)),
  from_name   text not null default '' check (length(from_name) <= 80),
  provider    text not null default 'other' check (length(provider) <= 30),
  smtp_host   text not null check (smtp_host ~ '^[a-z0-9.-]+$' and length(smtp_host) <= 200),
  smtp_port   integer not null default 465 check (smtp_port in (25, 465, 587, 2525)),
  imap_host   text check (imap_host is null or (imap_host ~ '^[a-z0-9.-]+$' and length(imap_host) <= 200)),
  imap_port   integer default 993 check (imap_port is null or imap_port in (143, 993)),
  username    text not null check (length(username) between 1 and 254),
  secret_id   uuid not null,
  daily_limit integer not null default 25 check (daily_limit between 1 and 200),
  signature   text not null default '' check (length(signature) <= 2000),
  status      text not null default 'new' check (status in ('new', 'ok', 'error', 'paused')),
  last_error  text check (length(last_error) <= 500),
  smtp_ok     boolean, imap_ok boolean,
  tested_at   timestamptz,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (team_id, email)
);
alter table public.mailboxes enable row level security;
revoke all on public.mailboxes from anon, authenticated;
-- The team can see its mailboxes, but never secret_id.
grant select (id, team_id, email, from_name, provider, smtp_host, smtp_port, imap_host, imap_port, username, daily_limit, signature,
  status, last_error, smtp_ok, imap_ok, tested_at, created_at) on public.mailboxes to authenticated;
drop policy if exists "team reads mailboxes" on public.mailboxes;
create policy "team reads mailboxes" on public.mailboxes for select to authenticated using (public.is_member(team_id));

-- The server secret: kept in Vault under one name. scripts/setup-mail.mjs stores it (and in .mail-secret for the App's server).
create or replace function public.mail_server_ok(s text) returns boolean
language sql stable security definer set search_path = public, vault as $$
  select coalesce(length(s) >= 32 and exists (select 1 from vault.decrypted_secrets where name = 'kestrel:mail-server-secret' and decrypted_secret = s), false);
$$;
revoke all on function public.mail_server_ok(text) from public, anon, authenticated;

-- Add or change a mailbox (owners and managers). A new password replaces the old one; an empty password keeps it.
create or replace function public.save_mailbox(box_id uuid, email text, from_name text, provider text, smtp_host text, smtp_port integer,
  imap_host text, imap_port integer, username text, password text, daily_limit integer, signature text) returns uuid
language plpgsql security definer set search_path = public, vault as $$
declare t uuid := public.my_team_id(true); pw text := coalesce(password, ''); old uuid; id_out uuid;
begin
  if t is null then raise exception 'Only the owner or a manager can change mailboxes'; end if;
  if box_id is null then
    if length(pw) < 4 or length(pw) > 400 then raise exception 'Add the mailbox password (an app password)'; end if;
    insert into mailboxes (team_id, email, from_name, provider, smtp_host, smtp_port, imap_host, imap_port, username, secret_id, daily_limit, signature, created_by)
    values (t, lower(trim(email)), left(trim(coalesce(from_name, '')), 80), left(coalesce(provider, 'other'), 30), lower(trim(smtp_host)), smtp_port,
      nullif(lower(trim(coalesce(imap_host, ''))), ''), imap_port, trim(username),
      vault.create_secret(pw, 'kestrel:' || t || ':mailbox:' || gen_random_uuid(), 'Kestrel mailbox password'), coalesce(daily_limit, 25), coalesce(signature, ''), auth.uid())
    returning id into id_out;
    return id_out;
  end if;
  update mailboxes m set email = lower(trim(save_mailbox.email)), from_name = left(trim(coalesce(save_mailbox.from_name, '')), 80), provider = left(coalesce(save_mailbox.provider, 'other'), 30),
    smtp_host = lower(trim(save_mailbox.smtp_host)), smtp_port = save_mailbox.smtp_port, imap_host = nullif(lower(trim(coalesce(save_mailbox.imap_host, ''))), ''),
    imap_port = save_mailbox.imap_port, username = trim(save_mailbox.username), daily_limit = coalesce(save_mailbox.daily_limit, 25), signature = coalesce(save_mailbox.signature, ''),
    status = case when m.status = 'paused' then 'paused' else 'new' end, smtp_ok = null, imap_ok = null, last_error = null
  where m.id = box_id and m.team_id = t returning m.secret_id into old;
  if old is null then raise exception 'Mailbox not found'; end if;
  if length(pw) > 0 then
    if length(pw) > 400 then raise exception 'That password is too long'; end if;
    perform vault.update_secret(old, pw);
  end if;
  return box_id;
end $$;

create or replace function public.remove_mailbox(box_id uuid) returns void
language plpgsql security definer set search_path = public, vault as $$
declare t uuid := public.my_team_id(true); old uuid;
begin
  if t is null then raise exception 'Only the owner or a manager can change mailboxes'; end if;
  delete from mailboxes where id = box_id and team_id = t returning secret_id into old;
  if old is not null then delete from vault.secrets where id = old; end if;
end $$;

create or replace function public.pause_mailbox(box_id uuid, paused boolean) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id(true);
begin
  if t is null then raise exception 'Only the owner or a manager can change mailboxes'; end if;
  update mailboxes set status = case when paused then 'paused' when smtp_ok then 'ok' else 'new' end where id = box_id and team_id = t;
end $$;

-- For the App's server only (needs the server secret): the login to test or send. The person asking must be a manager of that team.
create or replace function public.mailbox_login_for_server(box_id uuid, server_secret text) returns json
language plpgsql security definer set search_path = public, vault as $$
declare t uuid := public.my_team_id(true); r mailboxes; pw text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  if t is null then raise exception 'Only the owner or a manager can test mailboxes'; end if;
  select * into r from mailboxes where id = box_id and team_id = t;
  if r.id is null then raise exception 'Mailbox not found'; end if;
  select decrypted_secret into pw from vault.decrypted_secrets where id = r.secret_id;
  return json_build_object('email', r.email, 'from_name', r.from_name, 'smtp_host', r.smtp_host, 'smtp_port', r.smtp_port,
    'imap_host', r.imap_host, 'imap_port', r.imap_port, 'username', r.username, 'password', pw, 'signature', r.signature);
end $$;

-- The server reports a test result (same checks).
create or replace function public.mailbox_tested(box_id uuid, server_secret text, smtp boolean, imap boolean, err text) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id(true);
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  update mailboxes set smtp_ok = smtp, imap_ok = imap, last_error = left(nullif(err, ''), 500), tested_at = now(),
    status = case when status = 'paused' then 'paused' when smtp then 'ok' else 'error' end
  where id = box_id and team_id = t;
end $$;

revoke all on function public.save_mailbox(uuid, text, text, text, text, integer, text, integer, text, text, integer, text), public.remove_mailbox(uuid),
  public.pause_mailbox(uuid, boolean), public.mailbox_login_for_server(uuid, text), public.mailbox_tested(uuid, text, boolean, boolean, text) from public, anon;
grant execute on function public.save_mailbox(uuid, text, text, text, text, integer, text, integer, text, text, integer, text), public.remove_mailbox(uuid),
  public.pause_mailbox(uuid, boolean), public.mailbox_login_for_server(uuid, text), public.mailbox_tested(uuid, text, boolean, boolean, text) to authenticated;

notify pgrst, 'reload schema';
