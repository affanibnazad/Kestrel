-- Kestrel 040: the creator program (Kestrel's own affiliate system), plan in Outreach Engine/08 and 12 (Part 3).
-- A creator recommends Kestrel with a link (kestrelleads.com/?ref=CODE, remembered 30 days) or by giving their code at
-- sign-up. The new team is linked to that creator (one creator per team, first one wins, never your own account).
-- Each paid Lemon Squeezy invoice of that team earns the creator their rate (30%, founding creators 40%) for 12 months
-- from the first payment. A refund reverses it. Commission is "held" for 30 days, then ready to pay. Affan pays creators
-- himself and marks them paid in Owner → Creators. Only Kestrel admins see the program; a creator sees only their own
-- numbers (never who signed up). Nobody reads these tables directly: everything goes through the functions below.
-- Also: anon could still ask the leads table (row rules blocked every row, so nothing leaked); now refused outright.
-- Run once, after 039: node scripts/run-sql.mjs supabase/migrations/040_creators.sql  (safe to run again)

-- ---------- 0. leads: anon has no business with this table (002 never revoked the default grant).
revoke all on public.leads from anon;

-- ---------- 1. tables
create table if not exists public.creators (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 80),
  email      text not null check (length(email) between 3 and 200 and email like '%@%'),
  code       text not null unique check (code ~ '^[A-Z0-9]{3,20}$'),
  rate       integer not null default 30 check (rate between 1 and 60),
  months     integer not null default 12 check (months between 1 and 120),
  founding   boolean not null default false,
  status     text not null default 'active' check (status in ('active', 'paused', 'ended')),
  notes      text check (length(notes) <= 1000),
  created_at timestamptz not null default now()
);
create unique index if not exists creators_email_key on public.creators (lower(email));

create table if not exists public.referrals (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null unique references public.teams (id) on delete cascade,
  creator_id     uuid not null references public.creators (id) on delete cascade,
  source         text not null check (source in ('link', 'code')),
  status         text not null default 'ok' check (status in ('ok', 'blocked')),
  blocked_reason text,
  first_paid_at  timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists referrals_creator on public.referrals (creator_id);

create table if not exists public.commissions (
  id               uuid primary key default gen_random_uuid(),
  referral_id      uuid not null references public.referrals (id) on delete cascade,
  creator_id       uuid not null references public.creators (id) on delete cascade,
  invoice_id       text not null unique,
  paid_cents       integer not null check (paid_cents >= 0),
  commission_cents integer not null check (commission_cents >= 0),
  rate             integer not null,
  -- pending (in the 30-day hold, then owed) → paid. A refund: pending → reversed; already paid → clawback (owed back,
  -- taken off the next payout, then recovered).
  status           text not null default 'pending' check (status in ('pending', 'paid', 'reversed', 'clawback', 'recovered')),
  test_mode        boolean not null default false,
  created_at       timestamptz not null default now(),
  paid_out_at      timestamptz,
  reversed_at      timestamptz
);
create index if not exists commissions_creator on public.commissions (creator_id, status);

create table if not exists public.creator_applications (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 80),
  email      text not null check (length(email) between 3 and 200 and email like '%@%'),
  link       text not null check (length(link) between 4 and 300),
  audience   text check (length(audience) <= 40),
  about      text check (length(about) <= 2000),
  status     text not null default 'new' check (status in ('new', 'approved', 'declined')),
  created_at timestamptz not null default now()
);

alter table public.creators enable row level security;
alter table public.referrals enable row level security;
alter table public.commissions enable row level security;
alter table public.creator_applications enable row level security;
revoke all on public.creators, public.referrals, public.commissions, public.creator_applications from anon, authenticated;

-- ---------- 2. a new team that came from a creator (runs after the sign-up made the team; never stops a sign-up)
create or replace function public.team_referral() returns trigger
language plpgsql security definer set search_path = public as $$
declare meta jsonb; mail text; v_code text; c creators;
begin
  select u.raw_user_meta_data, lower(u.email) into meta, mail from auth.users u where u.id = new.created_by;
  v_code := upper(nullif(trim(coalesce(meta ->> 'ref', '')), ''));
  if v_code is null or v_code !~ '^[A-Z0-9]{3,20}$' then return new; end if;
  select * into c from creators where creators.code = v_code and creators.status = 'active';
  if c.id is null then return new; end if;
  insert into referrals (team_id, creator_id, source, status, blocked_reason)
  values (new.id, c.id, case when meta ->> 'ref_source' = 'code' then 'code' else 'link' end,
          case when lower(c.email) = mail then 'blocked' else 'ok' end,
          case when lower(c.email) = mail then 'The creator''s own account' end)
  on conflict (team_id) do nothing;
  return new;
exception when others then
  return new;
end $$;
revoke all on function public.team_referral() from public, anon, authenticated;
drop trigger if exists on_team_referral on public.teams;
create trigger on_team_referral after insert on public.teams for each row execute function public.team_referral();

-- ---------- 3. public: the sign-up page checks a code ("From Alex: 50% off your first 3 months")
create or replace function public.creator_code_info(code text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('name', c.name, 'code', c.code) from creators c
  where c.code = upper(trim(creator_code_info.code)) and c.status = 'active' limit 1;
$$;
revoke all on function public.creator_code_info(text) from public;
grant execute on function public.creator_code_info(text) to anon, authenticated;

-- Apply to be a creator (the /creators page). At most 3 an hour from one email and 60 an hour in total.
create or replace function public.creator_apply(name text, email text, link text, audience text, about text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from creator_applications a where lower(a.email) = lower(trim(creator_apply.email)) and a.created_at > now() - interval '1 hour') >= 3
     or (select count(*) from creator_applications a where a.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'TOO_MANY: Too many applications just now. Please try again in an hour.';
  end if;
  insert into creator_applications (name, email, link, audience, about)
  values (trim(creator_apply.name), lower(trim(creator_apply.email)), trim(creator_apply.link),
          nullif(trim(coalesce(creator_apply.audience, '')), ''), nullif(trim(coalesce(creator_apply.about, '')), ''));
end $$;
revoke all on function public.creator_apply(text, text, text, text, text) from public;
grant execute on function public.creator_apply(text, text, text, text, text) to anon, authenticated;

-- ---------- 4. checkout: my team's creator code becomes the Lemon Squeezy discount code (50% for 3 months)
create or replace function public.my_referral_code() returns text
language sql stable security definer set search_path = public as $$
  select c.code from referrals r join creators c on c.id = r.creator_id
  where r.team_id = public.my_team_id(false) and r.status = 'ok' and c.status <> 'ended' limit 1;
$$;
revoke all on function public.my_referral_code() from public, anon;
grant execute on function public.my_referral_code() to authenticated;

-- ---------- 5. Lemon Squeezy: commission on each paid invoice, reversed on a refund.
-- Same signature check and test-mode rule as ls_webhook (039). Runs beside it; ls_webhook is not changed.
create or replace function public.ls_commission(payload text, signature text) returns text
language plpgsql security definer set search_path = public, vault, extensions as $$
declare
  secret text; body jsonb; a jsonb; ev text; inv text; t uuid; r referrals; c creators; base integer; test boolean;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'kestrel:lemonsqueezy-webhook' limit 1;
  if secret is null then raise exception 'Payments are not set up yet'; end if;
  if signature is null or encode(extensions.hmac(convert_to(payload, 'UTF8'), convert_to(secret, 'UTF8'), 'sha256'), 'hex') <> lower(signature) then
    raise exception 'Bad signature';
  end if;
  body := payload::jsonb;
  ev := body #>> '{meta,event_name}';
  if ev not in ('subscription_payment_success', 'subscription_payment_refunded') then return 'ignored'; end if;
  test := coalesce((body #>> '{meta,test_mode}')::boolean, false);
  if test and not exists (select 1 from vault.decrypted_secrets where name = 'kestrel:billing-allow-test' and decrypted_secret = 'yes') then
    return 'test mode ignored';
  end if;
  a := body #> '{data,attributes}';
  inv := body #>> '{data,id}';
  if inv is null then return 'no invoice'; end if;
  if ev = 'subscription_payment_refunded' then
    update commissions set status = case when status = 'paid' then 'clawback' else 'reversed' end, reversed_at = now()
    where invoice_id = inv and status in ('pending', 'paid');
    return 'reversed';
  end if;
  if coalesce(a ->> 'status', 'paid') <> 'paid' then return 'not paid'; end if;
  -- The team: by its subscription, else by the team id in the checkout link (the first payment can come first).
  select id into t from teams where ls_subscription_id = a ->> 'subscription_id' limit 1;
  if t is null then begin t := (body #>> '{meta,custom_data,team_id}')::uuid; exception when others then t := null; end; end if;
  if t is null then return 'no team'; end if;
  select * into r from referrals where team_id = t for update;
  if r.id is null then return 'no creator'; end if;
  if r.status = 'blocked' then return 'blocked referral'; end if;
  select * into c from creators where id = r.creator_id;
  if c.status = 'ended' then return 'creator ended'; end if;
  if r.first_paid_at is not null and now() > r.first_paid_at + make_interval(months => c.months) then return 'commission period over'; end if;
  -- What the customer paid, before tax, in US cents (Lemon Squeezy sends *_usd for every currency).
  base := coalesce(nullif(a ->> 'total_usd', '')::integer, 0) - coalesce(nullif(a ->> 'tax_usd', '')::integer, 0);
  if base <= 0 then return 'nothing paid'; end if;
  insert into commissions (referral_id, creator_id, invoice_id, paid_cents, commission_cents, rate, test_mode)
  values (r.id, c.id, inv, base, round(base * c.rate / 100.0)::integer, c.rate, test)
  on conflict (invoice_id) do nothing;
  update referrals set first_paid_at = coalesce(first_paid_at, now()) where id = r.id;
  return 'commission recorded';
end $$;
revoke all on function public.ls_commission(text, text) from public;
grant execute on function public.ls_commission(text, text) to anon, authenticated;

-- ---------- 6. one creator's money, in US cents (real payments only; test-mode ones are shown apart)
--   earned: all commission still standing · held: pending, under 30 days · owed: pending past the hold, minus clawbacks
--   paid: money sent to the creator · back: refunds of commission already paid, not yet taken off a payout
create or replace function public.creator_money(c uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'earned', coalesce(sum(k.commission_cents) filter (where k.status in ('pending', 'paid')), 0),
    'held',   coalesce(sum(k.commission_cents) filter (where k.status = 'pending' and k.created_at > now() - interval '30 days'), 0),
    'owed',   greatest(0, coalesce(sum(k.commission_cents) filter (where k.status = 'pending' and k.created_at <= now() - interval '30 days'), 0)
                        - coalesce(sum(k.commission_cents) filter (where k.status = 'clawback'), 0)),
    'paid',   coalesce(sum(k.commission_cents) filter (where k.status in ('paid', 'clawback', 'recovered')), 0)
              - coalesce(sum(k.commission_cents) filter (where k.status = 'recovered'), 0),
    'back',   coalesce(sum(k.commission_cents) filter (where k.status = 'clawback'), 0),
    'revenue', coalesce(sum(k.paid_cents) filter (where k.status in ('pending', 'paid')), 0),
    'test',   (select coalesce(sum(t.commission_cents), 0) from commissions t where t.creator_id = c and t.test_mode and t.status in ('pending', 'paid')))
  from commissions k where k.creator_id = c and not k.test_mode;
$$;
revoke all on function public.creator_money(uuid) from public, anon, authenticated;

-- ---------- 7. Owner → Creators (Kestrel admins only)
create or replace function public.owner_creators() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then return null; end if;
  return json_build_object(
    'creators', coalesce((select json_agg(x order by x.created_at desc) from (
      select c.id, c.name, c.email, c.code, c.rate, c.months, c.founding, c.status, c.notes, c.created_at,
        (select count(*) from referrals r where r.creator_id = c.id and r.status = 'ok') as signups,
        (select count(*) from referrals r join teams t on t.id = r.team_id where r.creator_id = c.id and r.status = 'ok'
           and t.plan <> 'trial' and t.paid_until > now()) as paying,
        (select count(*) from referrals r where r.creator_id = c.id and r.status = 'blocked') as blocked,
        public.creator_money(c.id) as money
      from creators c) x), '[]'::json),
    'applications', coalesce((select json_agg(a order by a.created_at desc) from (
      select id, name, email, link, audience, about, status, created_at from creator_applications order by created_at desc limit 200) a), '[]'::json));
end $$;
revoke all on function public.owner_creators() from public, anon;
grant execute on function public.owner_creators() to authenticated;

-- Add or change a creator. c_id null = new creator. The code is saved in capitals.
create or replace function public.owner_creator_save(c_id uuid, c_name text, c_email text, c_code text, c_rate integer, c_months integer,
  c_founding boolean, c_status text, c_notes text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if upper(trim(coalesce(c_code, ''))) !~ '^[A-Z0-9]{3,20}$' then raise exception 'The code must be 3 to 20 letters or numbers, no spaces.'; end if;
  if length(trim(coalesce(c_name, ''))) not between 1 and 80 then raise exception 'Give a name of up to 80 characters.'; end if;
  if trim(coalesce(c_email, '')) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(c_email) > 200 then raise exception 'Give a valid email.'; end if;
  if c_rate is not null and c_rate not between 1 and 60 then raise exception 'The commission must be 1 to 60 percent.'; end if;
  if c_months is not null and c_months not between 1 and 120 then raise exception 'The months must be 1 to 120.'; end if;
  if length(coalesce(c_notes, '')) > 1000 then raise exception 'Notes can be up to 1,000 characters.'; end if;
  if coalesce(c_status, 'active') not in ('', 'active', 'paused', 'ended') then raise exception 'Unknown status.'; end if;
  if c_id is null then
    insert into creators (name, email, code, rate, months, founding, status, notes)
    values (trim(c_name), lower(trim(c_email)), upper(trim(c_code)), coalesce(c_rate, 30), coalesce(c_months, 12), coalesce(c_founding, false),
            coalesce(nullif(c_status, ''), 'active'), nullif(trim(coalesce(c_notes, '')), ''))
    returning id into v;
  else
    update creators set name = trim(c_name), email = lower(trim(c_email)), code = upper(trim(c_code)), rate = coalesce(c_rate, rate),
      months = coalesce(c_months, months), founding = coalesce(c_founding, founding), status = coalesce(nullif(c_status, ''), status),
      notes = nullif(trim(coalesce(c_notes, '')), '')
    where id = c_id returning id into v;
    if v is null then raise exception 'Creator not found'; end if;
  end if;
  return v;
exception when unique_violation then
  raise exception 'Another creator already has that code or email.';
end $$;
revoke all on function public.owner_creator_save(uuid, text, text, text, integer, integer, boolean, text, text) from public, anon;
grant execute on function public.owner_creator_save(uuid, text, text, text, integer, integer, boolean, text, text) to authenticated;

-- Mark what a creator is owed (past the 30-day hold, minus refunds of earlier payouts) as paid. Returns the amount
-- Affan sent, in cents. Test-mode commission is never paid.
create or replace function public.owner_creator_mark_paid(c_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare due integer; back integer;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  perform 1 from creators where id = c_id for update;
  select coalesce(sum(commission_cents), 0) into due from commissions
  where creator_id = c_id and status = 'pending' and not test_mode and created_at <= now() - interval '30 days';
  select coalesce(sum(commission_cents), 0) into back from commissions where creator_id = c_id and status = 'clawback' and not test_mode;
  if due <= back then return 0; end if;   -- nothing to send yet: earlier refunds are larger
  update commissions set status = 'paid', paid_out_at = now()
  where creator_id = c_id and status = 'pending' and not test_mode and created_at <= now() - interval '30 days';
  update commissions set status = 'recovered' where creator_id = c_id and status = 'clawback' and not test_mode;
  return due - back;
end $$;
revoke all on function public.owner_creator_mark_paid(uuid) from public, anon;
grant execute on function public.owner_creator_mark_paid(uuid) to authenticated;

create or replace function public.owner_application_set(a_id uuid, a_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if a_status not in ('new', 'approved', 'declined') then raise exception 'Unknown status'; end if;
  update creator_applications set status = a_status where id = a_id;
end $$;
revoke all on function public.owner_application_set(uuid, text) from public, anon;
grant execute on function public.owner_application_set(uuid, text) to authenticated;

-- ---------- 8. a creator's own page in the App: found by their sign-in email. Never shows who signed up.
create or replace function public.my_creator() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'name', c.name, 'code', c.code, 'rate', c.rate, 'months', c.months, 'founding', c.founding, 'status', c.status,
    'signups', (select count(*) from referrals r where r.creator_id = c.id and r.status = 'ok'),
    'paying', (select count(*) from referrals r join teams t on t.id = r.team_id where r.creator_id = c.id and r.status = 'ok' and t.plan <> 'trial' and t.paid_until > now()),
    'money', public.creator_money(c.id),
    'recent', coalesce((select json_agg(x order by x.joined desc) from (
      select r.created_at as joined, r.source,
        case when t.plan <> 'trial' and t.paid_until > now() then 'paying' when t.trial_ends_at > now() then 'trial' else 'not paying' end as state,
        coalesce((select sum(k.commission_cents) from commissions k where k.referral_id = r.id and k.status in ('pending', 'paid') and not k.test_mode), 0) as earned
      from referrals r join teams t on t.id = r.team_id where r.creator_id = c.id and r.status = 'ok' order by r.created_at desc limit 100) x), '[]'::json))
  from creators c
  where lower(c.email) = (select lower(u.email) from auth.users u where u.id = auth.uid()) and c.status <> 'ended'
  limit 1;
$$;
revoke all on function public.my_creator() from public, anon;
grant execute on function public.my_creator() to authenticated;

notify pgrst, 'reload schema';
