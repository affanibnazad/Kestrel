-- Kestrel 064: greeting "Hi {{FIRST_NAME}}," in saved sequences (Affan, 19 Nov 2026). New emails greet a person by first
-- name, or "Hi there," when no person is known (never the company name). Sequences saved before today start their
-- steps with "Hey {{FIRST_NAME}},": this changes only that greeting, nothing else in any step.
-- Run once: node scripts/run-sql.mjs supabase/migrations/064_greeting_hi.sql  (safe to run again; it only finds "Hey" once)

update public.sequences
   set steps = replace(steps::text, '"Hey {{FIRST_NAME}},', '"Hi {{FIRST_NAME}},')::jsonb,
       updated_at = now()
 where steps::text like '%"Hey {{FIRST_NAME}},%';

notify pgrst, 'reload schema';
