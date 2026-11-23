-- Migration 072: Team Files & Media Generation (Phase 7, 19 Nov 2026)
-- Saved images and videos generated in chat or uploaded, paid in team credits.

-- Expand team_credit_ledger action types for image and video generation
alter table public.team_credit_ledger drop constraint if exists team_credit_ledger_action_check;
alter table public.team_credit_ledger add constraint team_credit_ledger_action_check
  check (action in ('research', 'write', 'qc', 'funnel', 'find_email', 'topup', 'grant', 'monthly_reset', 'image_gen', 'video_gen'));

create table if not exists public.team_files (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  user_id     uuid references auth.users (id) on delete set null,
  kind        text not null check (kind in ('image', 'video', 'document', 'audio')),
  title       text not null,
  prompt      text,
  model       text,
  url         text not null,
  mime_type   text,
  size_bytes  bigint default 0,
  metadata    jsonb default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists team_files_team_created on public.team_files (team_id, created_at desc);
create index if not exists team_files_team_kind on public.team_files (team_id, kind);

alter table public.team_files enable row level security;
revoke all on public.team_files from anon, authenticated;
grant select, insert on public.team_files to authenticated;
grant delete on public.team_files to authenticated;

drop policy if exists "team reads own files" on public.team_files;
create policy "team reads own files" on public.team_files
  for select to authenticated using (public.is_member(team_id));

drop policy if exists "team creates own files" on public.team_files;
create policy "team creates own files" on public.team_files
  for insert to authenticated with check (public.is_member(team_id));

drop policy if exists "team deletes own files" on public.team_files;
create policy "team deletes own files" on public.team_files
  for delete to authenticated using (public.is_member(team_id));

create or replace function public.save_team_file(
  p_kind text,
  p_title text,
  p_prompt text,
  p_model text,
  p_url text,
  p_mime text default 'image/png',
  p_size bigint default 0,
  p_metadata jsonb default '{}'::jsonb
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := public.my_team_id(false);
  v_user_id uuid := auth.uid();
  v_row public.team_files;
begin
  if v_team_id is null then raise exception 'Not signed in'; end if;
  if p_kind not in ('image', 'video', 'document', 'audio') then
    raise exception 'Invalid kind';
  end if;

  insert into public.team_files (
    team_id, user_id, kind, title, prompt, model, url, mime_type, size_bytes, metadata, created_at
  ) values (
    v_team_id, v_user_id, p_kind, p_title, p_prompt, p_model, p_url, p_mime, p_size, p_metadata, now()
  ) returning * into v_row;

  return json_build_object(
    'id', v_row.id,
    'team_id', v_row.team_id,
    'kind', v_row.kind,
    'title', v_row.title,
    'prompt', v_row.prompt,
    'model', v_row.model,
    'url', v_row.url,
    'mime_type', v_row.mime_type,
    'size_bytes', v_row.size_bytes,
    'created_at', v_row.created_at
  );
end $$;

grant execute on function public.save_team_file(text, text, text, text, text, text, bigint, jsonb) to authenticated;
