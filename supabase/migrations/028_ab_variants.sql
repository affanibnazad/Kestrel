-- Kestrel Mail M2 part 2: A/B/C subject tests. Each lead's written emails already carry its variant letter
-- (steps[].variant, set when the AI writes them; see src/lib/sequence.ts). This adds the numbers per variant for the
-- campaign's Analytics tab: leads, started, replied, positive (Interested, Meeting booked, Won), bounced, unsubscribed.
-- Read-only; team members only. Run once, after 027: node scripts/run-sql.mjs supabase/migrations/028_ab_variants.sql

create or replace function public.campaign_variant_stats(campaign uuid) returns json
language sql stable security definer set search_path = public as $$
  select case when not exists (select 1 from campaigns c where c.id = campaign and public.is_member(c.team_id)) then null else
    coalesce((select json_agg(r order by r.variant) from (
      select coalesce(jsonb_path_query_first(cl.steps, '$[*].variant') #>> '{}', 'none') as variant,   -- 'none' = written before the test
        count(*) as leads,
        count(*) filter (where cl.first_sent_at is not null) as started,
        count(*) filter (where exists (select 1 from mail_replies m where m.campaign_lead_id = cl.id and m.kind = 'reply')) as replied,
        count(*) filter (where cl.stage in ('interested', 'meeting', 'won')) as positive,
        count(*) filter (where cl.status = 'bounced') as bounced,
        count(*) filter (where cl.status = 'unsubscribed') as unsubscribed
      from campaign_leads cl where cl.campaign_id = campaign
      group by 1) r), '[]'::json) end;
$$;
revoke all on function public.campaign_variant_stats(uuid) from public, anon;
grant execute on function public.campaign_variant_stats(uuid) to authenticated;

notify pgrst, 'reload schema';
