-- Kestrel: which account sees which workspace? READ ONLY (19 Nov 2026). The 5 most recent sign-ins, how they signed in,
-- and their workspaces with lead counts. Shows the email's first 3 letters and domain only.
-- Run: node scripts/run-sql.mjs scripts/diag-leads2.sql --full
with recent as (
  select u.id, left(split_part(u.email, '@', 1), 3) || '…@' || split_part(u.email, '@', 2) as who,
         to_char(u.last_sign_in_at, 'DD Mon HH24:MI') as signed_in, u.last_sign_in_at,
         coalesce(u.raw_app_meta_data ->> 'providers', u.raw_app_meta_data ->> 'provider', '') as how
    from auth.users u order by u.last_sign_in_at desc nulls last limit 5)
select r.who, r.signed_in, r.how, coalesce(t.name, '(no workspace)') as workspace, coalesce(m.role, '') as role,
       (select count(*) from leads l where l.team_id = t.id) as leads,
       (select count(*) from members x where x.team_id = t.id) as people
  from recent r left join members m on m.user_id = r.id left join teams t on t.id = m.team_id
 order by r.last_sign_in_at desc nulls last;
