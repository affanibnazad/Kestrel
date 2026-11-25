-- 077_ai_slots.sql
-- Kestrel AI Slots: 3 configurable model slots (swift, talon, nest) for Owner -> AI.
-- Also adds nullable `slot` column to `ai_runs` and updates `log_ai_run`.
-- NOTE: Do NOT copy data from old assistant_settings; Affan fills the 3 slots on Owner -> AI.

-- ----------------------------------------------------------------------------
-- 1. public.ai_slots
-- ----------------------------------------------------------------------------
create table if not exists public.ai_slots (
  slot       text primary key check (slot in ('swift', 'talon', 'nest')),
  provider   text not null check (length(provider) between 1 and 40),
  base_url   text,
  model      text not null default '',
  secret_id  uuid,
  max_tokens integer,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table public.ai_slots enable row level security;
revoke all on public.ai_slots from anon, authenticated;
grant select, update on public.ai_slots to authenticated;

drop policy if exists "admins read ai_slots" on public.ai_slots;
create policy "admins read ai_slots" on public.ai_slots
  for select to authenticated
  using (public.is_admin());

drop policy if exists "admins update ai_slots" on public.ai_slots;
create policy "admins update ai_slots" on public.ai_slots
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- 2. set_ai_slot(slot, provider, base_url, model, new_key, enabled, max_tokens)
--    Admin only. Stores new_key in Supabase Vault; empty new_key keeps old key.
-- ----------------------------------------------------------------------------
create or replace function public.set_ai_slot(
  p_slot       text,
  p_provider   text,
  p_base_url   text,
  p_model      text,
  p_new_key    text default null,
  p_enabled    boolean default true,
  p_max_tokens integer default null
) returns json
language plpgsql security definer set search_path = public, vault as $$
declare
  v_slot     text := lower(trim(coalesce(p_slot, '')));
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_base_url text := nullif(trim(coalesce(p_base_url, '')), '');
  v_model    text := trim(coalesce(p_model, ''));
  v_key      text := nullif(trim(coalesce(p_new_key, '')), '');
  v_old_sec  uuid;
  v_new_sec  uuid;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only Kestrel admins can change AI slots';
  end if;

  if v_slot not in ('swift', 'talon', 'nest') then
    raise exception 'Unknown AI slot';
  end if;

  if length(v_provider) < 1 or length(v_provider) > 40 then
    raise exception 'Invalid provider';
  end if;

  if v_base_url is not null and v_base_url !~ '^https?://' then
    raise exception 'Base URL must start with http:// or https://';
  end if;

  if length(v_model) > 160 then
    raise exception 'Model name is too long';
  end if;

  select secret_id into v_old_sec from public.ai_slots where slot = v_slot;

  if v_key is not null then
    if length(v_key) < 8 or length(v_key) > 500 or v_key ~ '\s' then
      raise exception 'That does not look like an API key';
    end if;
    if v_old_sec is not null then
      perform vault.update_secret(v_old_sec, v_key);
      v_new_sec := v_old_sec;
    else
      v_new_sec := vault.create_secret(
        v_key,
        'kestrel:ai-slot:' || v_slot || ':' || gen_random_uuid(),
        'Kestrel AI slot key (' || v_slot || ')'
      );
    end if;
  else
    v_new_sec := v_old_sec;
  end if;

  insert into public.ai_slots (
    slot, provider, base_url, model, secret_id, max_tokens, enabled, updated_at, updated_by
  ) values (
    v_slot, v_provider, v_base_url, v_model, v_new_sec, p_max_tokens, coalesce(p_enabled, true), now(), auth.uid()
  )
  on conflict (slot) do update set
    provider   = excluded.provider,
    base_url   = excluded.base_url,
    model      = excluded.model,
    secret_id  = excluded.secret_id,
    max_tokens = excluded.max_tokens,
    enabled    = excluded.enabled,
    updated_at = now(),
    updated_by = auth.uid();

  return json_build_object(
    'ok', true,
    'slot', v_slot,
    'has_key', (v_new_sec is not null)
  );
end $$;

revoke all on function public.set_ai_slot(text, text, text, text, text, boolean, integer) from public, anon;
grant execute on function public.set_ai_slot(text, text, text, text, text, boolean, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. ai_slot_for_server(server_secret, slot)
--    Server only (gated by mail_server_ok). Returns decrypted key + slot config.
-- ----------------------------------------------------------------------------
create or replace function public.ai_slot_for_server(
  server_secret text,
  p_slot        text
) returns json
language plpgsql security definer set search_path = public, vault as $$
declare
  v_row public.ai_slots;
  v_key text;
begin
  if not public.mail_server_ok(server_secret) then
    raise exception 'Not allowed';
  end if;

  select * into v_row from public.ai_slots where slot = lower(trim(coalesce(p_slot, '')));
  if v_row.slot is null then
    return null;
  end if;

  if v_row.secret_id is not null then
    select decrypted_secret into v_key from vault.decrypted_secrets where id = v_row.secret_id;
  end if;

  return json_build_object(
    'slot',       v_row.slot,
    'provider',   v_row.provider,
    'base_url',   v_row.base_url,
    'model',      v_row.model,
    'key',        v_key,
    'max_tokens', v_row.max_tokens,
    'enabled',    v_row.enabled
  );
end $$;

revoke all on function public.ai_slot_for_server(text, text) from public, anon;
grant execute on function public.ai_slot_for_server(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. ai_runs: add nullable slot column + update log_ai_run
-- ----------------------------------------------------------------------------
alter table public.ai_runs
  add column if not exists slot text check (slot is null or slot in ('swift', 'talon', 'nest'));

create or replace function public.log_ai_run(
  server_secret text,
  p_team_id     uuid,
  p_user_id     uuid,
  p_task        text,
  p_provider    text,
  p_model       text,
  p_source      text,
  p_attempt     integer,
  p_ms          integer,
  p_tokens_in   integer,
  p_tokens_out  integer,
  p_cost_usd    numeric,
  p_status      text,
  p_error       text,
  p_slot        text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_id   bigint;
  v_slot text := nullif(lower(trim(coalesce(p_slot, ''))), '');
begin
  if not public.mail_server_ok(server_secret) then
    raise exception 'Not allowed';
  end if;

  if v_slot is not null and v_slot not in ('swift', 'talon', 'nest') then
    v_slot := null;
  end if;

  insert into public.ai_runs (
    team_id,
    user_id,
    task,
    provider,
    model,
    source,
    attempt,
    ms,
    tokens_in,
    tokens_out,
    cost_usd,
    status,
    error,
    slot
  ) values (
    p_team_id,
    p_user_id,
    p_task,
    p_provider,
    p_model,
    p_source,
    coalesce(p_attempt, 1),
    greatest(coalesce(p_ms, 0), 0),
    greatest(coalesce(p_tokens_in, 0), 0),
    greatest(coalesce(p_tokens_out, 0), 0),
    p_cost_usd,
    p_status,
    left(nullif(trim(p_error), ''), 300),
    v_slot
  ) returning id into v_id;

  return json_build_object('ok', true, 'id', v_id);
end $$;

revoke all on function public.log_ai_run(text, uuid, uuid, text, text, text, text, integer, integer, integer, integer, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.log_ai_run(text, uuid, uuid, text, text, text, text, integer, integer, integer, integer, numeric, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
