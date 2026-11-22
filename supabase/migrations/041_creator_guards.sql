-- Kestrel 041: creator program guards (security review of 040, 14 Nov 2026).
-- 1. A creator's page needs a confirmed sign-in email (Kestrel signs in by email link, so this is always true today;
--    it stays true if another sign-in method is ever added).
-- 2. Self-referral: emails are compared after removing "+tags" (and dots for Gmail), and a team on the creator's own
--    company domain (not free mail) is blocked too. Admins see every referred team (name, owner email, date) in
--    Owner → Creators and can block one: its unpaid commission is reversed, paid commission is clawed back.
-- 3. A refund that arrives before its payment (webhooks can come out of order) leaves a 0-cent "reversed" row, so the
--    late payment is never counted. A payment already marked refunded by Lemon Squeezy earns nothing.
-- Run once, after 040: node scripts/run-sql.mjs supabase/migrations/041_creator_guards.sql  (safe to run again)

-- ---------- helper: one person's email, however they write it (Name+tag@Gmail.com = name@gmail.com)
create or replace function public.norm_email(e text) returns text
language sql immutable set search_path = public as $$
  select case when position('@' in x) = 0 then x
    else (case when split_part(x, '@', 2) in ('gmail.com', 'googlemail.com')
               then replace(split_part(split_part(x, '@', 1), '+', 1), '.', '')
               else split_part(split_part(x, '@', 1), '+', 1) end)
         || '@' || (case when split_part(x, '@', 2) = 'googlemail.com' then 'gmail.com' else split_part(x, '@', 2) end) end
  from (select lower(trim(coalesce(e, ''))) as x) s;
$$;
revoke all on function public.norm_email(text) from public, anon, authenticated;

-- Free mail domains never count as "the creator's company".
create or replace function public.free_mail(d text) returns boolean
language sql immutable set search_path = public as $$
  select lower(coalesce(d, '')) in ('gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com',
    'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'web.de', 'zoho.com', 'yandex.com', 'mail.com');
$$;
revoke all on function public.free_mail(text) from public, anon, authenticated;

-- ---------- 2. new team from a creator (040's function, with the stronger own-account check)
create or replace function public.team_referral() returns trigger
language plpgsql security definer set search_path = public as $$
declare meta jsonb; mail text; v_code text; c creators; own text;
begin
  select u.raw_user_meta_data, lower(u.email) into meta, mail from auth.users u where u.id = new.created_by;
  v_code := upper(nullif(trim(coalesce(meta ->> 'ref', '')), ''));
  if v_code is null or v_code !~ '^[A-Z0-9]{3,20}$' then return new; end if;
  select * into c from creators where creators.code = v_code and creators.status = 'active';
  if c.id is null then return new; end if;
  own := case when public.norm_email(c.email) = public.norm_email(mail) then 'The creator''s own account'
              when split_part(lower(c.email), '@', 2) = split_part(mail, '@', 2) and not public.free_mail(split_part(mail, '@', 2))
                then 'Same company email domain as the creator' end;
  insert into referrals (team_id, creator_id, source, status, blocked_reason)
  values (new.id, c.id, case when meta ->> 'ref_source' = 'code' then 'code' else 'link' end,
          case when own is null then 'ok' else 'blocked' end, own)
  on conflict (team_id) do nothing;
  return new;
exception when others then
  return new;
end $$;
revoke all on function public.team_referral() from public, anon, authenticated;

-- ---------- 3. Lemon Squeezy commission (040's function, safe against out-of-order refunds)
create or replace function public.ls_commission(payload text, signature text) returns text
language plpgsql security definer set search_path = public, vault, extensions as $$
declare
  secret text; body jsonb; a jsonb; ev text; inv text; t uuid; r referrals; c creators; base integer; test boolean; n integer;
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
    get diagnostics n = row_count;
    if n > 0 or exists (select 1 from commissions where invoice_id = inv) then return 'reversed'; end if;
  elsif coalesce(a ->> 'status', 'paid') <> 'paid' or coalesce(a ->> 'refunded', 'false') = 'true' then
    return 'not paid';
  end if;
  -- The team: by its subscription, else by the team id in the checkout link (the first payment can come first).
  select id into t from teams where ls_subscription_id = a ->> 'subscription_id' limit 1;
  if t is null then begin t := (body #>> '{meta,custom_data,team_id}')::uuid; exception when others then t := null; end; end if;
  if t is null then return 'no team'; end if;
  select * into r from referrals where team_id = t for update;
  if r.id is null then return 'no creator'; end if;
  select * into c from creators where id = r.creator_id;
  if ev = 'subscription_payment_refunded' then
    -- Refund before its payment: keep a 0-cent reversed row so the payment, when it arrives, is skipped.
    insert into commissions (referral_id, creator_id, invoice_id, paid_cents, commission_cents, rate, status, test_mode, reversed_at)
    values (r.id, c.id, inv, 0, 0, c.rate, 'reversed', test, now()) on conflict (invoice_id) do nothing;
    return 'reversed before payment';
  end if;
  if r.status = 'blocked' then return 'blocked referral'; end if;
  if c.status = 'ended' then return 'creator ended'; end if;
  if r.first_paid_at is not null and now() > r.first_paid_at + make_interval(months => c.months) then return 'commission period over'; end if;
  base := coalesce(nullif(a ->> 'total_usd', '')::integer, 0) - coalesce(nullif(a ->> 'tax_usd', '')::integer, 0);
  if base <= 0 then return 'nothing paid'; end if;
  insert into commissions (referral_id, creator_id, invoice_id, paid_cents, commission_cents, rate, test_mode)
  values (r.id, c.id, inv, base, round(base * c.rate / 100.0)::integer, c.rate, test)
  on conflict (invoice_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return 'already recorded'; end if;   -- a repeat, or a payment whose refund came first
  update referrals set first_paid_at = coalesce(first_paid_at, now()) where id = r.id;
  return 'commission recorded';
end $$;
revoke all on function public.ls_commission(text, text) from public;
grant execute on function public.ls_commission(text, text) to anon, authenticated;

-- ---------- Owner → Creators (040's function, plus every referred team so admins can check it)
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
        public.creator_money(c.id) as money,
        coalesce((select json_agg(y order by y.created_at desc) from (
          select r.id, r.created_at, r.source, r.status, r.blocked_reason, t.name as team, u.email as owner_email,
            case when t.plan <> 'trial' and t.paid_until > now() then 'paying' when t.trial_ends_at > now() then 'trial' else 'not paying' end as state
          from referrals r join teams t on t.id = r.team_id left join auth.users u on u.id = t.created_by
          where r.creator_id = c.id order by r.created_at desc limit 200) y), '[]'::json) as teams
      from creators c) x), '[]'::json),
    'applications', coalesce((select json_agg(a order by a.created_at desc) from (
      select id, name, email, link, audience, about, status, created_at from creator_applications order by created_at desc limit 200) a), '[]'::json));
end $$;
revoke all on function public.owner_creators() from public, anon;
grant execute on function public.owner_creators() to authenticated;

-- Block a referral the admin does not trust (own account, fake team). Unpaid commission is reversed; paid commission
-- becomes a clawback (taken off the creator's next payout). Returns how many commission rows changed.
create or replace function public.owner_referral_block(r_id uuid, reason text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update referrals set status = 'blocked', blocked_reason = left(coalesce(nullif(trim(reason), ''), 'Blocked by Kestrel'), 200) where id = r_id;
  if not found then raise exception 'Referral not found'; end if;
  update commissions set status = case when status = 'paid' then 'clawback' else 'reversed' end, reversed_at = now()
  where referral_id = r_id and status in ('pending', 'paid');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.owner_referral_block(uuid, text) from public, anon;
grant execute on function public.owner_referral_block(uuid, text) to authenticated;

-- ---------- 1. a creator's own page: only with a confirmed sign-in email (040's function otherwise)
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
  where lower(c.email) = (select lower(u.email) from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null)
    and c.status <> 'ended'
  limit 1;
$$;
revoke all on function public.my_creator() from public, anon;
grant execute on function public.my_creator() to authenticated;

notify pgrst, 'reload schema';
