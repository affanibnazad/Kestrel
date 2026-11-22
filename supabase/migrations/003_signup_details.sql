-- Kestrel: more details at sign-up (company website, team size, country, how they found us, job title)
-- and the plan picked on the Pricing page. Only adds columns; nothing is removed or renamed. Safe to run again.

alter table public.teams add column if not exists website    text;
alter table public.teams add column if not exists team_size  text;
alter table public.teams add column if not exists country    text;
alter table public.teams add column if not exists heard_from text;
alter table public.members add column if not exists job_title text;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta   jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  code   text := nullif(trim(meta ->> 'join_code'), '');
  person text := coalesce(nullif(trim(meta ->> 'full_name'), ''), split_part(new.email, '@', 1));
  firm   text := nullif(trim(meta ->> 'company'), '');
  terms  timestamptz := nullif(meta ->> 'accepted_terms_at', '')::timestamptz;
  job    text := left(nullif(trim(meta ->> 'job_title'), ''), 80);
  pick   text := case when meta ->> 'plan' in ('starter', 'pro', 'agency') then meta ->> 'plan' end;
  t      uuid;
begin
  if code is not null then
    select id into t from teams where join_code = code;
  end if;
  if t is not null then
    insert into members (team_id, user_id, role, full_name, email, accepted_terms_at, job_title)
    values (t, new.id, 'researcher', person, new.email, terms, job) on conflict do nothing;
  else
    insert into teams (name, created_by, chosen_plan, website, team_size, country, heard_from)
    values (coalesce(firm, person || '''s team'), new.id, pick,
            left(nullif(trim(meta ->> 'website'), ''), 200), left(nullif(trim(meta ->> 'team_size'), ''), 20),
            left(nullif(trim(meta ->> 'country'), ''), 80), left(nullif(trim(meta ->> 'heard_from'), ''), 80))
    returning id into t;
    insert into members (team_id, user_id, role, full_name, email, accepted_terms_at, job_title)
    values (t, new.id, 'owner', person, new.email, terms, job);
  end if;
  return new;
end $$;

-- my_account also returns the new details.
create or replace function public.my_account() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'team_id', t.id, 'team_name', t.name, 'role', m.role, 'full_name', m.full_name, 'job_title', m.job_title,
    'plan', t.plan, 'chosen_plan', t.chosen_plan, 'trial_ends_at', t.trial_ends_at,
    'website', t.website, 'team_size', t.team_size, 'country', t.country,
    'join_code', case when m.role in ('owner', 'manager') then t.join_code end,
    'members', (select json_agg(json_build_object('name', x.full_name, 'email', x.email, 'role', x.role, 'joined_at', x.joined_at) order by x.joined_at)
                from members x where x.team_id = t.id)
  )
  from members m join teams t on t.id = m.team_id
  where m.user_id = auth.uid()
  order by m.joined_at limit 1;
$$;
revoke all on function public.my_account() from public, anon;
grant execute on function public.my_account() to authenticated;

notify pgrst, 'reload schema';
