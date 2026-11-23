-- Migration 073: Automations, Outside Bots (Discord & Telegram), and Client Workspaces (Phase 8, 19 Nov 2026)

-- 1. Automations table ("When X happens, do Y")
create table if not exists public.team_automations (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null references public.teams (id) on delete cascade,
  name              text not null,
  trigger_event     text not null check (trigger_event in ('hot_reply', 'bounce_high', 'credits_low', 'campaign_finished', 'daily_funnel', 'lead_won')),
  action_type       text not null check (action_type in ('alert_email', 'alert_discord', 'alert_telegram', 'pause_campaign', 'ai_draft')),
  target            text,
  is_active         boolean not null default true,
  last_triggered_at timestamptz,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists team_automations_team on public.team_automations (team_id, is_active);

alter table public.team_automations enable row level security;
revoke all on public.team_automations from anon, authenticated;
grant select, insert, update, delete on public.team_automations to authenticated;

drop policy if exists "team manages own automations" on public.team_automations;
create policy "team manages own automations" on public.team_automations
  for all to authenticated using (public.is_member(team_id)) with check (public.is_member(team_id));

-- 2. Outside bot webhook configurations
create table if not exists public.team_outside_bots (
  team_id           uuid primary key references public.teams (id) on delete cascade,
  discord_webhook   text,
  telegram_token    text,
  telegram_chat_id  text,
  notify_hot_reply  boolean not null default true,
  notify_stuck      boolean not null default true,
  notify_low_credit boolean not null default true,
  notify_funnel     boolean not null default false,
  updated_at        timestamptz not null default now()
);

alter table public.team_outside_bots enable row level security;
revoke all on public.team_outside_bots from anon, authenticated;
grant select, insert, update on public.team_outside_bots to authenticated;

drop policy if exists "team manages own outside bots" on public.team_outside_bots;
create policy "team manages own outside bots" on public.team_outside_bots
  for all to authenticated using (public.is_member(team_id)) with check (public.is_member(team_id));

-- 3. Client Workspaces & White-Label settings on teams
alter table public.teams add column if not exists white_label jsonb default '{}'::jsonb;
