-- Kestrel: where are my leads? READ ONLY: changes nothing, shows counts and workspace names, no lead details (19 Nov 2026).
-- "me" = the person who signed in most recently (Affan, just now).
-- Run: node scripts/run-sql.mjs scripts/diag-leads.sql --full
with me as (select id, last_sign_in_at from auth.users order by last_sign_in_at desc nulls last limit 1),
mine as (select m.team_id, m.role from members m join me on m.user_id = me.id),
counts as (
  select l.team_id, count(*) as total,
         count(*) filter (where coalesce(l.status, '') = 'removed') as removed,
         count(*) filter (where l.sample) as samples,
         max(l.created_at) as newest
    from leads l group by l.team_id)
select case when t.id in (select team_id from mine) then 'MY WORKSPACE (' || (select role from mine where team_id = t.id) || ')' else 'other workspace' end as whose,
       t.name, t.plan, to_char(t.created_at, 'DD Mon YYYY') as made,
       coalesce(c.total, 0) as leads, coalesce(c.removed, 0) as removed, coalesce(c.samples, 0) as samples,
       to_char(c.newest, 'DD Mon HH24:MI') as newest_lead,
       (select count(*) from members x where x.team_id = t.id) as people,
       t.id::text as team_id
  from teams t left join counts c on c.team_id = t.id
 where t.id in (select team_id from mine) or coalesce(c.total, 0) > 0
 order by (t.id in (select team_id from mine)) desc, coalesce(c.total, 0) desc
 limit 15;
