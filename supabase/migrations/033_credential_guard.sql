-- Security fix after the review of 032 (Spam Guard C): a saved app password is only ever sent to the server it was saved for.
-- Changing an email account's or test inbox's server, port or username (or a test inbox's address) now needs the password typed
-- again, so a changed server can never receive the stored password. Same functions as 014 and 032 otherwise.
-- Run once, after 032: node scripts/run-sql.mjs supabase/migrations/033_credential_guard.sql  (safe to run again; only replaces two functions)

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
  -- A saved password is only ever sent to the server it was saved for: changing the server, port or username needs it typed again.
  if length(pw) = 0 and exists (select 1 from mailboxes m where m.id = box_id and m.team_id = t and (
      m.smtp_host is distinct from lower(trim(save_mailbox.smtp_host)) or m.smtp_port is distinct from save_mailbox.smtp_port
      or m.imap_host is distinct from nullif(lower(trim(coalesce(save_mailbox.imap_host, ''))), '') or m.imap_port is distinct from save_mailbox.imap_port
      or m.username is distinct from trim(save_mailbox.username))) then
    raise exception 'Type the app password again when you change the server, port or username';
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

create or replace function public.save_seed_inbox(seed_id uuid, email text, provider text, imap_host text, imap_port integer, username text, password text) returns uuid
language plpgsql security definer set search_path = public, vault as $$
declare t uuid := public.my_team_id(true); pw text := coalesce(password, ''); e text := lower(trim(coalesce(email, ''))); old uuid; id_out uuid;
begin
  if t is null then raise exception 'Only the owner or a manager can change test inboxes'; end if;
  if exists (select 1 from mailboxes m where m.team_id = t and m.email = e) then raise exception 'Use an inbox you do not send campaigns from'; end if;
  if seed_id is null then
    if (select count(*) from seed_inboxes s where s.team_id = t) >= 6 then raise exception 'At most 6 test inboxes'; end if;
    if length(pw) < 4 or length(pw) > 400 then raise exception 'Add the inbox app password'; end if;
    insert into seed_inboxes (team_id, email, provider, imap_host, imap_port, username, secret_id)
    values (t, e, coalesce(nullif(provider, ''), 'other'), lower(trim(imap_host)), coalesce(imap_port, 993), coalesce(nullif(trim(username), ''), e),
      vault.create_secret(pw, 'kestrel:' || t || ':seed:' || gen_random_uuid(), 'Kestrel test inbox password'))
    returning id into id_out;
    return id_out;
  end if;
  -- A saved password is only ever sent to the server it was saved for; a changed address must be confirmed again.
  if length(pw) = 0 and exists (select 1 from seed_inboxes s where s.id = seed_id and s.team_id = t and (
      s.email is distinct from e or s.imap_host is distinct from lower(trim(save_seed_inbox.imap_host))
      or s.imap_port is distinct from coalesce(save_seed_inbox.imap_port, 993) or s.username is distinct from coalesce(nullif(trim(save_seed_inbox.username), ''), e))) then
    raise exception 'Type the app password again when you change the address, server, port or username';
  end if;
  update seed_inboxes s set email = e, provider = coalesce(nullif(save_seed_inbox.provider, ''), 'other'), imap_host = lower(trim(save_seed_inbox.imap_host)),
    imap_port = coalesce(save_seed_inbox.imap_port, 993), username = coalesce(nullif(trim(save_seed_inbox.username), ''), e), status = 'new', last_error = null
  where s.id = seed_id and s.team_id = t returning s.secret_id into old;
  if old is null then raise exception 'Test inbox not found'; end if;
  if length(pw) > 0 then
    if length(pw) > 400 then raise exception 'That password is too long'; end if;
    perform vault.update_secret(old, pw);
  end if;
  return seed_id;
end $$;

notify pgrst, 'reload schema';
