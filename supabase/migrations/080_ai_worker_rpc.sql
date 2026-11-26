-- 080_ai_worker_rpc.sql
-- Security definer RPCs for /api/mail/tick AI job worker (no auth.uid() in cron context).
-- Gated by mail_server_ok(server_secret) and always scoped to p_team_id.

begin;

create or replace function public.ai_job_context(
  server_secret text,
  p_team_id uuid,
  p_lead_id uuid,
  p_offer_id uuid default null,
  p_sequence_id uuid default null
) returns json
language plpgsql
stable
security definer
set search_path = public, vault
as $$
declare
  ai public.team_ai;
  prov text;
begin
  if not public.mail_server_ok(server_secret) or p_team_id is null or p_lead_id is null then
    raise exception 'Not allowed';
  end if;

  if not public.team_active(p_team_id) then
    return null;
  end if;

  select * into ai from public.team_ai where team_id = p_team_id;
  prov := coalesce(ai.provider, 'anthropic');

  return json_build_object(
    'lead', (
      select row_to_json(x) from (
        select l.id, l.team_id, l.email, l.website, l.data, l.outreach_approved
        from public.leads l
        where l.id = p_lead_id and l.team_id = p_team_id
      ) x
    ),
    'offer', (
      select row_to_json(o)
      from public.offer_profiles o
      where o.team_id = p_team_id
        and (p_offer_id is null or o.id = p_offer_id)
      order by o.name
      limit 1
    ),
    'sequence', (
      select s.steps
      from public.sequences s
      where s.team_id = p_team_id and s.id = p_sequence_id
    ),
    'settings', row_to_json(ai),
    'about', (
      select row_to_json(ab)
      from public.team_about ab
      where ab.team_id = p_team_id
    ),
    'team_plan', (
      select json_build_object(
        'plan', t.plan,
        'paid_until', t.paid_until,
        'access_until', t.access_until,
        'access_plan', t.access_plan
      )
      from public.teams t
      where t.id = p_team_id
    ),
    'key', (
      select s.decrypted_secret
      from public.team_keys k
      join vault.decrypted_secrets s on s.id = k.secret_id
      where k.team_id = p_team_id and k.service = prov
      limit 1
    ),
    'dnc_too_long', (select count(*) > 50000 from public.do_not_contact where team_id = p_team_id),
    'dnc', (
      select coalesce(json_agg(d.entry), '[]'::json)
      from (
        select entry
        from public.do_not_contact
        where team_id = p_team_id
        order by entry
        limit 50000
      ) d
    )
  );
end $$;

create or replace function public.ai_job_save_lead(
  server_secret text,
  p_team_id uuid,
  p_lead_id uuid,
  p_patch jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.mail_server_ok(server_secret) or p_team_id is null or p_lead_id is null then
    raise exception 'Not allowed';
  end if;

  if jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Bad patch';
  end if;

  update public.leads set
    verdict = case when p_patch ->> 'verdict' in ('Good', 'Maybe', 'No') then p_patch ->> 'verdict' else verdict end,
    reason = case when p_patch ? 'reason' then left(p_patch ->> 'reason', 500) else reason end,
    score = case when p_patch ? 'score' and jsonb_typeof(p_patch -> 'score') = 'number' then (p_patch ->> 'score')::numeric else score end,
    outreach_approved = case when p_patch ? 'outreach_approved' then coalesce((p_patch ->> 'outreach_approved')::boolean, outreach_approved) else outreach_approved end,
    matched_service_id = case when p_patch ? 'matched_service_id' then nullif(p_patch ->> 'matched_service_id', '')::uuid else matched_service_id end,
    buying_trigger = case when p_patch ? 'buying_trigger' then left(nullif(p_patch ->> 'buying_trigger', ''), 200) else buying_trigger end,
    email = case when p_patch ? 'email' then nullif(p_patch ->> 'email', '') else email end,
    website = case when p_patch ? 'website' then nullif(p_patch ->> 'website', '') else website end,
    named = case when p_patch ? 'named' then coalesce((p_patch ->> 'named')::boolean, named) else named end,
    data = case when jsonb_typeof(p_patch -> 'data') = 'object' then coalesce(data, '{}'::jsonb) || (p_patch -> 'data') else data end,
    updated_at = now()
  where id = p_lead_id and team_id = p_team_id;
end $$;

revoke all on function public.ai_job_context(text, uuid, uuid, uuid, uuid),
  public.ai_job_save_lead(text, uuid, uuid, jsonb)
  from public, anon, authenticated;

grant execute on function public.ai_job_context(text, uuid, uuid, uuid, uuid),
  public.ai_job_save_lead(text, uuid, uuid, jsonb)
  to anon, authenticated;

notify pgrst, 'reload schema';
commit;
