-- Kestrel 058: the end of the pipeline on each lead (Phase 1, 18 Nov 2026): Meeting, Won (with the deal value) or Lost
-- (with the reason), saved in leads.data.result by one checked function, so it never overwrites the rest of the lead.
-- When the lead has a conversation in Replies, its reply status follows (won / lost / meeting), so both places agree.
-- Run once: node scripts/run-sql.mjs supabase/migrations/058_lead_results.sql  (safe to run again)

create or replace function public.set_lead_result(lead uuid, result text, deal_value numeric default null, currency text default null, reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare l leads; r text := lower(trim(coalesce(result, ''))); cur text := upper(trim(coalesce(currency, ''))); why text := left(regexp_replace(trim(coalesce(reason, '')), '\s+', ' ', 'g'), 120);
begin
  select * into l from leads where id = lead;
  if l.id is null or not public.can_edit(l.team_id) then raise exception 'Lead not found'; end if;
  if r = '' then
    update leads set data = coalesce(data, '{}'::jsonb) - 'result' where id = l.id;
    return;
  end if;
  if r not in ('meeting', 'won', 'lost') then raise exception 'Unknown result'; end if;
  if deal_value is not null and (deal_value < 0 or deal_value > 100000000) then raise exception 'The deal value must be between 0 and 100,000,000'; end if;
  if cur <> '' and cur !~ '^[A-Z]{3}$' then raise exception 'Currency: three letters, for example USD'; end if;
  update leads set data = jsonb_set(coalesce(data, '{}'::jsonb), '{result}', jsonb_strip_nulls(jsonb_build_object(
      'stage', r,
      'value', case when r = 'won' then round(deal_value, 2) end,
      'currency', case when r = 'won' and deal_value is not null then coalesce(nullif(cur, ''), 'USD') end,
      'reason', case when r = 'lost' then nullif(why, '') end,
      'at', now(), 'by', auth.uid())))
    where id = l.id;
  -- The newest conversation with this lead shows the same status in Replies.
  update campaign_leads set stage = r, stage_at = now()
    where id = (select x.id from campaign_leads x where x.lead_id = l.id and x.team_id = l.team_id order by x.first_sent_at desc nulls last, x.id desc limit 1);
end $$;
revoke all on function public.set_lead_result(uuid, text, numeric, text, text) from public, anon;
grant execute on function public.set_lead_result(uuid, text, numeric, text, text) to authenticated;   -- checks can_edit()

notify pgrst, 'reload schema';
