-- Kestrel 067: no email greets a company by name (Affan, 19 Nov 2026: "Hi Social," for the lead "Social HQ").
-- New emails are fixed in the App (only a contact person's or the email address's first name is used, else "Hi there,").
-- This fixes emails already written: where the greeting name is the lead's company name or its first word, and no
-- contact person has that first name, "Hi <name>," / "Hey <name>," becomes "Hi there,". Changes only that greeting,
-- in the lead's written emails and in campaign emails NOT sent yet (emails already sent are never changed).
-- Run once: node scripts/run-sql.mjs supabase/migrations/067_greeting_not_company.sql  (safe to run again)

-- Campaign emails not sent yet (frozen copies of the steps).
with k as (
select l.id,
       trim(both '"' from to_jsonb(l.data -> 'outreach' ->> 'firstName')::text) as fn   -- the name as it is written inside JSON text
  from public.leads l
 where jsonb_typeof(l.data -> 'outreach') = 'object'
   and coalesce(l.data -> 'outreach' ->> 'firstName', '') not in ('', 'there')
   and (lower(l.data -> 'outreach' ->> 'firstName') = lower(btrim(l.name))
        or lower(l.data -> 'outreach' ->> 'firstName') = lower(split_part(btrim(l.name), ' ', 1)))
   and not exists (
     select 1 from jsonb_array_elements(case when jsonb_typeof(l.data -> 'contacts') = 'array' then l.data -> 'contacts' else '[]'::jsonb end) c
      where lower(split_part(btrim(coalesce(c ->> 'name', '')), ' ', 1)) = lower(l.data -> 'outreach' ->> 'firstName'))
)
update public.campaign_leads cl
   set steps = replace(replace(cl.steps::text, '"Hi ' || k.fn || ',', '"Hi there,'), '"Hey ' || k.fn || ',', '"Hi there,')::jsonb
  from k
 where cl.lead_id = k.id and cl.first_sent_at is null
   and (cl.steps::text like '%"Hi ' || k.fn || ',%' or cl.steps::text like '%"Hey ' || k.fn || ',%');

-- The lead's written emails.
with k as (
select l.id,
       trim(both '"' from to_jsonb(l.data -> 'outreach' ->> 'firstName')::text) as fn   -- the name as it is written inside JSON text
  from public.leads l
 where jsonb_typeof(l.data -> 'outreach') = 'object'
   and coalesce(l.data -> 'outreach' ->> 'firstName', '') not in ('', 'there')
   and (lower(l.data -> 'outreach' ->> 'firstName') = lower(btrim(l.name))
        or lower(l.data -> 'outreach' ->> 'firstName') = lower(split_part(btrim(l.name), ' ', 1)))
   and not exists (
     select 1 from jsonb_array_elements(case when jsonb_typeof(l.data -> 'contacts') = 'array' then l.data -> 'contacts' else '[]'::jsonb end) c
      where lower(split_part(btrim(coalesce(c ->> 'name', '')), ' ', 1)) = lower(l.data -> 'outreach' ->> 'firstName'))
)
update public.leads l
   set data = jsonb_set(l.data, '{outreach}',
         jsonb_set(replace(replace((l.data -> 'outreach')::text, '"Hi ' || k.fn || ',', '"Hi there,'), '"Hey ' || k.fn || ',', '"Hi there,')::jsonb,
                   '{firstName}', '"there"'::jsonb))
  from k
 where l.id = k.id;

notify pgrst, 'reload schema';
