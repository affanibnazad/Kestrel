-- Migration 20261123f: Service Catalog & Proof UUID Backfill
-- Blueprint Stage B, Task 2.1: Additive Service Catalog extension on public.offer_profiles
-- Additive only. No existing columns or RLS dropped.

-- Pre-check: Inspect proof length per team_about row.
-- Adding a UUID "id" key (~45 chars) per proof element must not cause proof to exceed the 8000 byte limit.
SELECT
  team_id,
  length(proof::text) as current_bytes,
  jsonb_array_length(proof) as proof_count,
  length(proof::text) + (jsonb_array_length(proof) * 45) as projected_bytes,
  (length(proof::text) + (jsonb_array_length(proof) * 45) > 8000) as would_exceed_limit
FROM public.team_about
WHERE proof is not null and jsonb_array_length(proof) > 0;

BEGIN;

-- 1. Extend public.offer_profiles with additive fields
alter table public.offer_profiles
  add column if not exists service_type text check (service_type is null or length(service_type) <= 50),
  add column if not exists deliverables text not null default '' check (length(deliverables) <= 2000),
  add column if not exists problems_solved text not null default '' check (length(problems_solved) <= 2000),
  add column if not exists dream_outcome text not null default '' check (length(dream_outcome) <= 2000),
  add column if not exists time_to_result text not null default '' check (length(time_to_result) <= 500),
  add column if not exists client_effort text not null default '' check (length(client_effort) <= 1000),
  add column if not exists risk_reversal text not null default '' check (length(risk_reversal) <= 1000),
  add column if not exists first_step text not null default '' check (length(first_step) <= 1000),
  add column if not exists buying_triggers text not null default '' check (length(buying_triggers) <= 2000),
  add column if not exists proof_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(proof_ids) = 'array'),
  add column if not exists active boolean not null default true;

-- 2. Backfill stable UUID string 'id' for existing proof items in team_about (if missing)
do $$
declare
  r record;
  new_proof jsonb;
  item jsonb;
begin
  for r in select team_id, proof from public.team_about where proof is not null and jsonb_array_length(proof) > 0 loop
    new_proof := '[]'::jsonb;
    for item in select * from jsonb_array_elements(r.proof) loop
      if (item->>'id') is null or trim(item->>'id') = '' then
        new_proof := new_proof || jsonb_build_array(item || jsonb_build_object('id', gen_random_uuid()::text));
      else
        new_proof := new_proof || jsonb_build_array(item);
      end if;
    end loop;
    update public.team_about set proof = new_proof where team_id = r.team_id;
  end loop;
end $$;

COMMIT;

notify pgrst, 'reload schema';
