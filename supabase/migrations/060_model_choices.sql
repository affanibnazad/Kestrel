-- Kestrel 060: people choose among Kestrel's named models (Phase 3B, 18 Nov 2026). The Owner names models in
-- Owner → Assistant (057); now each name also remembers its AI company, and everyone signed in can see the list of
-- names (never a company, a key or a price). The App's server checks a person's pick with the server secret.
-- Run once: node scripts/run-sql.mjs supabase/migrations/060_model_choices.sql  (safe to run again)

alter table public.assistant_model_names add column if not exists provider text
  check (provider is null or provider in ('anthropic', 'openai', 'gemini', 'openrouter', 'groq', 'nvidia'));
-- Names saved before 060: the company of the model the Owner has chosen now, when it is that model.
update public.assistant_model_names x set provider = s.provider
  from public.assistant_settings s where s.id and x.provider is null and x.model = s.model;

-- 057's function, plus the company: names are given while that company is chosen in the Owner panel.
create or replace function public.set_model_display_name(model text, display_name text) returns void
language plpgsql security definer set search_path = public as $$
declare m text := trim(coalesce(model, '')); n text := regexp_replace(trim(coalesce(display_name, '')), '\s+', ' ', 'g');
  p text := (select s.provider from assistant_settings s where s.id);
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can name the AI models'; end if;
  if m = '' or length(m) > 120 or m !~ '^[A-Za-z0-9._:/-]+$' then raise exception 'Unknown model'; end if;
  if n = '' then delete from assistant_model_names x where x.model = m; return; end if;
  if length(n) < 2 or length(n) > 40 or n !~ '^[A-Za-z0-9][A-Za-z0-9 .+&-]*$' then
    raise exception 'Use 2 to 40 letters, numbers, spaces or . + & -';
  end if;
  insert into assistant_model_names (model, display_name, provider, updated_by) values (m, n, p, auth.uid())
  on conflict on constraint assistant_model_names_pkey do update set display_name = excluded.display_name, provider = coalesce(excluded.provider, assistant_model_names.provider),
    updated_at = now(), updated_by = auth.uid();
end $$;

-- A named model can be used when Kestrel has a key for its company (Claude: the Owner's Claude key).
create or replace function public.assistant_model_usable(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p is null then false
    when p = 'anthropic' then exists (select 1 from assistant_settings s where s.id and s.secret_id is not null)
    else exists (select 1 from assistant_kestrel_keys k where k.provider = p) end;
$$;
revoke all on function public.assistant_model_usable(text) from public, anon, authenticated;

-- For everyone signed in: the Kestrel names they can pick, and which one is Kestrel's default. Names only.
create or replace function public.assistant_model_choices() returns json
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null or not coalesce((select s.enabled from assistant_settings s where s.id), true) then '[]'::json
    else coalesce((select json_agg(json_build_object('model', x.model, 'name', x.display_name,
        'default', x.model = (select s.model from assistant_settings s where s.id)) order by x.display_name)
      from assistant_model_names x where public.assistant_model_usable(x.provider)), '[]'::json) end;
$$;
revoke all on function public.assistant_model_choices() from public, anon;
grant execute on function public.assistant_model_choices() to authenticated;

-- For the App's server only: a person's pick, with its company and Kestrel's key (null when it can't be used).
create or replace function public.assistant_included_pick(server_secret text, model text) returns json
language plpgsql stable security definer set search_path = public, vault as $$
declare x assistant_model_names; s assistant_settings; k text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into s from assistant_settings where id;
  if not coalesce(s.enabled, true) then return null; end if;
  select * into x from assistant_model_names n where n.model = assistant_included_pick.model;
  if x.model is null or not public.assistant_model_usable(x.provider) then return null; end if;
  if x.provider = 'anthropic' then select decrypted_secret into k from vault.decrypted_secrets where id = s.secret_id;
  else select d.decrypted_secret into k from assistant_kestrel_keys y join vault.decrypted_secrets d on d.id = y.secret_id where y.provider = x.provider; end if;
  if k is null then return null; end if;
  return json_build_object('provider', x.provider, 'model', x.model, 'name', x.display_name, 'key', k);
end $$;
revoke all on function public.assistant_included_pick(text, text) from public, anon;
grant execute on function public.assistant_included_pick(text, text) to authenticated;   -- needs the server secret

notify pgrst, 'reload schema';
