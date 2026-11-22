-- Kestrel 042: Autopilot that really runs (plan: Outreach Engine/13-kestrel-autopilot-plan.md).
-- A team saves one goal: who to find (keywords × places), its offer, sequence and campaign, and how many leads a day.
-- * The connected extension reads the goal (ext_autopilot) and runs the searches still left (team progress skips done ones).
-- * Every 10 minutes the database calls the App's server (/api/autopilot/tick, with the server secret, like the mail timer).
--   For each team with Autopilot on and an active plan, the server works a few new leads: find email → score → write.
--   Nothing is ever sent here: leads that are ready wait for the team's OK on the Autopilot page.
-- The server has no signed-in person: the ap_* functions check the server secret themselves (014 mail_server_ok).
-- Run once, after 041: node scripts/run-sql.mjs supabase/migrations/042_autopilot.sql  (safe to run again)

-- ---------- 1. the goal (one per team) and the run history
create table if not exists public.autopilot (
  team_id      uuid primary key references public.teams (id) on delete cascade,
  is_on        boolean not null default false,
  goal         jsonb not null default '{}'::jsonb check (jsonb_typeof(goal) = 'object'),
  run_day      date,
  done_today   integer not null default 0,
  last_run_at  timestamptz,
  last_note    text,
  updated_by   uuid references auth.users (id) on delete set null,
  updated_at   timestamptz not null default now()
);
create table if not exists public.autopilot_runs (
  id       uuid primary key default gen_random_uuid(),
  team_id  uuid not null references public.teams (id) on delete cascade,
  at       timestamptz not null default now(),
  worked   integer not null default 0,
  emails   integer not null default 0,
  scored   integer not null default 0,
  good     integer not null default 0,
  written  integer not null default 0,
  note     text check (length(note) <= 500)
);
create index if not exists autopilot_runs_team on public.autopilot_runs (team_id, at desc);
alter table public.autopilot enable row level security;
alter table public.autopilot_runs enable row level security;
revoke all on public.autopilot, public.autopilot_runs from anon, authenticated;
grant select on public.autopilot, public.autopilot_runs to authenticated;
drop policy if exists "team reads autopilot" on public.autopilot;
create policy "team reads autopilot" on public.autopilot for select to authenticated using (public.is_member(team_id));
drop policy if exists "team reads autopilot runs" on public.autopilot_runs;
create policy "team reads autopilot runs" on public.autopilot_runs for select to authenticated using (public.is_member(team_id));

-- ---------- 2. save the goal (owners and managers). Everything is checked and cleaned here.
create or replace function public.autopilot_save(goal jsonb, turn_on boolean) returns json
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id(true); g jsonb := coalesce(goal, '{}'::jsonb); kw jsonb; pl jsonb; v_offer uuid; v_seq text; v_camp uuid; n integer;
begin
  if t is null then raise exception 'Only the owner or a manager can change Autopilot.'; end if;
  if turn_on and not public.team_active(t) then raise exception 'PLAN_NEEDED: Your free trial has ended. Choose a plan to run Autopilot.'; end if;
  select coalesce(jsonb_agg(left(trim(x), 80)), '[]'::jsonb) into kw from (select distinct trim(x) as x from jsonb_array_elements_text(case when jsonb_typeof(g -> 'keywords') = 'array' then g -> 'keywords' else '[]' end) x where length(trim(x)) > 1 limit 50) s;
  select coalesce(jsonb_agg(left(trim(x), 120)), '[]'::jsonb) into pl from (select distinct trim(x) as x from jsonb_array_elements_text(case when jsonb_typeof(g -> 'places') = 'array' then g -> 'places' else '[]' end) x where length(trim(x)) > 1 limit 300) s;
  begin v_offer := nullif(g ->> 'offer_id', '')::uuid; exception when others then v_offer := null; end;
  if v_offer is not null and not exists (select 1 from offer_profiles o where o.id = v_offer and o.team_id = t) then v_offer := null; end if;
  v_seq := coalesce(nullif(g ->> 'sequence', ''), 'default');
  if v_seq <> 'default' and v_seq <> 'none' and not exists (select 1 from sequences s where s.id::text = v_seq and s.team_id = t) then v_seq := 'default'; end if;
  begin v_camp := nullif(g ->> 'campaign_id', '')::uuid; exception when others then v_camp := null; end;
  if v_camp is not null and not exists (select 1 from campaigns c where c.id = v_camp and c.team_id = t) then v_camp := null; end if;
  n := least(300, greatest(5, coalesce(nullif(g ->> 'per_day', '')::integer, 50)));
  if turn_on and v_offer is null then raise exception 'Choose your offer first: Autopilot scores and writes for it.'; end if;
  insert into autopilot (team_id, is_on, goal, updated_by, updated_at)
  values (t, coalesce(turn_on, false), jsonb_build_object(
      'keywords', kw, 'places', pl, 'source', case when g ->> 'source' = 'osm' then 'osm' else 'maps' end, 'per_day', n,
      'offer_id', v_offer, 'sequence', v_seq, 'campaign_id', v_camp,
      'only_good', coalesce((g ->> 'only_good')::boolean, true), 'find_emails', coalesce((g ->> 'find_emails')::boolean, true)),
    auth.uid(), now())
  on conflict (team_id) do update set is_on = excluded.is_on, goal = excluded.goal, updated_by = excluded.updated_by, updated_at = now();
  return (select json_build_object('is_on', a.is_on, 'goal', a.goal) from autopilot a where a.team_id = t);
end $$;
revoke all on function public.autopilot_save(jsonb, boolean) from public, anon;
grant execute on function public.autopilot_save(jsonb, boolean) to authenticated;

-- ---------- 3. the extension: the searches the goal asks for (only while the plan is active: ext_owner checks)
create or replace function public.ext_autopilot(k text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare r extension_keys;
begin
  r := public.ext_owner(k);
  return (select json_build_object('on', a.is_on, 'source', a.goal ->> 'source', 'keywords', a.goal -> 'keywords', 'places', a.goal -> 'places')
          from autopilot a where a.team_id = r.team_id);
end $$;
revoke all on function public.ext_autopilot(text) from public;
grant execute on function public.ext_autopilot(text) to anon, authenticated;

-- ---------- 3b. the extension sending a business again must not wipe the App's work on it (004's function, merged):
-- the App's AI fit, written emails, found emails and Autopilot mark stay; the extension's newer collected details come in.
create or replace function public.ext_push_leads(k text, rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare r extension_keys; n integer;
begin
  r := ext_owner(k);
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 500 then raise exception 'Send between 1 and 500 leads at a time'; end if;
  insert into leads as l (team_id, dedupe_key, name, category, location, source, email, phone, website, verdict, reason, score, tier, hiring, named, sample, data, created_by)
  select r.team_id, x.dedupe_key, x.name, x.category, x.location, x.source, x.email, x.phone, x.website,
         case when x.verdict in ('Good', 'Maybe', 'No') then x.verdict end, x.reason, x.score, x.tier,
         coalesce(x.hiring, false), coalesce(x.named, false), false, coalesce(x.data, '{}'::jsonb), r.user_id
  from jsonb_to_recordset(rows) as x(dedupe_key text, name text, category text, location text, source text, email text, phone text, website text,
       verdict text, reason text, score numeric, tier text, hiring boolean, named boolean, data jsonb)
  where coalesce(x.dedupe_key, '') <> ''
  on conflict (team_id, dedupe_key) do update set
    name = excluded.name, category = excluded.category, location = excluded.location, source = excluded.source,
    email = coalesce(l.email, excluded.email), phone = coalesce(excluded.phone, l.phone), website = coalesce(excluded.website, l.website),
    verdict = coalesce(l.verdict, excluded.verdict), reason = case when l.verdict is not null then l.reason else excluded.reason end,
    score = case when l.email is not null and excluded.email is null then l.score else excluded.score end,
    tier = case when l.email is not null and excluded.email is null then l.tier else excluded.tier end,
    hiring = excluded.hiring, named = l.named or excluded.named,
    data = excluded.data
      || case when l.email is not null and excluded.email is null
           then jsonb_strip_nulls(jsonb_build_object('email', l.data -> 'email', 'emails', l.data -> 'emails', 'emailKind', l.data -> 'emailKind', 'contacts', l.data -> 'contacts'))
           else '{}'::jsonb end
      || jsonb_strip_nulls(jsonb_build_object('ai', l.data -> 'ai', 'outreach', l.data -> 'outreach', 'ap', l.data -> 'ap',
           'hunterAt', l.data -> 'hunterAt', 'foundBy', l.data -> 'foundBy'));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.ext_push_leads(text, jsonb) from public;
grant execute on function public.ext_push_leads(text, jsonb) to anon, authenticated;

-- ---------- 4. the server's daily run (server secret only)
-- Teams with work left today, the ones that waited longest first.
create or replace function public.ap_due(server_secret text) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  return coalesce((select json_agg(x) from (
    select a.team_id, a.goal,
      (a.goal ->> 'per_day')::integer - case when a.run_day = current_date then a.done_today else 0 end as left_today
    from autopilot a
    where a.is_on and public.team_active(a.team_id)
      and (a.run_day is distinct from current_date or a.done_today < (a.goal ->> 'per_day')::integer)
    order by a.last_run_at nulls first limit 5) x), '[]'::json);
end $$;

-- Everything one team's run needs: offer, sender, model, sequence, rules, keys, Do-not-contact, and the next new leads.
-- A lead is worked once (data.ap is set afterwards); never removed leads, sample leads or anyone already in a campaign.
create or replace function public.ap_context(server_secret text, team uuid, max_leads integer) returns json
language plpgsql stable security definer set search_path = public, vault as $$
declare g jsonb; ai team_ai; prov text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select goal into g from autopilot where team_id = team and is_on;
  if g is null then return null; end if;
  select * into ai from team_ai where team_id = team;
  prov := coalesce(ai.provider, 'anthropic');
  return json_build_object(
    'goal', g,
    'offer', (select row_to_json(o) from offer_profiles o where o.id = (g ->> 'offer_id')::uuid and o.team_id = team),
    'settings', row_to_json(ai),
    'sequence', (select s.steps from sequences s where s.id::text = g ->> 'sequence' and s.team_id = team),
    'rules', (select json_build_object('weights', r.weights, 'tiers', r.tiers, 'rules', r.rules, 'refine', r.refine) from team_rules r where r.team_id = team),
    'keys', (select coalesce(json_object_agg(k.service, s.decrypted_secret), '{}'::json) from team_keys k join vault.decrypted_secrets s on s.id = k.secret_id
             where k.team_id = team and k.service in (prov, 'hunter', 'apollo', 'findymail')),
    'provider', prov,
    -- Do-not-contact in full; a list too long to send makes the run stop for this team (fail closed).
    'dnc_too_long', (select count(*) > 50000 from do_not_contact where team_id = team),
    'dnc', (select coalesce(json_agg(d.entry), '[]'::json) from (select entry from do_not_contact where team_id = team order by entry limit 50000) d),
    'leads', (select coalesce(json_agg(x), '[]'::json) from (
      select l.id, l.name, l.website, l.email, l.verdict, l.data from leads l
      where l.team_id = team and l.status <> 'removed' and not l.sample
        -- never worked, or a step was stopped (missing key, no credits) and its retry time has come
        and (not (l.data ? 'ap') or (not (l.data -> 'ap' ? 'at') and coalesce((l.data -> 'ap' ->> 'retryAt')::numeric, 0) < extract(epoch from now()) * 1000))
        and not exists (select 1 from campaign_leads c where c.lead_id = l.id)
      order by l.created_at desc limit least(20, greatest(1, max_leads))) x));
end $$;

-- Save one lead's results (only these columns, only in this team).
create or replace function public.ap_save_lead(server_secret text, team uuid, lead uuid, patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  if jsonb_typeof(patch) <> 'object' or jsonb_typeof(patch -> 'data') <> 'object' then raise exception 'Bad patch'; end if;
  update leads set
    email   = case when patch ? 'email' then nullif(patch ->> 'email', '') else email end,
    website = case when patch ? 'website' then nullif(patch ->> 'website', '') else website end,
    named   = case when patch ? 'named' then coalesce((patch ->> 'named')::boolean, named) else named end,
    score   = case when patch ? 'score' then (patch ->> 'score')::numeric else score end,
    tier    = case when patch ? 'tier' then patch ->> 'tier' else tier end,
    verdict = case when patch ->> 'verdict' in ('Good', 'Maybe', 'No') then patch ->> 'verdict' else verdict end,
    reason  = case when patch ? 'reason' then left(patch ->> 'reason', 500) else reason end,
    data    = coalesce(data, '{}'::jsonb) || (patch -> 'data'),
    updated_at = now()
  where id = lead and team_id = team;
end $$;

-- One run done: history row and today's counter.
create or replace function public.ap_finish(server_secret text, team uuid, worked integer, emails integer, scored integer, good integer, written integer, note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  -- A history row when something was done, or when the problem note is new (not one row every 10 minutes for the same problem).
  if worked > 0 or (note is not null and note is distinct from (select a.last_note from autopilot a where a.team_id = team)) then
    insert into autopilot_runs (team_id, worked, emails, scored, good, written, note)
    values (team, greatest(0, worked), greatest(0, emails), greatest(0, scored), greatest(0, good), greatest(0, written), left(note, 500));
  end if;
  update autopilot set
    done_today = case when run_day = current_date then done_today else 0 end + greatest(0, worked),
    run_day = current_date, last_run_at = now(), last_note = left(note, 500)
  where team_id = team;
  delete from autopilot_runs where team_id = team and at < now() - interval '60 days';
end $$;

revoke all on function public.ap_due(text), public.ap_context(text, uuid, integer), public.ap_save_lead(text, uuid, uuid, jsonb),
  public.ap_finish(text, uuid, integer, integer, integer, integer, integer, text) from public, anon, authenticated;
-- The timer's server call has no signed-in person: these check the server secret instead.
grant execute on function public.ap_due(text), public.ap_context(text, uuid, integer), public.ap_save_lead(text, uuid, uuid, jsonb),
  public.ap_finish(text, uuid, integer, integer, integer, integer, integer, text) to anon, authenticated;

-- ---------- 5. the timer: every 10 minutes while any team has Autopilot on
do $$ begin
  if exists (select 1 from cron.job where jobname = 'kestrel-autopilot-tick') then perform cron.unschedule('kestrel-autopilot-tick'); end if;
  perform cron.schedule('kestrel-autopilot-tick', '*/10 * * * *', $job$
    select net.http_post(
      url := 'https://kestrelleads.com/api/autopilot/tick',
      headers := jsonb_build_object('content-type', 'application/json',
        'x-kestrel-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'kestrel:mail-server-secret' limit 1)),
      body := '{}'::jsonb, timeout_milliseconds := 58000)
    where exists (select 1 from public.autopilot where is_on);
  $job$);
end $$;

notify pgrst, 'reload schema';
