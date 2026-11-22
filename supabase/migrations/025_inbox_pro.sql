-- Kestrel Mail M3, Inbox Pro: AI reply labels, notes, assign to a teammate, snooze.
-- * AI labels are written only by the App's server (needs Kestrel's server secret) for a signed-in member of the team.
--   When the conversation has no lead status yet, a clear label also sets it (Interested, Meeting booked, Not now,
--   Not interested, Wrong person). A status a person chose is never changed. Word-rule labels never set a status.
-- * Notes, assignee and snooze live on the conversation (campaign_leads) and are changed through set_conversation.
-- Run once, after 024: node scripts/run-sql.mjs supabase/migrations/025_inbox_pro.sql  (safe to run again; only adds)

-- ---------- AI reply labels
alter table public.mail_replies add column if not exists ai_label text
  check (ai_label is null or ai_label in ('interested', 'meeting', 'not_now', 'not_interested', 'out_of_office', 'wrong_person', 'unsubscribe', 'other'));
alter table public.mail_replies add column if not exists ai_reason text check (ai_reason is null or length(ai_reason) <= 200);
alter table public.mail_replies add column if not exists ai_by text check (ai_by is null or length(ai_by) <= 40);   -- model id, or 'rules'
alter table public.mail_replies add column if not exists ai_at timestamptz;
grant select (ai_label, ai_reason, ai_by, ai_at) on public.mail_replies to authenticated;

create or replace function public.set_reply_label(server_secret text, reply_id uuid, label text, reason text, by_model text) returns void
language plpgsql security definer set search_path = public as $$
declare r mail_replies; st text;
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
end $$;
revoke all on function public.set_reply_label(text, uuid, text, text, text) from public, anon;
grant execute on function public.set_reply_label(text, uuid, text, text, text) to authenticated;

-- ---------- notes, assignee, snooze on each conversation
alter table public.campaign_leads add column if not exists note text check (note is null or length(note) <= 2000);
alter table public.campaign_leads add column if not exists assigned_to uuid references auth.users (id) on delete set null;
alter table public.campaign_leads add column if not exists snoozed_until timestamptz;
grant select (note, assigned_to, snoozed_until) on public.campaign_leads to authenticated;

-- Change a conversation's note, assignee or snooze. Same people who can set the lead status (can_block).
-- Each argument is applied only when its "set_" flag is true, so one call can change one thing.
create or replace function public.set_conversation(cl uuid, set_note boolean, note text, set_assignee boolean, assignee uuid, set_snooze boolean, snooze_until timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare l campaign_leads;
begin
  select * into l from campaign_leads where id = cl;
  if l.id is null or not public.can_block(l.team_id) then raise exception 'Conversation not found'; end if;
  if set_assignee and assignee is not null and not exists (select 1 from members m where m.team_id = l.team_id and m.user_id = assignee) then
    raise exception 'That person is not in your team';
  end if;
  if set_snooze and snooze_until is not null and (snooze_until < now() - interval '1 minute' or snooze_until > now() + interval '366 days') then
    raise exception 'Choose a snooze time within the next year';
  end if;
  update campaign_leads set
    note = case when set_note then left(nullif(trim(coalesce(set_conversation.note, '')), ''), 2000) else campaign_leads.note end,
    assigned_to = case when set_assignee then set_conversation.assignee else campaign_leads.assigned_to end,
    snoozed_until = case when set_snooze then set_conversation.snooze_until else campaign_leads.snoozed_until end
  where id = l.id;
end $$;
revoke all on function public.set_conversation(uuid, boolean, text, boolean, uuid, boolean, timestamptz) from public, anon;
grant execute on function public.set_conversation(uuid, boolean, text, boolean, uuid, boolean, timestamptz) to authenticated;

-- The people in my team with their user id (for "Assign to"). Members only see their own team.
create or replace function public.team_people() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', x.user_id, 'name', x.full_name, 'email', x.email) order by x.joined_at), '[]'::json)
  from members x where x.team_id = public.my_team_id(false);
$$;
revoke all on function public.team_people() from public, anon;
grant execute on function public.team_people() to authenticated;

notify pgrst, 'reload schema';
