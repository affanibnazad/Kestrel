-- Kestrel Mail, organised like the leading tools: lead status in the Unibox (Interested, Meeting booked, …) and
-- numbers per campaign step for the campaign Analytics tab.
-- Run once, after 019: node scripts/run-sql.mjs supabase/migrations/020_unibox.sql  (safe to run again; only adds)

alter table public.campaign_leads add column if not exists stage text
  check (stage is null or stage in ('interested', 'meeting', 'not_now', 'not_interested', 'wrong_person', 'won', 'lost'));
alter table public.campaign_leads add column if not exists stage_at timestamptz;
grant select (stage, stage_at) on public.campaign_leads to authenticated;

-- Set a conversation's lead status (anyone who can work on the team's leads; also after the trial).
create or replace function public.set_lead_stage(cl uuid, stage text) returns void
language plpgsql security definer set search_path = public as $$
declare l campaign_leads;
begin
  select * into l from campaign_leads where id = cl;
  if l.id is null or not public.can_block(l.team_id) then raise exception 'Conversation not found'; end if;
  if stage is not null and stage not in ('interested', 'meeting', 'not_now', 'not_interested', 'wrong_person', 'won', 'lost') then raise exception 'Unknown status'; end if;
  update campaign_leads set stage = set_lead_stage.stage, stage_at = now() where id = l.id;
  -- "Not interested" also stops anything still planned for this person.
  if stage = 'not_interested' then update campaign_leads set status = 'stopped', next_at = null where id = l.id and status = 'active'; end if;
end $$;

-- One campaign's numbers per step (for the Analytics tab): sent, replies, bounces, unsubscribes, opened (people).
create or replace function public.campaign_step_stats(campaign uuid) returns json
language sql stable security definer set search_path = public as $$
  select case when not exists (select 1 from campaigns c where c.id = campaign and public.is_member(c.team_id)) then null else
    coalesce((select json_agg(r order by r.step) from (
      select e.step,
        count(*) filter (where e.kind = 'sent') as sent,
        count(*) filter (where e.kind = 'replied') as replies,
        count(*) filter (where e.kind = 'bounced') as bounced,
        count(*) filter (where e.kind = 'unsubscribed') as unsubscribed,
        count(distinct e.campaign_lead_id) filter (where e.kind = 'opened') as opened
      from mail_events e where e.campaign_id = campaign and e.step is not null group by e.step) r), '[]'::json) end;
$$;

revoke all on function public.set_lead_stage(uuid, text), public.campaign_step_stats(uuid) from public, anon, authenticated;
grant execute on function public.set_lead_stage(uuid, text), public.campaign_step_stats(uuid) to authenticated;

notify pgrst, 'reload schema';
