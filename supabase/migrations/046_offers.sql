-- Kestrel 046: Owner → Offers. Affan makes offers himself (no code edits, no manual Lemon Squeezy discounts):
--   everyone  — shown on the pricing page and applied by itself at checkout (at most one switched on at a time)
--   code      — people type the code at sign-up or on the Plan page
--   creators  — the discount every creator's code gives (one row; 50% for 3 months until Affan changes it)
-- Kestrel creates the matching discount codes in Lemon Squeezy with the store key saved here (Vault, admins only).
-- checkout_discount() decides the code for a checkout: creator code > the team's offer code > the offer for everyone.
-- Run once: node scripts/run-sql.mjs supabase/migrations/046_offers.sql  (safe to run again; only adds)

-- ---------- 1. tables
create table if not exists public.offers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(name) between 1 and 80),
  code          text unique check (code is null or code ~ '^[A-Z0-9]{3,20}$'),
  kind          text not null check (kind in ('everyone', 'code', 'creators')),
  amount_type   text not null default 'percent' check (amount_type in ('percent', 'fixed')),
  amount        integer not null check (amount > 0),            -- percent 1–100, or US cents
  duration      text not null default 'repeating' check (duration in ('once', 'repeating', 'forever')),
  months        integer check (months is null or months between 1 and 36),
  plans         text[] not null default '{}' check (plans <@ array['starter', 'pro', 'agency']::text[]),   -- empty = every plan
  starts_at     timestamptz,
  ends_at       timestamptz,
  max_uses      integer check (max_uses is null or max_uses > 0),
  active        boolean not null default true,
  ls_discount_id text,
  ls_synced_at  timestamptz,
  ls_error      text check (ls_error is null or length(ls_error) <= 300),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  check ((kind = 'creators') = (code is null)),
  check (amount_type <> 'percent' or amount <= 100),
  check (duration <> 'repeating' or months is not null),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create unique index if not exists offers_one_creators on public.offers ((kind)) where kind = 'creators';
alter table public.offers enable row level security;
revoke all on public.offers from anon, authenticated;
-- Today's creator discount (50% for 3 months), so nothing changes until Affan edits it.
insert into public.offers (name, kind, amount_type, amount, duration, months)
select 'Creator code discount', 'creators', 'percent', 50, 'repeating', 3
where not exists (select 1 from public.offers where kind = 'creators');

alter table public.creators add column if not exists ls_discount_id text;
alter table public.creators add column if not exists ls_synced_at timestamptz;
alter table public.creators add column if not exists ls_error text check (ls_error is null or length(ls_error) <= 300);
alter table public.teams add column if not exists offer_code text;   -- the offer code this team used (not readable by members; 039 column grants)

create table if not exists public.lemon_settings (
  id          boolean primary key default true check (id),
  secret_id   uuid,
  last4       text,
  store_id    text,
  test_mode   boolean,
  updated_at  timestamptz,
  checked_at  timestamptz,
  check_ok    boolean,
  check_note  text check (check_note is null or length(check_note) <= 300)
);
alter table public.lemon_settings enable row level security;
revoke all on public.lemon_settings from anon, authenticated;
insert into public.lemon_settings (id) values (true) on conflict (id) do nothing;

-- ---------- 2. helpers
-- Is this offer usable right now for team t? (switched on, inside its dates, uses left). "Max teams" counts only teams
-- that PAY with it (typing a code or opening checkout does not use it up, so nobody can exhaust an offer with sign-ups);
-- a team never counts against itself. Lemon Squeezy's own max_redemptions enforces the limit at payment too.
create or replace function public.offer_live(o offers, t uuid default null) returns boolean
language sql stable security definer set search_path = public as $$
  select o.active and (o.starts_at is null or o.starts_at <= now()) and (o.ends_at is null or o.ends_at > now())
    and (o.max_uses is null or o.kind = 'creators'
      or (select count(*) from teams x where x.offer_code = o.code and x.id is distinct from t
          and x.billing_status in ('active', 'on_trial', 'past_due') and x.paid_until > now()) < o.max_uses);
$$;
create or replace function public.offer_public_json(o offers) returns json
language sql stable set search_path = public as $$
  select json_build_object('name', o.name, 'amount_type', o.amount_type, 'amount', o.amount, 'duration', o.duration, 'months', o.months,
    'plans', o.plans, 'ends_at', o.ends_at);
$$;
revoke all on function public.offer_live(offers, uuid), public.offer_public_json(offers) from public, anon, authenticated;

-- ---------- 3. public: what the pricing, sign-up and creator pages show
create or replace function public.public_offers() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'everyone', (select public.offer_public_json(o) from offers o where o.kind = 'everyone' and public.offer_live(o) order by o.ends_at nulls last limit 1),
    'creators', (select public.offer_public_json(o) from offers o where o.kind = 'creators' and o.active limit 1));
$$;
create or replace function public.check_offer_code(code text) returns json
language sql stable security definer set search_path = public as $$
  select public.offer_public_json(o) from offers o
  where o.kind = 'code' and o.code = upper(trim(check_offer_code.code)) and public.offer_live(o) limit 1;
$$;
revoke all on function public.public_offers(), public.check_offer_code(text) from public;
grant execute on function public.public_offers(), public.check_offer_code(text) to anon, authenticated;

-- A code typed at sign-up (user metadata "offer") is kept on the new team, when it is a live code offer.
create or replace function public.team_offer_from_signup() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text; o offers;
begin
  select upper(nullif(trim(coalesce(u.raw_user_meta_data ->> 'offer', '')), '')) into v from auth.users u where u.id = new.created_by;
  if v is null or v !~ '^[A-Z0-9]{3,20}$' then return new; end if;
  select * into o from offers where offers.code = v and kind = 'code';
  if o.id is not null and public.offer_live(o) then new.offer_code := v; end if;
  return new;
exception when others then return new;   -- an offer must never block a sign-up
end $$;
revoke all on function public.team_offer_from_signup() from public, anon, authenticated;
drop trigger if exists team_offer_from_signup on public.teams;
create trigger team_offer_from_signup before insert on public.teams for each row execute function public.team_offer_from_signup();

-- The team owner types a code later (Plan page). Not for teams that came from a creator (they have the creator discount).
create or replace function public.apply_offer_code(code text) returns json
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id(true); o offers; v text := upper(trim(coalesce(apply_offer_code.code, '')));
begin
  if t is null or not exists (select 1 from members m where m.team_id = t and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'Only the team owner can add an offer code';
  end if;
  if exists (select 1 from referrals r where r.team_id = t and r.status = 'ok') then raise exception 'Your team already has a creator''s discount'; end if;
  select * into o from offers where offers.code = v and kind = 'code' for update;   -- one check at a time per offer
  if o.id is null or not public.offer_live(o, t) then raise exception 'This code is not valid, or the offer has ended'; end if;
  update teams set offer_code = v where id = t;
  return public.offer_public_json(o);
end $$;

-- The discount code for a checkout of this plan (the owner's own team): creator > team's code offer > offer for everyone.
-- Using the offer for everyone is remembered on the team (for "uses" and "paying" in Owner → Offers).
create or replace function public.checkout_discount(plan text) returns text
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id(true); v text; o offers;
begin
  if t is null then return null; end if;
  select c.code into v from referrals r join creators c on c.id = r.creator_id
  where r.team_id = t and r.status = 'ok' and c.status <> 'ended' limit 1;
  if v is not null then return v; end if;
  select o2.* into o from teams tm join offers o2 on o2.code = tm.offer_code where tm.id = t and o2.kind = 'code' for update of o2;
  if o.id is not null and public.offer_live(o, t) and (cardinality(o.plans) = 0 or checkout_discount.plan = any(o.plans)) then return o.code; end if;
  select * into o from offers o3 where o3.kind = 'everyone' and public.offer_live(o3, t)
    and (cardinality(o3.plans) = 0 or checkout_discount.plan = any(o3.plans)) order by o3.ends_at nulls last limit 1 for update;
  if o.id is not null then update teams set offer_code = o.code where id = t; return o.code; end if;
  return null;
end $$;
revoke all on function public.apply_offer_code(text), public.checkout_discount(text) from public, anon;
grant execute on function public.apply_offer_code(text), public.checkout_discount(text) to authenticated;

-- ---------- 4. Owner → Offers (Kestrel admins)
create or replace function public.offers_admin() returns json
language sql stable security definer set search_path = public as $$
  select case when not coalesce(public.is_admin(), false) then null else json_build_object(
    'offers', coalesce((select json_agg(json_build_object('id', o.id, 'name', o.name, 'code', o.code, 'kind', o.kind, 'amount_type', o.amount_type,
        'amount', o.amount, 'duration', o.duration, 'months', o.months, 'plans', o.plans, 'starts_at', o.starts_at, 'ends_at', o.ends_at,
        'max_uses', o.max_uses, 'active', o.active, 'live', public.offer_live(o), 'ls_discount_id', o.ls_discount_id, 'ls_synced_at', o.ls_synced_at,
        'ls_error', o.ls_error, 'created_at', o.created_at,
        'uses', (select count(*) from teams t where o.code is not null and t.offer_code = o.code),
        'paying', (select count(*) from teams t where o.code is not null and t.offer_code = o.code and t.billing_status in ('active', 'on_trial', 'past_due') and t.paid_until > now()))
      order by (o.kind = 'creators') desc, o.created_at desc) from offers o), '[]'::json),
    'creators', coalesce((select json_agg(json_build_object('id', c.id, 'name', c.name, 'code', c.code, 'status', c.status,
        'ls_discount_id', c.ls_discount_id, 'ls_synced_at', c.ls_synced_at, 'ls_error', c.ls_error) order by c.created_at) from creators c), '[]'::json),
    'variants', coalesce((select json_object_agg(b.plan, b.variant_id) from billing_plans b), '{}'::json),
    'lemon', (select json_build_object('has_key', s.secret_id is not null, 'last4', s.last4, 'store_id', s.store_id, 'test_mode', s.test_mode,
        'checked_at', s.checked_at, 'check_ok', s.check_ok, 'check_note', s.check_note) from lemon_settings s where s.id)) end;
$$;

create or replace function public.offer_save(o_id uuid, o_name text, o_code text, o_kind text, o_amount_type text, o_amount integer, o_duration text,
  o_months integer, o_plans text[], o_starts_at timestamptz, o_ends_at timestamptz, o_max_uses integer, o_active boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_code text := nullif(upper(trim(coalesce(o_code, ''))), ''); v_id uuid;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can change offers'; end if;
  if o_kind not in ('everyone', 'code', 'creators') then raise exception 'Choose who gets the offer'; end if;
  if o_kind = 'creators' then v_code := null;
  elsif v_code is null or v_code !~ '^[A-Z0-9]{3,20}$' then raise exception 'The code must be 3–20 capital letters or numbers, e.g. BLACKFRIDAY';
  elsif exists (select 1 from creators c where c.code = v_code) then raise exception 'A creator already uses this code';
  end if;
  if o_kind = 'everyone' and coalesce(o_active, true) and exists (select 1 from offers x where x.kind = 'everyone' and x.active and x.id is distinct from o_id) then
    raise exception 'Only one offer for everyone can be on at a time. Switch the other one off first.';
  end if;
  if o_kind = 'creators' and o_id is null then raise exception 'There is one creator offer: edit it instead'; end if;
  if o_id is null then
    insert into offers (name, code, kind, amount_type, amount, duration, months, plans, starts_at, ends_at, max_uses, active)
    values (trim(o_name), v_code, o_kind, o_amount_type, o_amount, o_duration, case when o_duration = 'repeating' then o_months end,
      coalesce(o_plans, '{}'), o_starts_at, o_ends_at, o_max_uses, coalesce(o_active, true))
    returning id into v_id;
  else
    update offers set name = trim(o_name), code = v_code, amount_type = o_amount_type, amount = o_amount, duration = o_duration,
      months = case when o_duration = 'repeating' then o_months end, plans = coalesce(o_plans, '{}'), starts_at = o_starts_at, ends_at = o_ends_at,
      max_uses = o_max_uses, active = coalesce(o_active, true), updated_at = now()
    where id = o_id and kind = o_kind returning id into v_id;
    if v_id is null then raise exception 'Offer not found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.offer_delete(o_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare ls text;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can change offers'; end if;
  delete from offers where id = o_id and kind <> 'creators' returning ls_discount_id into ls;
  if not found then raise exception 'Offer not found (the creator offer cannot be deleted, only changed)'; end if;
  return ls;
end $$;

-- After Kestrel's server created (or failed to create) the discount in Lemon Squeezy.
create or replace function public.offer_mark_synced(o_id uuid, ls_id text, err text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can change offers'; end if;
  update offers set ls_discount_id = nullif(ls_id, ''), ls_synced_at = case when nullif(ls_id, '') is not null then now() end,
    ls_error = left(nullif(trim(coalesce(err, '')), ''), 300) where id = o_id;
end $$;
create or replace function public.creator_mark_synced(c_id uuid, ls_id text, err text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can change creators'; end if;
  update creators set ls_discount_id = nullif(ls_id, ''), ls_synced_at = case when nullif(ls_id, '') is not null then now() end,
    ls_error = left(nullif(trim(coalesce(err, '')), ''), 300) where id = c_id;
end $$;

-- ---------- 5. the Lemon Squeezy store key (Vault). The App's server reads it with the server secret, for an admin only.
create or replace function public.set_lemon_key(value text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare v text := trim(coalesce(value, '')); old uuid;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can change the Lemon Squeezy key'; end if;
  if length(v) < 40 or length(v) > 4000 or v ~ '\s' then raise exception 'That does not look like a Lemon Squeezy API key (Settings → API → API keys).'; end if;
  select secret_id into old from lemon_settings where id;
  if old is not null then perform vault.update_secret(old, v);
  else update lemon_settings set secret_id = vault.create_secret(v, 'kestrel:lemon-api-key:' || gen_random_uuid(), 'Kestrel Lemon Squeezy API key') where id;
  end if;
  update lemon_settings set last4 = right(v, 4), store_id = null, test_mode = null, updated_at = now(), checked_at = null, check_ok = null, check_note = null where id;
end $$;
create or replace function public.record_lemon_check(ok boolean, note text, store text, test boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Only Kestrel admins can test the Lemon Squeezy key'; end if;
  update lemon_settings set checked_at = now(), check_ok = ok, check_note = left(nullif(trim(coalesce(note, '')), ''), 300),
    store_id = coalesce(nullif(store, ''), store_id), test_mode = coalesce(test, test_mode) where id;
end $$;
create or replace function public.lemon_for_server(server_secret text) returns json
language plpgsql stable security definer set search_path = public, vault as $$
declare s lemon_settings; k text;
begin
  if not public.mail_server_ok(server_secret) or not coalesce(public.is_admin(), false) then raise exception 'Not allowed'; end if;
  select * into s from lemon_settings where id;
  if s.secret_id is not null then select decrypted_secret into k from vault.decrypted_secrets where id = s.secret_id; end if;
  return json_build_object('key', k, 'store_id', s.store_id);
end $$;

revoke all on function public.offers_admin(), public.offer_save(uuid, text, text, text, text, integer, text, integer, text[], timestamptz, timestamptz, integer, boolean),
  public.offer_delete(uuid), public.offer_mark_synced(uuid, text, text), public.creator_mark_synced(uuid, text, text), public.set_lemon_key(text),
  public.record_lemon_check(boolean, text, text, boolean), public.lemon_for_server(text) from public, anon;
grant execute on function public.offers_admin(), public.offer_save(uuid, text, text, text, text, integer, text, integer, text[], timestamptz, timestamptz, integer, boolean),
  public.offer_delete(uuid), public.offer_mark_synced(uuid, text, text), public.creator_mark_synced(uuid, text, text), public.set_lemon_key(text),
  public.record_lemon_check(boolean, text, text, boolean), public.lemon_for_server(text) to authenticated;

notify pgrst, 'reload schema';
