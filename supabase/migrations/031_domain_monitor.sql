-- Kestrel Spam Guard, part B: daily blacklist and domain monitor (plan Outreach Engine/11-kestrel-spam-guard-plan.md).
-- Every sending domain of every team is checked about once a day by the mail timer (/api/mail/tick): public
-- blacklists for the domain (Spamhaus DBL, SURBL, URIBL), and for a private sending server its IP lists and reverse
-- DNS, plus the domain's age. A domain that becomes listed pauses that team's email accounts on it, with the reason.
-- Run once, after 030: node scripts/run-sql.mjs supabase/migrations/031_domain_monitor.sql  (safe to run again; only adds)

create table if not exists public.domain_monitor (
  team_id    uuid not null references public.teams (id) on delete cascade,
  domain     text not null check (length(domain) <= 253),
  checked_at timestamptz not null default now(),
  listed     boolean not null default false,
  results    jsonb not null default '{}'::jsonb check (pg_column_size(results) < 20000),
  primary key (team_id, domain)
);
alter table public.domain_monitor enable row level security;
revoke all on public.domain_monitor from anon, authenticated;
grant select on public.domain_monitor to authenticated;
drop policy if exists "team reads domain monitor" on public.domain_monitor;
create policy "team reads domain monitor" on public.domain_monitor for select to authenticated using (public.is_member(team_id));

-- For the timer: sending domains whose last check is older than a day (or never), oldest first, with one SMTP host.
create or replace function public.domain_monitor_due(server_secret text, max_n integer) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  return coalesce((select json_agg(x) from (
    select d.team_id, d.domain, d.smtp_host from (
      select distinct on (m.team_id, lower(split_part(m.email, '@', 2))) m.team_id, lower(split_part(m.email, '@', 2)) as domain, m.smtp_host
      from mailboxes m where m.status in ('ok', 'paused') and public.team_active(m.team_id)
      order by m.team_id, lower(split_part(m.email, '@', 2)), m.created_at) d
    left join domain_monitor dm on dm.team_id = d.team_id and dm.domain = d.domain
    where dm.checked_at is null or dm.checked_at < now() - interval '23 hours'
    order by dm.checked_at nulls first
    limit greatest(1, least(max_n, 5))) x), '[]'::json);
end $$;

-- Saves one check (timer or "Check now"). Only for a domain the team really sends from. When a domain becomes listed,
-- the team's email accounts on it are paused with the reason (they are not resumed by themselves).
create or replace function public.domain_monitor_report(server_secret text, team uuid, dom text, is_listed boolean, res jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare was boolean; names text; paused integer := 0;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  if not exists (select 1 from mailboxes m where m.team_id = team and lower(split_part(m.email, '@', 2)) = lower(dom)) then raise exception 'Not a sending domain of this team'; end if;
  select listed into was from domain_monitor where team_id = team and domain = lower(dom);
  insert into domain_monitor (team_id, domain, checked_at, listed, results) values (team, lower(dom), now(), coalesce(is_listed, false), coalesce(res, '{}'::jsonb))
    on conflict (team_id, domain) do update set checked_at = now(), listed = excluded.listed, results = excluded.results;
  if coalesce(is_listed, false) and not coalesce(was, false) then
    select string_agg(l ->> 'name', ', ') into names from jsonb_array_elements(coalesce(res -> 'lists', '[]'::jsonb)) l where l ->> 'status' = 'listed';
    update mailboxes set status = 'paused',
      last_error = left(format('Paused by Kestrel: %s is on a blacklist (%s). Stop sending from this domain, find the cause (bad list, spam complaints, a hacked site), ask the list to remove it, then resume.', lower(dom), coalesce(names, 'a public list')), 500)
      where team_id = team and lower(split_part(email, '@', 2)) = lower(dom) and status = 'ok';
    get diagnostics paused = row_count;
    insert into mail_events (team_id, mailbox_id, kind, detail)
      select team, m.id, 'paused', 'Email account auto-paused (domain on a blacklist)' from mailboxes m
      where m.team_id = team and lower(split_part(m.email, '@', 2)) = lower(dom) and m.status = 'paused' and m.last_error like 'Paused by Kestrel: % is on a blacklist%';
  end if;
  return json_build_object('ok', true, 'paused', paused);
end $$;

revoke all on function public.domain_monitor_due(text, integer), public.domain_monitor_report(text, uuid, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.domain_monitor_due(text, integer), public.domain_monitor_report(text, uuid, text, boolean, jsonb) to anon, authenticated;  -- checked by the server secret

notify pgrst, 'reload schema';
