-- Profile photo for each person (Affan, 13 Nov 2026: "profile picture upload, round photos everywhere").
-- The App shrinks the picture to 192×192 in the browser and saves it as a small data URL (PNG, JPEG or WebP, at most
-- about 90 KB). Each person sets only their own photo; teammates see it through my_account (sidebar, Team, Unibox).
-- Also: Owner → Assistant can test Kestrel's ChatGPT, Gemini and OpenRouter keys (bottom of this file).
-- Run once, after 033: node scripts/run-sql.mjs supabase/migrations/034_member_photo.sql  (safe to run again; only adds)

alter table public.members add column if not exists avatar text;
alter table public.members drop constraint if exists members_avatar_ok;
alter table public.members add constraint members_avatar_ok
  check (avatar is null or (length(avatar) <= 120000 and avatar ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'));

-- Set or remove (null) my own photo.
create or replace function public.set_my_avatar(img text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := nullif(trim(coalesce(img, '')), '');
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if v is not null and (length(v) > 120000 or v !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$') then
    raise exception 'Choose a PNG, JPEG or WebP picture.';
  end if;
  update members set avatar = v where user_id = auth.uid();
end $$;
revoke all on function public.set_my_avatar(text) from public, anon;
grant execute on function public.set_my_avatar(text) to authenticated;

-- my_account as in 010, plus my photo and each teammate's photo.
create or replace function public.my_account() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'team_id', t.id, 'team_name', t.name, 'role', m.role, 'full_name', m.full_name, 'job_title', m.job_title,
    'plan', t.plan, 'chosen_plan', t.chosen_plan, 'trial_ends_at', t.trial_ends_at,
    'active', public.team_active(t.id), 'paid_until', t.paid_until, 'billing_status', t.billing_status,
    'billing_portal', case when m.role = 'owner' then t.billing_portal end,
    'access_until', (public.team_access(t.id)).ends_at, 'access_plan', (public.team_access(t.id)).plan,
    'is_admin', public.is_admin(), 'news_ok', m.marketing_ok,
    'website', t.website, 'team_size', t.team_size, 'country', t.country,
    'join_code', case when m.role in ('owner', 'manager') then t.join_code end,
    'avatar', m.avatar,
    'members', (select json_agg(json_build_object('name', x.full_name, 'email', x.email, 'role', x.role, 'joined_at', x.joined_at, 'avatar', x.avatar) order by x.joined_at)
                from members x where x.team_id = t.id)
  )
  from members m join teams t on t.id = m.team_id
  where m.user_id = auth.uid()
  order by m.joined_at limit 1;
$$;
revoke all on function public.my_account() from public, anon;
grant execute on function public.my_account() to authenticated;

-- team_people (027) with photos, for "Assigned to" in the Unibox.
create or replace function public.team_people() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', x.user_id, 'name', x.full_name, 'email', x.email, 'avatar', x.avatar) order by x.joined_at), '[]'::json)
  from members x where x.team_id = public.my_team_id(false);
$$;
revoke all on function public.team_people() from public, anon;
grant execute on function public.team_people() to authenticated;

-- ---------- Owner → Assistant: Kestrel's own ChatGPT, Gemini and OpenRouter keys can be tested like the Claude key.
alter table public.assistant_kestrel_keys add column if not exists checked_at timestamptz;
alter table public.assistant_kestrel_keys add column if not exists check_ok boolean;
alter table public.assistant_kestrel_keys add column if not exists check_note text check (check_note is null or length(check_note) <= 200);

-- For the App's server only, for a Kestrel admin: one of Kestrel's keys, to test it (needs the server secret too).
create or replace function public.assistant_kestrel_key(server_secret text, provider text) returns text
language plpgsql stable security definer set search_path = public, vault as $$
declare v text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  if not public.is_admin() then raise exception 'Only Kestrel admins can test the Assistant keys'; end if;
  select d.decrypted_secret into v from assistant_kestrel_keys k join vault.decrypted_secrets d on d.id = k.secret_id where k.provider = assistant_kestrel_key.provider;
  return v;
end $$;

create or replace function public.record_kestrel_key_check(provider text, ok boolean, note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only Kestrel admins can test the Assistant keys'; end if;
  update assistant_kestrel_keys k set checked_at = now(), check_ok = ok, check_note = left(nullif(trim(coalesce(note, '')), ''), 200)
    where k.provider = record_kestrel_key_check.provider;
end $$;

-- A new key clears the old test result (027's function, plus that).
create or replace function public.set_assistant_provider_key(provider text, value text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare v text := trim(coalesce(value, '')); old uuid;
begin
  if not public.is_admin() then raise exception 'Only Kestrel admins can change the Assistant keys'; end if;
  if provider not in ('openai', 'gemini', 'openrouter') then raise exception 'Unknown AI company'; end if;
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

-- What the Owner panel shows (027's, plus each key's test result; never a key).
create or replace function public.assistant_admin_providers() returns json
language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then null else json_build_object(
    'provider', (select s.provider from assistant_settings s where s.id),
    'model', (select s.model from assistant_settings s where s.id),
    'claude_key', (select s.secret_id is not null from assistant_settings s where s.id),
    'keys', coalesce((select json_agg(json_build_object('provider', k.provider, 'last4', k.last4, 'updated_at', k.updated_at,
      'checked_at', k.checked_at, 'check_ok', k.check_ok, 'check_note', k.check_note)) from assistant_kestrel_keys k), '[]'::json)) end;
$$;

revoke all on function public.assistant_kestrel_key(text, text), public.record_kestrel_key_check(text, boolean, text),
  public.set_assistant_provider_key(text, text), public.assistant_admin_providers() from public, anon;
grant execute on function public.assistant_kestrel_key(text, text), public.record_kestrel_key_check(text, boolean, text),
  public.set_assistant_provider_key(text, text), public.assistant_admin_providers() to authenticated;   -- each checks is_admin()

notify pgrst, 'reload schema';
