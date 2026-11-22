-- Kestrel 063: the Bot room (Phase 4A, 19 Nov 2026). A group chat per team where Kestrel's bots (Research, Writer, QC,
-- Funnel) say what they did and hand work to each other with @mentions, and where people can write to them.
-- Bots post only through bot_post (server secret), so nobody can write as a bot. People post as themselves: the
-- database sets who and when. Nobody edits or deletes a message (an honest record, like the AI activity log).
-- Run once: node scripts/run-sql.mjs supabase/migrations/063_bot_room.sql  (safe to run again)

create table if not exists public.bot_messages (
  id          bigint generated always as identity primary key,
  team_id     uuid not null references public.teams (id) on delete cascade,
  author      text not null check (author in ('research', 'writer', 'qc', 'funnel', 'kestrel', 'person')),
  author_user uuid references auth.users (id) on delete set null,
  mentions    text[] not null default '{}' check (mentions <@ array['research', 'writer', 'qc', 'funnel', 'you']::text[]),
  lead_id     uuid references public.leads (id) on delete set null,
  kind        text not null default 'note' check (kind in ('note', 'handoff', 'finding', 'issue', 'fix', 'report', 'ask', 'approval')),
  text        text not null check (length(text) between 1 and 2000),
  meta        jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and length(meta::text) <= 4000),
  handled     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists bot_messages_team_time on public.bot_messages (team_id, created_at desc);
create index if not exists bot_messages_lead on public.bot_messages (lead_id) where lead_id is not null;
alter table public.bot_messages enable row level security;
revoke all on public.bot_messages from anon, authenticated;
grant select, insert on public.bot_messages to authenticated;
drop policy if exists "team reads bot room" on public.bot_messages;
create policy "team reads bot room" on public.bot_messages for select to authenticated using (public.is_member(team_id));
drop policy if exists "member writes in bot room" on public.bot_messages;
create policy "member writes in bot room" on public.bot_messages for insert to authenticated
  with check (public.can_edit(team_id) and author = 'person' and author_user = auth.uid() and kind in ('ask', 'note')
    and (lead_id is null or exists (select 1 from public.leads x where x.id = lead_id and x.team_id = bot_messages.team_id)));

-- People's messages: the database decides who wrote it and when, and that it is not handled yet.
create or replace function public.bot_messages_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.author := 'person'; new.author_user := auth.uid(); new.created_at := now(); new.handled := false;
    if new.kind not in ('ask', 'note') then new.kind := 'note'; end if;
    new.meta := '{}'::jsonb;
    -- A lead must be one of this team's leads (security review): otherwise it is dropped, so a person can never point
    -- at, or test for, another team's lead. Runs with the writer's rights, so other teams' leads are invisible here.
    if new.lead_id is not null and not exists (select 1 from leads x where x.id = new.lead_id and x.team_id = new.team_id) then new.lead_id := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists bot_messages_stamp on public.bot_messages;
create trigger bot_messages_stamp before insert on public.bot_messages for each row execute function public.bot_messages_stamp();

-- For the App's server only (the bots): post up to 50 messages for one team. A lead must belong to that team.
create or replace function public.bot_post(server_secret text, team uuid, msgs jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare m jsonb; n integer := 0; l uuid;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  if jsonb_typeof(msgs) <> 'array' or jsonb_array_length(msgs) > 50 then raise exception 'Up to 50 messages'; end if;
  for m in select * from jsonb_array_elements(msgs) loop
    l := case when (m ->> 'lead_id') ~* '^[0-9a-f-]{36}$' then (m ->> 'lead_id')::uuid end;
    if l is not null and not exists (select 1 from leads x where x.id = l and x.team_id = team) then l := null; end if;
    insert into bot_messages (team_id, author, mentions, lead_id, kind, text, meta)
    values (team, m ->> 'author',
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(m -> 'mentions', '[]'::jsonb)) x), '{}'),
      l, coalesce(m ->> 'kind', 'note'), left(m ->> 'text', 2000), coalesce(m -> 'meta', '{}'::jsonb));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.bot_post(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.bot_post(text, uuid, jsonb) to anon, authenticated;   -- checked by the server secret

notify pgrst, 'reload schema';
