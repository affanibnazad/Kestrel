-- Kestrel Mail M2, sending engine (part 1):
-- * Lead time zone: each campaign lead gets a time zone guessed from the lead's location and address (US states,
--   Canadian provinces, Australian states, then the country). With "Send in each lead's time zone" on (new campaigns),
--   emails go out inside the sending hours of the lead's own time zone; unknown → the campaign's time zone.
-- * Company-wide stop: when someone at a company replies or asks to be removed, the team's other active leads at that
--   company (same email domain) stop. Never for free email providers (gmail.com, outlook.com…). Per campaign, on by default.
-- Existing campaigns keep their old behaviour for the time zone (off); new campaigns have both on.
-- Run once, after 025: node scripts/run-sql.mjs supabase/migrations/026_sending_engine.sql  (safe to run again; only adds)

-- ---------- campaign options
alter table public.campaigns add column if not exists lead_time_zone boolean not null default false;
alter table public.campaigns alter column lead_time_zone set default true;   -- existing campaigns stay off, new ones on
alter table public.campaigns add column if not exists stop_company boolean not null default true;
grant insert (lead_time_zone, stop_company) on public.campaigns to authenticated;
grant update (lead_time_zone, stop_company) on public.campaigns to authenticated;

-- ---------- the lead's time zone
alter table public.campaign_leads add column if not exists time_zone text check (time_zone is null or length(time_zone) <= 60);
grant select (time_zone) on public.campaign_leads to authenticated;

-- Guess an IANA time zone from a place text such as "Hartford, Connecticut, United States" or an address
-- "…, Austin, TX 78701, United States". Returns null when unsure. Only returns names PostgreSQL knows.
create or replace function public.guess_time_zone(place text) returns text
language plpgsql stable set search_path = public as $$
declare p text := ' ' || lower(coalesce(place, '')) || ' '; tz text; r record;
begin
  if length(trim(p)) = 0 then return null; end if;
  -- United States: state names, or a 2-letter state before a ZIP code.
  if p ~ '\m(united states|usa)\M' or p ~ '\mu\.s\.(a\.)?' or p ~ '\m[a-z]{2} \d{5}(-\d{4})?\M' then
    for r in select * from (values
      ('connecticut|maine|massachusetts|new hampshire|new jersey|new york|pennsylvania|rhode island|vermont|delaware|florida|georgia|maryland|north carolina|south carolina|virginia|west virginia|ohio|michigan|indiana|kentucky|district of columbia|washington,? dc|\m(ct|me|ma|nh|nj|ny|pa|ri|vt|de|fl|ga|md|nc|sc|va|wv|oh|mi|in|ky|dc) \d{5}', 'America/New_York'),
      ('illinois|iowa|kansas|minnesota|missouri|nebraska|north dakota|south dakota|wisconsin|alabama|arkansas|louisiana|mississippi|oklahoma|tennessee|texas|\m(il|ia|ks|mn|mo|ne|nd|sd|wi|al|ar|la|ms|ok|tn|tx) \d{5}', 'America/Chicago'),
      ('arizona|\maz \d{5}', 'America/Phoenix'),
      ('colorado|idaho|montana|new mexico|utah|wyoming|\m(co|id|mt|nm|ut|wy) \d{5}', 'America/Denver'),
      ('california|nevada|oregon|washington|\m(ca|nv|or|wa) \d{5}', 'America/Los_Angeles'),
      ('alaska|\mak \d{5}', 'America/Anchorage'),
      ('hawaii|\mhi \d{5}', 'Pacific/Honolulu')
    ) as v(pat, zone) loop
      if p ~ ('\m(' || r.pat || ')\M') then tz := r.zone; exit; end if;
    end loop;
    tz := coalesce(tz, case when p ~ '\m(united states|usa)\M' then 'America/New_York' end);
  elsif p ~ '\mcanada\M' then
    tz := case when p ~ '\malberta\M' then 'America/Edmonton' when p ~ '\mbritish columbia\M' then 'America/Vancouver'
      when p ~ '\mmanitoba\M' then 'America/Winnipeg' when p ~ '\msaskatchewan\M' then 'America/Regina'
      when p ~ '\mnewfoundland\M' then 'America/St_Johns' when p ~ '\m(nova scotia|prince edward island)\M' then 'America/Halifax'
      when p ~ '\mnew brunswick\M' then 'America/Moncton' else 'America/Toronto' end;
  elsif p ~ '\maustralia\M' then
    tz := case when p ~ '\mqueensland\M' then 'Australia/Brisbane' when p ~ '\msouth australia\M' then 'Australia/Adelaide'
      when p ~ '\mnorthern territory\M' then 'Australia/Darwin' when p ~ '\mwestern australia\M' then 'Australia/Perth'
      when p ~ '\mtasmania\M' then 'Australia/Hobart' when p ~ '\mvictoria\M' then 'Australia/Melbourne' else 'Australia/Sydney' end;
  else
    for r in select * from (values
      ('united kingdom|england|scotland|wales|northern ireland|\muk\M', 'Europe/London'), ('ireland', 'Europe/Dublin'), ('new zealand', 'Pacific/Auckland'),
      ('italy|italia', 'Europe/Rome'), ('germany|deutschland', 'Europe/Berlin'), ('netherlands|nederland', 'Europe/Amsterdam'), ('sweden|sverige', 'Europe/Stockholm'),
      ('denmark|danmark', 'Europe/Copenhagen'), ('norway|norge', 'Europe/Oslo'), ('finland|suomi', 'Europe/Helsinki'), ('switzerland|schweiz|suisse', 'Europe/Zurich'),
      ('austria|österreich', 'Europe/Vienna'), ('belgium|belgique|belgië', 'Europe/Brussels'), ('france', 'Europe/Paris'), ('spain|españa', 'Europe/Madrid'),
      ('portugal', 'Europe/Lisbon'), ('poland|polska', 'Europe/Warsaw'), ('czech', 'Europe/Prague'), ('greece', 'Europe/Athens'), ('turkey|türkiye', 'Europe/Istanbul'),
      ('singapore', 'Asia/Singapore'), ('united arab emirates|\muae\M|dubai|abu dhabi', 'Asia/Dubai'), ('saudi arabia', 'Asia/Riyadh'), ('qatar', 'Asia/Qatar'),
      ('israel', 'Asia/Jerusalem'), ('india', 'Asia/Kolkata'), ('pakistan', 'Asia/Karachi'), ('bangladesh', 'Asia/Dhaka'), ('sri lanka', 'Asia/Colombo'),
      ('japan', 'Asia/Tokyo'), ('south korea|\mkorea\M', 'Asia/Seoul'), ('china', 'Asia/Shanghai'), ('hong kong', 'Asia/Hong_Kong'), ('taiwan', 'Asia/Taipei'),
      ('malaysia', 'Asia/Kuala_Lumpur'), ('philippines', 'Asia/Manila'), ('indonesia', 'Asia/Jakarta'), ('thailand', 'Asia/Bangkok'), ('vietnam', 'Asia/Ho_Chi_Minh'),
      ('south africa', 'Africa/Johannesburg'), ('nigeria', 'Africa/Lagos'), ('kenya', 'Africa/Nairobi'), ('egypt', 'Africa/Cairo'), ('morocco', 'Africa/Casablanca'),
      ('mexico|méxico', 'America/Mexico_City'), ('brazil|brasil', 'America/Sao_Paulo'), ('argentina', 'America/Argentina/Buenos_Aires'), ('chile', 'America/Santiago'),
      ('colombia', 'America/Bogota'), ('peru', 'America/Lima')
    ) as v(pat, zone) loop
      if p ~ ('\m(' || r.pat || ')\M') then tz := r.zone; exit; end if;
    end loop;
  end if;
  if tz is not null and not exists (select 1 from pg_timezone_names n where n.name = tz) then return null; end if;
  return tz;
end $$;
revoke all on function public.guess_time_zone(text) from public, anon;
grant execute on function public.guess_time_zone(text) to authenticated;

-- Fill a new campaign lead's time zone from its lead (location first, then address), when the lead is added.
create or replace function public.campaign_lead_time_zone() returns trigger
language plpgsql security definer set search_path = public as $$
declare loc text; adr text;
begin
  if new.time_zone is null and new.lead_id is not null then
    select l.location, l.data ->> 'address' into loc, adr from leads l where l.id = new.lead_id;
    new.time_zone := coalesce(public.guess_time_zone(loc), public.guess_time_zone(adr));
  end if;
  return new;
end $$;
revoke all on function public.campaign_lead_time_zone() from public, anon, authenticated;
drop trigger if exists campaign_leads_time_zone on public.campaign_leads;
create trigger campaign_leads_time_zone before insert on public.campaign_leads for each row execute function public.campaign_lead_time_zone();

-- ---------- company-wide stop
create or replace function public.stop_company_on_reply() returns trigger
language plpgsql security definer set search_path = public as $$
declare dom text; touched uuid[];
begin
  if new.kind not in ('reply', 'remove') then return new; end if;
  dom := lower(split_part(coalesce(nullif(new.lead_email, ''), new.from_email), '@', 2));
  -- Free email providers: one person replying says nothing about anyone else on the same provider.
  if dom = '' or dom in ('gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.uk',
    'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'web.de', 'mail.com', 'zoho.com',
    'yandex.com', 'qq.com', '163.com', 'btinternet.com', 'sky.com', 'virginmedia.com', 'comcast.net', 'verizon.net', 'att.net') then
    return new;
  end if;
  update campaign_leads x set status = 'stopped', next_at = null,
    last_error = left('Stopped: someone at ' || dom || ' replied in another conversation', 500)
  from campaigns c
  where c.id = x.campaign_id and c.stop_company
    and x.team_id = new.team_id and x.status = 'active' and x.id is distinct from new.campaign_lead_id
    and lower(split_part(x.to_email, '@', 2)) = dom;
  -- A campaign left with nobody to email is finished (the same rule as after a reply in that campaign).
  select array_agg(distinct x.campaign_id) into touched from campaign_leads x
    where x.team_id = new.team_id and x.status = 'stopped' and x.last_error like 'Stopped: someone at ' || dom || ' replied%';
  if touched is not null then
    update campaigns c set status = 'done' where c.id = any (touched) and c.status = 'running'
      and not exists (select 1 from campaign_leads y where y.campaign_id = c.id and y.status = 'active');
  end if;
  return new;
end $$;
revoke all on function public.stop_company_on_reply() from public, anon, authenticated;
drop trigger if exists mail_replies_stop_company on public.mail_replies;
create trigger mail_replies_stop_company after insert on public.mail_replies for each row execute function public.stop_company_on_reply();

-- ---------- the sending timer, same as 019 except the sending-hours check (lead time zone)
create or replace function public.mail_due(server_secret text, max_n integer) returns json
language plpgsql security definer set search_path = public, vault as $$
declare out jsonb := '[]'::jsonb; b record; l record; pw text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  for b in
    select m.* from mailboxes m
    where m.status = 'ok' and coalesce(m.next_send_at, '-infinity') <= now()
      and public.team_active(m.team_id)
      and public.mailbox_warm(m)
      and (select count(*) from mail_events e where e.mailbox_id = m.id and e.kind = 'sent' and e.at > now() - interval '24 hours') < public.mailbox_limit_today(m)
    order by coalesce(m.next_send_at, '-infinity')
    for update skip locked
  loop
    exit when jsonb_array_length(out) >= greatest(1, least(max_n, 20));
    select cl.*, c.time_zone, c.track_opens, c.verify_emails, t.tracking_domain, t.tracking_ok into l
    from campaign_leads cl join campaigns c on c.id = cl.campaign_id join teams t on t.id = cl.team_id
    where cl.mailbox_id = b.id and cl.status = 'active' and cl.next_at <= now() and coalesce(cl.locked_until, '-infinity') < now()
      and c.status = 'running'
      -- M2: the lead's own time zone when the campaign asks for it (and Kestrel could tell it), else the campaign's.
      and extract(hour from now() at time zone coalesce(case when c.lead_time_zone then cl.time_zone end, c.time_zone)) >= c.window_start
      and extract(hour from now() at time zone coalesce(case when c.lead_time_zone then cl.time_zone end, c.time_zone)) < c.window_end
      and (not c.weekdays_only or extract(isodow from now() at time zone coalesce(case when c.lead_time_zone then cl.time_zone end, c.time_zone)) < 6)
    order by cl.next_step desc, cl.next_at
    limit 1 for update of cl skip locked;
    continue when l.id is null;
    -- Do-not-contact may have changed since the start.
    if public.dnc_blocks_email(l.team_id, l.to_email) then
      update campaign_leads set status = 'blocked', next_at = null where id = l.id;
      insert into mail_events (team_id, campaign_id, campaign_lead_id, mailbox_id, step, kind, detail) values (l.team_id, l.campaign_id, l.id, b.id, l.next_step, 'blocked', 'On Do-not-contact');
      continue;
    end if;
    -- Claimed for 6 hours: if the server sent but could not report back, the email is not sent again soon.
    update campaign_leads set locked_until = now() + interval '6 hours' where id = l.id;
    update mailboxes set next_send_at = now() + interval '3 minutes' where id = b.id;
    select decrypted_secret into pw from vault.decrypted_secrets where id = b.secret_id;
    out := out || jsonb_build_array(jsonb_build_object(
      'id', l.id, 'step', l.next_step, 'steps_total', jsonb_array_length(l.steps), 'to', l.to_email,
      'subject', l.steps -> l.next_step ->> 'subject', 'body', l.steps -> l.next_step ->> 'body',
      'thread_id', l.thread_id, 'first_sent_at', l.first_sent_at, 'unsub_token', l.unsub_token,
      -- Open tracking only with the team's own checked tracking domain (never a shared one).
      'track', case when l.track_opens and l.tracking_ok and l.tracking_domain is not null
        then jsonb_build_object('domain', l.tracking_domain, 'token', l.open_token) end,
      -- Verify the address before the first email (Hunter, the team's key), when the campaign asks for it.
      'verify_key', case when l.verify_emails and l.next_step = 0 then (select s.decrypted_secret from team_keys k join vault.decrypted_secrets s on s.id = k.secret_id
        where k.team_id = l.team_id and k.service = 'hunter') end,
      'box', jsonb_build_object('id', b.id, 'email', b.email, 'from_name', b.from_name, 'smtp_host', b.smtp_host, 'smtp_port', b.smtp_port,
        'imap_host', b.imap_host, 'imap_port', b.imap_port, 'username', b.username, 'password', pw)));
  end loop;
  return out;
end $$;

revoke all on function public.mail_due(text, integer) from public, anon, authenticated;
grant execute on function public.mail_due(text, integer) to anon, authenticated;  -- checked by the server secret (as in 016/019)

notify pgrst, 'reload schema';
