-- Kestrel 039: fixes from the full audit of 13 Nov 2026 (security, billing, email rules, tasks, speed).
-- Run once: node scripts/run-sql.mjs supabase/migrations/039_audit_fixes.sql  (safe to run again)
-- Publish right after running it: /api/ai now reads the AI key with the server secret.

-- ---------- 1. teams: members may read only the columns the App needs.
-- Before, any member (also a viewer) could read the whole row from the browser: the join code, the Lemon Squeezy
-- customer portal link and the subscription ids. The App reads teams only through security-definer functions.
alter table public.teams add column if not exists billing_event_at timestamptz;
revoke select on public.teams from authenticated, anon;
grant select (id, name, plan, chosen_plan, trial_ends_at, created_at, paid_until, billing_status, website, team_size, country,
  tracking_domain, tracking_ok, tracking_checked_at) on public.teams to authenticated;

-- ---------- 2. Lemon Squeezy webhook.
-- a) Test-mode events are ignored unless Affan turns them on (Vault secret kestrel:billing-allow-test = 'yes'):
--    the store is in test mode, so anyone could otherwise unlock a paid plan with the published test card.
-- b) An event for a different subscription than the team's current, still-running one is ignored
--    (the team id in the checkout link can be set by anyone).
-- c) Events older than the last one applied are ignored (Lemon Squeezy retries can arrive late).
create or replace function public.ls_webhook(payload text, signature text) returns text
language plpgsql security definer set search_path = public, vault, extensions as $$
declare
  secret text; body jsonb; a jsonb; ev text; t uuid; p text; st text; until timestamptz; cur teams; sub text; at timestamptz;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'kestrel:lemonsqueezy-webhook' limit 1;
  if secret is null then raise exception 'Payments are not set up yet'; end if;
  if signature is null or encode(extensions.hmac(convert_to(payload, 'UTF8'), convert_to(secret, 'UTF8'), 'sha256'), 'hex') <> lower(signature) then
    raise exception 'Bad signature';
  end if;
  body := payload::jsonb;
  ev := body #>> '{meta,event_name}';
  if ev not like 'subscription_%' then return 'ignored'; end if;
  if coalesce((body #>> '{meta,test_mode}')::boolean, false)
     and not exists (select 1 from vault.decrypted_secrets where name = 'kestrel:billing-allow-test' and decrypted_secret = 'yes') then
    return 'test mode ignored';
  end if;
  a := body #> '{data,attributes}';
  begin t := (body #>> '{meta,custom_data,team_id}')::uuid; exception when others then t := null; end;
  if t is null then return 'no team'; end if;
  select plan into p from billing_plans where variant_id = a ->> 'variant_id';
  if p is null then return 'unknown variant'; end if;
  select * into cur from teams where id = t for update;
  if cur.id is null then return 'no team'; end if;
  sub := body #>> '{data,id}';
  if cur.ls_subscription_id is not null and sub is not null and cur.ls_subscription_id <> sub
     and cur.billing_status in ('active', 'on_trial', 'past_due') and cur.paid_until > now() then
    return 'other subscription ignored';
  end if;
  begin at := (a ->> 'updated_at')::timestamptz; exception when others then at := null; end;
  if at is not null and cur.billing_event_at is not null and at < cur.billing_event_at and cur.ls_subscription_id = sub then
    return 'older event ignored';
  end if;
  st := a ->> 'status';
  -- active / on_trial / past_due: paid until the next renewal. cancelled: paid until it ends. expired / unpaid: over now.
  until := case when st in ('active', 'on_trial', 'past_due') then coalesce((a ->> 'renews_at')::timestamptz, now() + interval '31 days')
                when st = 'cancelled' then coalesce((a ->> 'ends_at')::timestamptz, now())
                else now() end;
  update teams set plan = case when st in ('expired', 'unpaid') then plan else p end, chosen_plan = p, paid_until = until, billing_status = st,
    ls_subscription_id = coalesce(sub, ls_subscription_id), ls_customer_id = coalesce(a ->> 'customer_id', ls_customer_id),
    billing_portal = coalesce(a #>> '{urls,customer_portal}', billing_portal), billing_event_at = coalesce(at, now())
  where id = t;
  return 'ok';
end $$;
revoke all on function public.ls_webhook(text, text) from public;
grant execute on function public.ls_webhook(text, text) to anon, authenticated;

-- ---------- 3. Team keys only for the App's server (the server secret), never straight to a browser.
-- Before, any researcher could read the team's AI and Hunter keys in plain text from the browser console.
create or replace function public.ai_key_for_server(server_secret text, service text) returns text
language plpgsql stable security definer set search_path = public, vault as $$
declare t uuid; v text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  if service not in ('anthropic', 'openai', 'gemini', 'openrouter') then raise exception 'Not an AI service'; end if;
  select m.team_id into t from members m where m.user_id = auth.uid() and m.role in ('owner', 'manager', 'researcher') order by m.joined_at limit 1;
  if t is null then raise exception 'Only people who can change leads can use AI'; end if;
  if not public.team_active(t) then raise exception 'PLAN_NEEDED: Your free trial has ended. Choose a plan to keep using AI.'; end if;
  select s.decrypted_secret into v from team_keys k join vault.decrypted_secrets s on s.id = k.secret_id where k.team_id = t and k.service = ai_key_for_server.service;
  return v;
end $$;
revoke all on function public.ai_key_for_server(text, text) from public, anon;
grant execute on function public.ai_key_for_server(text, text) to authenticated;
-- The old one-argument versions stay for nobody (the Hunter key comes from finder_keys_for_server since 037).
revoke all on function public.ai_key_for_server(text) from public, anon, authenticated;
revoke all on function public.source_key_for_server(text) from public, anon, authenticated;

-- ---------- 4. Every written email is checked on the server before it joins a campaign.
-- The App checks in the browser, but Autopilot's Approve and any direct call skipped it. An email step must have the
-- opt-out line, no [FIELD] left unfilled, and no price, payment or money words (the class rules).
create or replace function public.email_steps_problem(steps jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare s jsonb; txt text; i integer := 0;
begin
  if jsonb_typeof(steps) <> 'array' then return null; end if;
  for s in select value from jsonb_array_elements(steps) loop
    i := i + 1;
    continue when coalesce(s ->> 'kind', 'email') <> 'email';
    txt := coalesce(s ->> 'subject', '') || E'\n' || coalesce(s ->> 'body', '');
    if txt !~* '(not interested|reply (with )?["''“]?no\M|unsubscribe|opt[- ]?out|rather not|won''?t (email|contact|write)|remove you|no more emails)' then
      return format('email %s has no opt-out line', i);
    end if;
    if txt ~ '\[[A-Z][A-Z_]{2,}\]' or txt ~ '\{\{|\}\}' then return format('email %s still has an empty merge field', i); end if;
    if txt ~* '[$€£¥][[:space:]]?[0-9]|\m[0-9]+([.,][0-9]+)?[[:space:]]?(usd|eur|gbp|dollars?|euros?|pounds?)\M' then
      return format('email %s mentions a money amount', i);
    end if;
    if txt ~* '\m(price|prices|pricing|priced|fee|fees|rate card|per hour|per month|per video|per minute|invoice|payment|payments|discount|cheap|cheapest|affordable|trial|free trial|for free|free work|free sample|free test|no charge|money back|refund)\M'
       or txt ~* '% off' then
      return format('email %s has price or payment words', i);
    end if;
  end loop;
  return null;
end $$;
revoke all on function public.email_steps_problem(jsonb) from public, anon, authenticated;

-- A lead whose emails fail is left out (counted as skipped by start_campaign / campaign_add_leads); the others still start.
create or replace function public.campaign_leads_check_emails() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.email_steps_problem(new.steps) is not null then return null; end if;
  return new;
end $$;
revoke all on function public.campaign_leads_check_emails() from public, anon, authenticated;
drop trigger if exists campaign_leads_check_emails on public.campaign_leads;
create trigger campaign_leads_check_emails before insert on public.campaign_leads for each row execute function public.campaign_leads_check_emails();

-- ---------- 5. An AI "unsubscribe" label in the Unibox now works like a "remove me" reply:
-- Do-not-contact, every active campaign to that address stopped, open tasks closed.
create or replace function public.set_reply_label(server_secret text, reply_id uuid, label text, reason text, by_model text) returns void
language plpgsql security definer set search_path = public as $$
declare r mail_replies; st text; who text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into r from mail_replies where id = reply_id;
  if r.id is null or not public.is_member(r.team_id) then raise exception 'Reply not found'; end if;
  if label not in ('interested', 'meeting', 'not_now', 'not_interested', 'out_of_office', 'wrong_person', 'unsubscribe', 'other') then raise exception 'Unknown label'; end if;
  -- The first label wins (two open tabs may label the same reply at once).
  if r.ai_label is not null then return; end if;
  update mail_replies set ai_label = label, ai_reason = left(nullif(trim(coalesce(reason, '')), ''), 200), ai_by = left(coalesce(by_model, ''), 40), ai_at = now()
    where id = r.id and ai_label is null;
  if not found then return; end if;
  -- Fill the conversation's lead status only when nobody has set one, and only from the AI (word rules are a rough guess).
  st := case when coalesce(by_model, '') <> 'rules' and label in ('interested', 'meeting', 'not_now', 'not_interested', 'wrong_person') then label end;
  if st is not null and r.campaign_lead_id is not null then
    update campaign_leads set stage = st, stage_at = now() where id = r.campaign_lead_id and stage is null;
  end if;
  who := lower(coalesce(nullif(r.lead_email, ''), r.from_email));
  if label = 'unsubscribe' and coalesce(by_model, '') <> 'rules' and who ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    insert into do_not_contact (team_id, entry, reason) values (r.team_id, who, 'Asked to be removed (reply, AI label)') on conflict do nothing;
    update campaign_leads set status = 'unsubscribed', next_at = null where team_id = r.team_id and to_email = who and status = 'active';
    update campaign_tasks set state = 'cancelled' where team_id = r.team_id and to_email = who and state = 'open';
  end if;
end $$;
revoke all on function public.set_reply_label(text, uuid, text, text, text) from public, anon;
grant execute on function public.set_reply_label(text, uuid, text, text, text) to authenticated;

-- ---------- 6. Webhooks: a "remove me" reply sent lead.unsubscribed twice (the reply and the unsubscribed event).
-- The event from mail_events is kept (it also covers the unsubscribe link).
create or replace function public.integration_on_reply() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text := case new.kind when 'reply' then 'reply.received' when 'bounce' then 'email.bounced' end;
begin
  if ev is null then return new; end if;
  perform public.integration_enqueue(new.team_id, ev, jsonb_build_object('event', ev, 'at', coalesce(new.received_at, now()),
    'lead', coalesce(public.integration_lead(new.campaign_lead_id), jsonb_build_object('email', coalesce(new.lead_email, new.from_email))),
    'reply', jsonb_build_object('subject', new.subject, 'snippet', left(new.snippet, 500), 'from', new.from_email)));
  return new;
exception when others then return new;   -- an integration must never block reading replies
end $$;

-- Delivery: at most 2 items per team per run (one busy team cannot hold up everyone), items of switched-off webhooks or
-- locked teams are closed instead of sent, and old delivered rows are cleaned once an hour instead of every minute.
create or replace function public.integration_due(server_secret text, max_n integer, only_id bigint default null) returns json
language plpgsql security definer set search_path = public, vault as $$
declare out json;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  if extract(minute from now()) = 0 then delete from integration_outbox where done and created_at < now() - interval '30 days'; end if;
  update integration_outbox o set done = true, ok = false, locked_until = null
  where not o.done and o.next_at <= now() and (not public.team_active(o.team_id)
    or (o.target = 'webhook' and not exists (select 1 from team_webhooks w where w.id = o.hook_id and w.active)));
  with ranked as (
    select o.id, row_number() over (partition by o.team_id order by o.next_at, o.id) as rn from integration_outbox o
    where not o.done and o.next_at <= now() and (o.locked_until is null or o.locked_until < now()) and (only_id is null or o.id = only_id)
  ), picked as (
    select o.id from integration_outbox o join ranked r on r.id = o.id
    where r.rn <= 2 or only_id is not null
    order by o.next_at limit greatest(1, least(max_n, 25)) for update of o skip locked
  ), locked as (
    update integration_outbox o set locked_until = now() + interval '2 minutes' from picked where o.id = picked.id returning o.*
  )
  select coalesce(json_agg(json_build_object('id', l.id, 'target', l.target, 'event', l.event, 'payload', l.payload, 'tries', l.tries,
    'url', w.url, 'secret', case when l.target = 'webhook' then (select decrypted_secret from vault.decrypted_secrets where id = w.secret_id)
      else (select s.decrypted_secret from team_keys k join vault.decrypted_secrets s on s.id = k.secret_id where k.team_id = l.team_id and k.service = l.target) end)), '[]'::json)
  into out
  from locked l left join team_webhooks w on w.id = l.hook_id;
  return out;
end $$;
revoke all on function public.integration_due(text, integer, bigint) from public, anon;
grant execute on function public.integration_due(text, integer, bigint) to anon, authenticated;   -- checked by the server secret

-- ---------- 7. Manual tasks are closed for anyone who replied, asked to be removed, bounced or is on Do-not-contact,
-- also when the task was the last step (the lead is then already "done", so the timer's own check missed it).
create or replace function public.campaign_tasks_close_on_reply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('reply', 'remove', 'bounce') then
    update campaign_tasks t set state = 'cancelled'
    where t.state = 'open' and t.team_id = new.team_id
      and (t.campaign_lead_id = new.campaign_lead_id
        or (new.kind in ('remove', 'bounce') and t.to_email = lower(coalesce(nullif(new.lead_email, ''), new.from_email))));
  end if;
  return new;
exception when others then return new;   -- never block reading replies
end $$;
revoke all on function public.campaign_tasks_close_on_reply() from public, anon, authenticated;
drop trigger if exists campaign_tasks_close_on_reply on public.mail_replies;
create trigger campaign_tasks_close_on_reply after insert on public.mail_replies for each row execute function public.campaign_tasks_close_on_reply();

create or replace function public.campaign_tasks_close_on_dnc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update campaign_tasks t set state = 'cancelled'
  where t.state = 'open' and t.team_id = new.team_id and t.to_email is not null
    and (t.to_email = new.entry or split_part(t.to_email, '@', 2) = new.entry or split_part(t.to_email, '@', 2) like '%.' || new.entry);
  return new;
end $$;
revoke all on function public.campaign_tasks_close_on_dnc() from public, anon, authenticated;
drop trigger if exists campaign_tasks_close_on_dnc on public.do_not_contact;
create trigger campaign_tasks_close_on_dnc after insert on public.do_not_contact for each row execute function public.campaign_tasks_close_on_dnc();

-- A cancelled task stays cancelled (it was closed because of a reply or Do-not-contact).
create or replace function public.complete_task(task_id uuid, outcome text) returns void
language plpgsql security definer set search_path = public as $$
declare t campaign_tasks;
begin
  if outcome not in ('done', 'skipped', 'open') then raise exception 'Unknown outcome'; end if;
  select * into t from campaign_tasks where id = task_id;
  if t.id is null or not public.can_edit(t.team_id) then raise exception 'Task not found'; end if;
  if t.state = 'cancelled' then raise exception 'This task was closed because the lead replied, asked to be removed or is on Do-not-contact.'; end if;
  update campaign_tasks set state = outcome, done_at = case when outcome = 'open' then null else now() end,
    done_by = case when outcome = 'open' then null else auth.uid() end
  where id = task_id;
end $$;
revoke all on function public.complete_task(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_task(uuid, text) to authenticated;

-- ---------- 8. Indexes for the mail timer, deleting campaigns and the lead timeline (they scanned whole tables).
create index if not exists campaign_leads_box_due on public.campaign_leads (mailbox_id, next_at) where status = 'active';
create index if not exists campaign_leads_box_first on public.campaign_leads (mailbox_id, first_sent_at desc);
create index if not exists campaign_leads_team_email on public.campaign_leads (team_id, to_email);
create index if not exists campaign_leads_lead on public.campaign_leads (lead_id);
create index if not exists mail_events_campaign_lead on public.mail_events (campaign_lead_id);
create index if not exists mail_replies_campaign_lead on public.mail_replies (campaign_lead_id);
create index if not exists campaign_tasks_lead on public.campaign_tasks (lead_id);
create index if not exists campaign_tasks_team_email on public.campaign_tasks (team_id, to_email) where state = 'open';
create index if not exists list_leads_lead on public.list_leads (lead_id);
create index if not exists list_leads_team on public.list_leads (team_id);
create index if not exists integration_outbox_done_created on public.integration_outbox (created_at) where done;

notify pgrst, 'reload schema';
