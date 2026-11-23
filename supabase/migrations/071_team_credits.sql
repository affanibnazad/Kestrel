-- Migration 071: Team Credits & Usage Control (Phase 6, 19 Nov 2026)
-- Credit balances, token tracking, and AI credit ledger per team.

create table if not exists public.team_credits (
  team_id           uuid primary key references public.teams (id) on delete cascade,
  balance           integer not null default 1000,
  monthly_allowance integer not null default 1000,
  used_this_month   integer not null default 0,
  reset_at          timestamptz not null default (now() + interval '30 days'),
  updated_at        timestamptz not null default now()
);

create table if not exists public.team_credit_ledger (
  id          bigint generated always as identity primary key,
  team_id     uuid not null references public.teams (id) on delete cascade,
  action      text not null check (action in ('research', 'write', 'qc', 'funnel', 'find_email', 'topup', 'grant', 'monthly_reset')),
  amount      integer not null,
  lead_id     uuid references public.leads (id) on delete set null,
  detail      text check (length(detail) <= 500),
  by          text,
  created_at  timestamptz not null default now()
);

create index if not exists team_credit_ledger_team on public.team_credit_ledger (team_id, created_at desc);

alter table public.team_credits enable row level security;
alter table public.team_credit_ledger enable row level security;

revoke all on public.team_credits from anon, authenticated;
revoke all on public.team_credit_ledger from anon, authenticated;

grant select on public.team_credits to authenticated;
grant select on public.team_credit_ledger to authenticated;

drop policy if exists "team reads own credits" on public.team_credits;
create policy "team reads own credits" on public.team_credits
  for select to authenticated using (public.is_member(team_id));

drop policy if exists "team reads own credit ledger" on public.team_credit_ledger;
create policy "team reads own credit ledger" on public.team_credit_ledger
  for select to authenticated using (public.is_member(team_id));

-- Resolve or initialize team credits
create or replace function public.get_team_credits() returns json
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := public.my_team_id(false);
  v_plan text;
  v_allowance integer := 1000;
  v_row public.team_credits;
begin
  if v_team_id is null then raise exception 'Not signed in'; end if;

  select * into v_row from public.team_credits where team_id = v_team_id;

  if v_row.team_id is null then
    select plan into v_plan from public.teams where id = v_team_id;
    v_allowance := case
      when v_plan = 'agency' then 35000
      when v_plan = 'pro' then 10000
      when v_plan = 'starter' then 2500
      else 1000
    end;

    insert into public.team_credits (team_id, balance, monthly_allowance, used_this_month, reset_at)
    values (v_team_id, v_allowance, v_allowance, 0, now() + interval '30 days')
    returning * into v_row;
  end if;

  return json_build_object(
    'team_id', v_row.team_id,
    'balance', v_row.balance,
    'monthly_allowance', v_row.monthly_allowance,
    'used_this_month', v_row.used_this_month,
    'reset_at', v_row.reset_at
  );
end $$;

-- Deduct or grant credits (server only)
create or replace function public.use_team_credits(
  server_secret text,
  p_team_id uuid,
  p_action text,
  p_amount integer,
  p_lead_id uuid default null,
  p_detail text default null,
  p_by text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_row public.team_credits;
  v_new_balance integer;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;

  select * into v_row from public.team_credits where team_id = p_team_id for update;
  if v_row.team_id is null then
    insert into public.team_credits (team_id, balance, monthly_allowance, used_this_month, reset_at)
    values (p_team_id, 1000, 1000, 0, now() + interval '30 days')
    returning * into v_row;
  end if;

  v_new_balance := v_row.balance - p_amount;
  if v_new_balance < 0 then
    return json_build_object('ok', false, 'error', 'Insufficient credits', 'balance', v_row.balance);
  end if;

  update public.team_credits set
    balance = v_new_balance,
    used_this_month = v_row.used_this_month + p_amount,
    updated_at = now()
  where team_id = p_team_id;

  insert into public.team_credit_ledger (
    team_id, action, amount, lead_id, detail, by, created_at
  ) values (
    p_team_id, p_action, p_amount, p_lead_id, p_detail, p_by, now()
  );

  return json_build_object('ok', true, 'balance', v_new_balance);
end $$;

grant execute on function public.get_team_credits() to authenticated;
grant execute on function public.use_team_credits(text, uuid, text, integer, uuid, text, text) to authenticated;
