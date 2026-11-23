-- scripts/verify-workstream1.sql
-- Workstream 1 Comprehensive Regression Suite (Zero fake/substitute tables)

BEGIN;

-- 1. Setup backup tables
CREATE TABLE IF NOT EXISTS public._campaign_deletions_orphans_backup (
  campaign_id uuid PRIMARY KEY,
  team_id     uuid NOT NULL,
  name        text,
  status      text,
  snapshot    jsonb,
  leads       integer,
  sent        integer,
  deleted_by  uuid,
  deleted_at  timestamptz,
  archived_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public._campaign_deletions_orphans_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._campaign_deletions_orphans_backup FROM public, anon, authenticated;

CREATE TABLE IF NOT EXISTS public._campaign_deletions_invalid_users_backup (
  campaign_id        uuid PRIMARY KEY,
  invalid_deleted_by uuid NOT NULL,
  archived_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public._campaign_deletions_invalid_users_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._campaign_deletions_invalid_users_backup FROM public, anon, authenticated;

ALTER TABLE public.campaign_deletions DROP CONSTRAINT IF EXISTS campaign_deletions_team_id_fkey;
ALTER TABLE public.campaign_deletions DROP CONSTRAINT IF EXISTS campaign_deletions_deleted_by_fkey;

-- Insert test orphans before FK is applied to test archival idempotency
INSERT INTO public.campaign_deletions (campaign_id, team_id, name, status, snapshot, leads, sent, deleted_by, deleted_at)
VALUES 
  ('d0000000-0000-0000-0000-000000000001', 'd9999999-0000-0000-0000-000000000001', 'T1 Orphan 1', 'active', '{"v": 1}'::jsonb, 10, 2, NULL, now()),
  ('d0000000-0000-0000-0000-000000000002', 'd9999999-0000-0000-0000-000000000002', 'T1 Orphan 2', 'draft', '{"v": 2}'::jsonb, 5, 0, NULL, now())
ON CONFLICT (campaign_id) DO NOTHING;

-- Pre-seed sentinel record across all 9 columns
INSERT INTO public._campaign_deletions_orphans_backup (
  campaign_id, team_id, name, status, snapshot, leads, sent, deleted_by, deleted_at, archived_at
)
VALUES (
  'd0000000-0000-0000-0000-000000000001', 'd9999999-0000-0000-0000-000000000001', 
  'SENTINEL_NAME', 'archived', '{"sentinel": true}'::jsonb, 99, 99, NULL, NULL, '2021-01-01 00:00:00+00'::timestamptz
)
ON CONFLICT (campaign_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Test 1: Complete Null-Safe Archival Integrity and Repeatability
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_sentinel_count bigint;
  v_sentinel_row public._campaign_deletions_orphans_backup%ROWTYPE;
  v_src_count bigint;
  v_bak_count bigint;
  v_src_row public.campaign_deletions%ROWTYPE;
  v_bak_row public._campaign_deletions_orphans_backup%ROWTYPE;
  v_missing_backup_count bigint;
  v_mismatched_backup_count bigint;
  v_t1_backup_count1 bigint;
  v_t1_backup_count2 bigint;
BEGIN
  -- Run Archival Pass 1
  INSERT INTO public._campaign_deletions_orphans_backup (
    campaign_id, team_id, name, status, snapshot, leads, sent, deleted_by, deleted_at, archived_at
  )
  SELECT
    cd.campaign_id, cd.team_id, cd.name, cd.status, cd.snapshot, cd.leads, cd.sent, cd.deleted_by, cd.deleted_at, now()
  FROM public.campaign_deletions cd
  WHERE NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = cd.team_id)
  ON CONFLICT (campaign_id) DO NOTHING;

  -- 1. Explicitly verify sentinel record exists before inspecting values
  SELECT count(*) INTO v_sentinel_count
  FROM public._campaign_deletions_orphans_backup
  WHERE campaign_id = 'd0000000-0000-0000-0000-000000000001';

  IF v_sentinel_count = 0 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Pre-existing sentinel record is completely MISSING from backup table!';
  ELSIF v_sentinel_count > 1 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Sentinel record duplicated in backup table (count: %)', v_sentinel_count;
  END IF;

  SELECT * INTO v_sentinel_row 
  FROM public._campaign_deletions_orphans_backup 
  WHERE campaign_id = 'd0000000-0000-0000-0000-000000000001';

  IF v_sentinel_row.campaign_id IS DISTINCT FROM 'd0000000-0000-0000-0000-000000000001'::uuid
     OR v_sentinel_row.team_id IS DISTINCT FROM 'd9999999-0000-0000-0000-000000000001'::uuid
     OR v_sentinel_row.name IS DISTINCT FROM 'SENTINEL_NAME'
     OR v_sentinel_row.status IS DISTINCT FROM 'archived'
     OR v_sentinel_row.snapshot IS DISTINCT FROM '{"sentinel": true}'::jsonb
     OR v_sentinel_row.leads IS DISTINCT FROM 99
     OR v_sentinel_row.sent IS DISTINCT FROM 99
     OR v_sentinel_row.deleted_by IS DISTINCT FROM NULL
     OR v_sentinel_row.deleted_at IS DISTINCT FROM NULL
     OR v_sentinel_row.archived_at IS DISTINCT FROM '2021-01-01 00:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Sentinel backup record values were modified or overwritten!';
  END IF;

  -- 2. Explicitly verify source record exists before comparing against backup
  SELECT count(*) INTO v_src_count
  FROM public.campaign_deletions
  WHERE campaign_id = 'd0000000-0000-0000-0000-000000000002';

  IF v_src_count = 0 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Source orphan record is MISSING from campaign_deletions before comparison!';
  END IF;

  SELECT count(*) INTO v_bak_count
  FROM public._campaign_deletions_orphans_backup
  WHERE campaign_id = 'd0000000-0000-0000-0000-000000000002';

  IF v_bak_count = 0 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Newly archived record is completely MISSING from backup table!';
  ELSIF v_bak_count > 1 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Expected newly archived record to exist exactly once, found %', v_bak_count;
  END IF;

  SELECT * INTO v_src_row
  FROM public.campaign_deletions
  WHERE campaign_id = 'd0000000-0000-0000-0000-000000000002';

  SELECT * INTO v_bak_row
  FROM public._campaign_deletions_orphans_backup
  WHERE campaign_id = 'd0000000-0000-0000-0000-000000000002';

  -- Null-safe comparison across all columns
  IF v_bak_row.campaign_id IS DISTINCT FROM v_src_row.campaign_id
     OR v_bak_row.team_id IS DISTINCT FROM v_src_row.team_id
     OR v_bak_row.name IS DISTINCT FROM v_src_row.name
     OR v_bak_row.status IS DISTINCT FROM v_src_row.status
     OR v_bak_row.snapshot IS DISTINCT FROM v_src_row.snapshot
     OR v_bak_row.leads IS DISTINCT FROM v_src_row.leads
     OR v_bak_row.sent IS DISTINCT FROM v_src_row.sent
     OR v_bak_row.deleted_by IS DISTINCT FROM v_src_row.deleted_by
     OR v_bak_row.deleted_at IS DISTINCT FROM v_src_row.deleted_at THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Column mismatch between source record and archived record';
  END IF;

  -- 3. Assert archived_at is valid and recent
  IF v_bak_row.archived_at IS NULL 
     OR v_bak_row.archived_at > now() 
     OR v_bak_row.archived_at < (now() - interval '1 minute') THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Invalid archived_at timestamp on newly archived record: %', v_bak_row.archived_at;
  END IF;

  -- 4. Detect missing backup records as well as mismatched records
  SELECT count(*) INTO v_missing_backup_count
  FROM public.campaign_deletions cd
  WHERE NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = cd.team_id)
    AND NOT EXISTS (
      SELECT 1 FROM public._campaign_deletions_orphans_backup b
      WHERE b.campaign_id = cd.campaign_id
    );

  IF v_missing_backup_count > 0 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: % orphan records are completely missing from backup table', v_missing_backup_count;
  END IF;

  SELECT count(*) INTO v_mismatched_backup_count
  FROM public.campaign_deletions cd
  JOIN public._campaign_deletions_orphans_backup b ON b.campaign_id = cd.campaign_id
  WHERE cd.campaign_id <> 'd0000000-0000-0000-0000-000000000001'
    AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = cd.team_id)
    AND (
      b.team_id IS DISTINCT FROM cd.team_id
      OR b.name IS DISTINCT FROM cd.name
      OR b.status IS DISTINCT FROM cd.status
      OR b.snapshot IS DISTINCT FROM cd.snapshot
      OR b.leads IS DISTINCT FROM cd.leads
      OR b.sent IS DISTINCT FROM cd.sent
      OR b.deleted_by IS DISTINCT FROM cd.deleted_by
      OR b.deleted_at IS DISTINCT FROM cd.deleted_at
    );

  IF v_mismatched_backup_count > 0 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: % backup records have values that do not match source columns', v_mismatched_backup_count;
  END IF;

  SELECT count(*) INTO v_t1_backup_count1 FROM public._campaign_deletions_orphans_backup;

  -- 5. Assert repeatability on rerun (Pass 2)
  INSERT INTO public._campaign_deletions_orphans_backup (
    campaign_id, team_id, name, status, snapshot, leads, sent, deleted_by, deleted_at, archived_at
  )
  SELECT
    cd.campaign_id, cd.team_id, cd.name, cd.status, cd.snapshot, cd.leads, cd.sent, cd.deleted_by, cd.deleted_at, now()
  FROM public.campaign_deletions cd
  WHERE NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = cd.team_id)
  ON CONFLICT (campaign_id) DO NOTHING;

  SELECT count(*) INTO v_t1_backup_count2 FROM public._campaign_deletions_orphans_backup;

  IF v_t1_backup_count2 <> v_t1_backup_count1 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Duplicate rows inserted on rerun (was %, now %)', v_t1_backup_count1, v_t1_backup_count2;
  END IF;

  RAISE NOTICE 'TEST 1 PASSED: Complete null-safe archival integrity, sentinel immutability, and repeatability verified.';
END $$;

-- Purge verified orphans
DELETE FROM public.campaign_deletions cd
WHERE NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = cd.team_id);

-- Apply Migration 20261123a trigger update and strict FKs
CREATE OR REPLACE FUNCTION public.campaign_log_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = old.team_id) THEN
    RETURN old;
  END IF;

  INSERT INTO campaign_deletions AS d (campaign_id, team_id, name, status, snapshot, leads, sent, deleted_by)
  VALUES (old.id, old.team_id, old.name, old.status, to_jsonb(old),
          (SELECT count(*) FROM campaign_leads cl WHERE cl.campaign_id = old.id),
          (SELECT count(*) FROM campaign_leads cl WHERE cl.campaign_id = old.id AND cl.first_sent_at IS NOT NULL), auth.uid())
  ON CONFLICT (campaign_id) DO UPDATE SET name = excluded.name, status = excluded.status, snapshot = excluded.snapshot, leads = excluded.leads,
    sent = excluded.sent, deleted_by = excluded.deleted_by, deleted_at = now();

  DELETE FROM campaign_deletions x WHERE x.team_id = old.team_id AND x.deleted_at < now() - interval '90 days';
  RETURN old;
END $$;

REVOKE ALL ON FUNCTION public.campaign_log_delete() FROM public, anon, authenticated;

ALTER TABLE public.campaign_deletions
  ADD CONSTRAINT campaign_deletions_team_id_fkey
  FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE public.campaign_deletions
  ADD CONSTRAINT campaign_deletions_deleted_by_fkey
  FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Apply Migration 20261123b triggers
CREATE OR REPLACE FUNCTION public.cleanup_vault_secret() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
BEGIN
  IF old.secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = old.secret_id;
  END IF;
  RETURN old;
END $$;

REVOKE ALL ON FUNCTION public.cleanup_vault_secret() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS mailboxes_vault_cleanup ON public.mailboxes;
CREATE TRIGGER mailboxes_vault_cleanup BEFORE DELETE ON public.mailboxes
FOR EACH ROW EXECUTE FUNCTION public.cleanup_vault_secret();

DROP TRIGGER IF EXISTS team_keys_vault_cleanup ON public.team_keys;
CREATE TRIGGER team_keys_vault_cleanup BEFORE DELETE ON public.team_keys
FOR EACH ROW EXECUTE FUNCTION public.cleanup_vault_secret();

DROP TRIGGER IF EXISTS team_webhooks_vault_cleanup ON public.team_webhooks;
CREATE TRIGGER team_webhooks_vault_cleanup BEFORE DELETE ON public.team_webhooks
FOR EACH ROW EXECUTE FUNCTION public.cleanup_vault_secret();

DROP TRIGGER IF EXISTS seed_inboxes_vault_cleanup ON public.seed_inboxes;
CREATE TRIGGER seed_inboxes_vault_cleanup BEFORE DELETE ON public.seed_inboxes
FOR EACH ROW EXECUTE FUNCTION public.cleanup_vault_secret();

-- Tests 2-8
DO $$
DECLARE
  v_dummy_team uuid := 'e0000000-0000-0000-0000-000000000001';
  v_dummy_user uuid := 'e0000000-0000-0000-0000-000000000002';
  v_dummy_camp uuid := 'e0000000-0000-0000-0000-000000000003';
  v_caught boolean;
  v_msg text;
  v_vault_accessible boolean;

  v_dir_team uuid := 'e0000000-0000-0000-0000-000000000010';
  v_dir_sec_mb uuid := 'e0000000-0000-0000-0000-000000000011';
  v_dir_sec_key uuid := 'e0000000-0000-0000-0000-000000000012';
  v_dir_sec_hook uuid := 'e0000000-0000-0000-0000-000000000013';
  v_dir_sec_seed uuid := 'e0000000-0000-0000-0000-000000000014';

  v_casc_team uuid := 'e0000000-0000-0000-0000-000000000020';
  v_casc_sec_mb uuid := 'e0000000-0000-0000-0000-000000000021';
  v_casc_sec_key uuid := 'e0000000-0000-0000-0000-000000000022';
  v_casc_sec_hook uuid := 'e0000000-0000-0000-0000-000000000023';
  v_casc_sec_seed uuid := 'e0000000-0000-0000-0000-000000000024';
BEGIN
  -- Test 2: Foreign key on team_id blocks invalid inserts
  v_caught := false;
  BEGIN
    INSERT INTO public.campaign_deletions (campaign_id, team_id, name, status, snapshot)
    VALUES (gen_random_uuid(), 'e9999999-9999-9999-9999-999999999999', 'Ghost', 'draft', '{}'::jsonb);
  EXCEPTION WHEN foreign_key_violation THEN
    v_caught := true;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'TEST 2 FAILED: Missing team_id did not raise foreign_key_violation';
  END IF;

  RAISE NOTICE 'TEST 2 PASSED: campaign_deletions_team_id_fkey blocks orphan inserts.';

  -- Base fixtures
  INSERT INTO auth.users (id, email) VALUES (v_dummy_user, 'ws1_user@test.com');
  INSERT INTO public.teams (id, name) VALUES (v_dummy_team, 'WS1 Test Team');

  -- Test 3: Foreign key deleted_by sets NULL on user deletion
  INSERT INTO public.campaign_deletions (campaign_id, team_id, name, status, snapshot, deleted_by)
  VALUES (v_dummy_camp, v_dummy_team, 'Camp 1', 'draft', '{}'::jsonb, v_dummy_user);

  DELETE FROM auth.users WHERE id = v_dummy_user;

  IF NOT EXISTS (SELECT 1 FROM public.campaign_deletions WHERE campaign_id = v_dummy_camp AND deleted_by IS NULL) THEN
    RAISE EXCEPTION 'TEST 3 FAILED: deleted_by was not set to NULL upon user deletion';
  END IF;

  DELETE FROM public.campaign_deletions WHERE campaign_id = v_dummy_camp;
  RAISE NOTICE 'TEST 3 PASSED: deleted_by FK sets NULL on user deletion.';

  -- Test 4: Single campaign delete creates tombstone
  INSERT INTO public.campaigns (id, team_id, name, status) VALUES (v_dummy_camp, v_dummy_team, 'Camp 2', 'draft');
  DELETE FROM public.campaigns WHERE id = v_dummy_camp;

  IF NOT EXISTS (SELECT 1 FROM public.campaign_deletions WHERE campaign_id = v_dummy_camp) THEN
    RAISE EXCEPTION 'TEST 4 FAILED: Tombstone was not created for deleted campaign';
  END IF;

  DELETE FROM public.campaign_deletions WHERE campaign_id = v_dummy_camp;
  RAISE NOTICE 'TEST 4 PASSED: Single campaign delete creates a tombstone.';

  -- Test 5: Team cascade delete cleanly deletes campaigns without dangling tombstones
  INSERT INTO public.campaigns (id, team_id, name, status) VALUES (v_dummy_camp, v_dummy_team, 'Camp 3', 'draft');
  DELETE FROM public.teams WHERE id = v_dummy_team;

  IF EXISTS (SELECT 1 FROM public.campaigns WHERE id = v_dummy_camp) THEN
    RAISE EXCEPTION 'TEST 5 FAILED: Campaign was not cascade-deleted with team';
  END IF;

  IF EXISTS (SELECT 1 FROM public.campaign_deletions WHERE campaign_id = v_dummy_camp) THEN
    RAISE EXCEPTION 'TEST 5 FAILED: Dangling tombstone created during team cascade';
  END IF;

  RAISE NOTICE 'TEST 5 PASSED: Team cascade cleanly deletes campaigns without dangling tombstones.';

  -- ---------------------------------------------------------------------------
  -- Complete Vault Capability Verification (SELECT, INSERT, DELETE)
  -- ---------------------------------------------------------------------------
  SELECT 
    to_regclass('vault.secrets') IS NOT NULL 
    AND has_table_privilege(current_user, 'vault.secrets', 'SELECT')
    AND has_table_privilege(current_user, 'vault.secrets', 'INSERT')
    AND has_table_privilege(current_user, 'vault.secrets', 'DELETE')
  INTO v_vault_accessible;

  IF NOT v_vault_accessible THEN
    RAISE NOTICE '====================================================================';
    RAISE NOTICE 'STATUS: BLOCKED — Vault Regression Tests (Tests 6A-6E, 7, 8)';
    RAISE NOTICE 'REASON: Real relation vault.secrets is missing or lacks required SELECT, INSERT, DELETE privileges.';
    RAISE NOTICE 'Trigger testing cannot proceed without full access to the real Supabase Vault relation.';
    RAISE NOTICE '====================================================================';
    RAISE EXCEPTION 'TEST_SUITE_STATUS: BLOCKED (vault.secrets missing or insufficient SELECT/INSERT/DELETE privileges)';
  ELSE
    INSERT INTO public.teams (id, name) VALUES (v_dir_team, 'WS1 Direct Vault Team');

    -- 6A: mailboxes direct delete
    INSERT INTO vault.secrets (id, secret, name) VALUES (v_dir_sec_mb, 'sec_mb', 'mb');
    INSERT INTO public.mailboxes (id, team_id, email, smtp_host, username, secret_id)
    VALUES (gen_random_uuid(), v_dir_team, 'dir_mb@test.com', 'smtp.test.com', 'dir_mb@test.com', v_dir_sec_mb);
    DELETE FROM public.mailboxes WHERE email = 'dir_mb@test.com';
    IF EXISTS (SELECT 1 FROM vault.secrets WHERE id = v_dir_sec_mb) THEN
      RAISE EXCEPTION 'TEST 6A FAILED: Mailbox secret was not deleted on direct delete';
    END IF;
    RAISE NOTICE 'TEST 6A PASSED: mailboxes direct delete cleaned up secret.';

    -- 6B: team_keys direct delete
    INSERT INTO vault.secrets (id, secret, name) VALUES (v_dir_sec_key, 'sec_key', 'key');
    INSERT INTO public.team_keys (team_id, service, secret_id)
    VALUES (v_dir_team, 'hunter', v_dir_sec_key);
    DELETE FROM public.team_keys WHERE team_id = v_dir_team AND service = 'hunter';
    IF EXISTS (SELECT 1 FROM vault.secrets WHERE id = v_dir_sec_key) THEN
      RAISE EXCEPTION 'TEST 6B FAILED: team_keys secret was not deleted on direct delete';
    END IF;
    RAISE NOTICE 'TEST 6B PASSED: team_keys direct delete cleaned up secret.';

    -- 6C: team_webhooks direct delete
    INSERT INTO vault.secrets (id, secret, name) VALUES (v_dir_sec_hook, 'sec_hook', 'hook');
    INSERT INTO public.team_webhooks (id, team_id, url, events, secret_id)
    VALUES (gen_random_uuid(), v_dir_team, 'https://example.com/h', ARRAY['email.sent'], v_dir_sec_hook);
    DELETE FROM public.team_webhooks WHERE team_id = v_dir_team;
    IF EXISTS (SELECT 1 FROM vault.secrets WHERE id = v_dir_sec_hook) THEN
      RAISE EXCEPTION 'TEST 6C FAILED: team_webhooks secret was not deleted on direct delete';
    END IF;
    RAISE NOTICE 'TEST 6C PASSED: team_webhooks direct delete cleaned up secret.';

    -- 6D: seed_inboxes direct delete
    INSERT INTO vault.secrets (id, secret, name) VALUES (v_dir_sec_seed, 'sec_seed', 'seed');
    INSERT INTO public.seed_inboxes (id, team_id, email, imap_host, username, secret_id)
    VALUES (gen_random_uuid(), v_dir_team, 'dir_seed@test.com', 'imap.test.com', 'dir_seed@test.com', v_dir_sec_seed);
    DELETE FROM public.seed_inboxes WHERE email = 'dir_seed@test.com';
    IF EXISTS (SELECT 1 FROM vault.secrets WHERE id = v_dir_sec_seed) THEN
      RAISE EXCEPTION 'TEST 6D FAILED: seed_inboxes secret was not deleted on direct delete';
    END IF;
    RAISE NOTICE 'TEST 6D PASSED: seed_inboxes direct delete cleaned up secret.';

    DELETE FROM public.teams WHERE id = v_dir_team;

    -- 6E: Team Cascade across ALL 4 TABLES simultaneously
    INSERT INTO public.teams (id, name) VALUES (v_casc_team, 'WS1 Cascade Vault Team');
    INSERT INTO vault.secrets (id, secret, name) VALUES 
      (v_casc_sec_mb, 'csec_mb', 'cmb'),
      (v_casc_sec_key, 'csec_key', 'ckey'),
      (v_casc_sec_hook, 'csec_hook', 'chook'),
      (v_casc_sec_seed, 'csec_seed', 'cseed');

    INSERT INTO public.mailboxes (id, team_id, email, smtp_host, username, secret_id)
    VALUES (gen_random_uuid(), v_casc_team, 'casc_mb@test.com', 'smtp.test.com', 'casc_mb@test.com', v_casc_sec_mb);

    INSERT INTO public.team_keys (team_id, service, secret_id)
    VALUES (v_casc_team, 'anthropic', v_casc_sec_key);

    INSERT INTO public.team_webhooks (id, team_id, url, events, secret_id)
    VALUES (gen_random_uuid(), v_casc_team, 'https://example.com/ch', ARRAY['email.sent'], v_casc_sec_hook);

    INSERT INTO public.seed_inboxes (id, team_id, email, imap_host, username, secret_id)
    VALUES (gen_random_uuid(), v_casc_team, 'casc_seed@test.com', 'imap.test.com', 'casc_seed@test.com', v_casc_sec_seed);

    DELETE FROM public.teams WHERE id = v_casc_team;

    IF EXISTS (SELECT 1 FROM public.mailboxes WHERE team_id = v_casc_team) OR
       EXISTS (SELECT 1 FROM public.team_keys WHERE team_id = v_casc_team) OR
       EXISTS (SELECT 1 FROM public.team_webhooks WHERE team_id = v_casc_team) OR
       EXISTS (SELECT 1 FROM public.seed_inboxes WHERE team_id = v_casc_team) THEN
      RAISE EXCEPTION 'TEST 6E FAILED: Team cascade did not delete all child records';
    END IF;

    IF EXISTS (SELECT 1 FROM vault.secrets WHERE id IN (v_casc_sec_mb, v_casc_sec_key, v_casc_sec_hook, v_casc_sec_seed)) THEN
      RAISE EXCEPTION 'TEST 6E FAILED: Team cascade did not clean up all vault secrets';
    END IF;

    RAISE NOTICE 'TEST 6E PASSED: Team cascade cleaned up secrets across mailboxes, team_keys, team_webhooks, and seed_inboxes.';

    -- Test 7: Failure Injection
    INSERT INTO public.teams (id, name) VALUES (v_dir_team, 'WS1 Failure Test Team');
    INSERT INTO vault.secrets (id, secret, name) VALUES (v_dir_sec_mb, 'sec_fail', 'mb_fail');
    INSERT INTO public.mailboxes (id, team_id, email, smtp_host, username, secret_id)
    VALUES (gen_random_uuid(), v_dir_team, 'fail_mb@test.com', 'smtp.test.com', 'fail_mb@test.com', v_dir_sec_mb);

    CREATE OR REPLACE FUNCTION pg_temp.inject_vault_failure() RETURNS trigger
    LANGUAGE plpgsql AS $inj$
    BEGIN
      RAISE EXCEPTION 'CONTROLLED_VAULT_DELETION_FAILURE';
    END;
    $inj$;

    CREATE TRIGGER test_fail_vault_delete
    BEFORE DELETE ON vault.secrets
    FOR EACH ROW EXECUTE FUNCTION pg_temp.inject_vault_failure();

    v_caught := false;
    BEGIN
      DELETE FROM public.mailboxes WHERE email = 'fail_mb@test.com';
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
      IF v_msg LIKE '%CONTROLLED_VAULT_DELETION_FAILURE%' THEN
        v_caught := true;
      ELSE
        RAISE EXCEPTION 'TEST 7 FAILED: Unexpected error caught: %', v_msg;
      END IF;
    END;

    DROP TRIGGER IF EXISTS test_fail_vault_delete ON vault.secrets;
    DROP FUNCTION IF EXISTS pg_temp.inject_vault_failure();

    IF NOT v_caught THEN
      RAISE EXCEPTION 'TEST 7 FAILED: Controlled Vault failure was not triggered';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.mailboxes WHERE email = 'fail_mb@test.com') THEN
      RAISE EXCEPTION 'TEST 7 FAILED: Mailbox was deleted despite Vault failure';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE id = v_dir_sec_mb) THEN
      RAISE EXCEPTION 'TEST 7 FAILED: Secret was deleted despite Vault failure';
    END IF;

    RAISE NOTICE 'TEST 7 PASSED: Controlled Vault failure aborts deletion; parent and secret intact.';

    -- Test 8: Missing Vault secret safe no-op
    INSERT INTO public.mailboxes (id, team_id, email, smtp_host, username, secret_id)
    VALUES (gen_random_uuid(), v_dir_team, 'noop_mb@test.com', 'smtp.test.com', 'noop_mb@test.com', 'e9999999-9999-9999-9999-999999999998');

    DELETE FROM public.mailboxes WHERE email = 'noop_mb@test.com';
    RAISE NOTICE 'TEST 8 PASSED: Missing Vault secret handled gracefully as safe no-op.';

    DELETE FROM public.teams WHERE id = v_dir_team;
  END IF;

END $$;

ROLLBACK;