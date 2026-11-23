-- supabase/migrations/rollback_workstream1.sql
-- Restores captured baseline database state prior to Workstream 1
-- Guaranteed Atomic: Entire script executes within an explicit transaction.
-- Guaranteed Safe: Validates 100% of metadata consistency BEFORE executing any DDL.

BEGIN;

-- =============================================================================
-- STEP 1: PRE-ROLLBACK METADATA INTEGRITY & ACL CONSISTENCY GATE
-- Aborts immediately if ANY baseline record or ACL representation is inconsistent.
-- Zero modifications or drops take place before this check succeeds.
-- =============================================================================
DO $$
DECLARE
  v_camp_count int;
  v_camp_rec record;
  v_vault_func_count int;
  v_vault_func_rec record;
  v_trig_count int;
  v_trig_rec record;
  v_expected_trigs text[] := ARRAY[
    'mailboxes_vault_cleanup:mailboxes',
    'team_keys_vault_cleanup:team_keys',
    'team_webhooks_vault_cleanup:team_webhooks',
    'seed_inboxes_vault_cleanup:seed_inboxes'
  ];
  v_target text;
BEGIN
  -- A. Verify metadata tables exist
  IF to_regclass('public._workstream1_baseline_metadata') IS NULL THEN
    RAISE EXCEPTION 'Rollback aborted: Required metadata table public._workstream1_baseline_metadata does not exist.';
  END IF;

  IF to_regclass('public._workstream1_vault_triggers_baseline_metadata') IS NULL THEN
    RAISE EXCEPTION 'Rollback aborted: Required metadata table public._workstream1_vault_triggers_baseline_metadata does not exist.';
  END IF;

  -- B. Verify campaign_log_delete baseline record and ACL consistency
  SELECT count(*) INTO v_camp_count
  FROM public._workstream1_baseline_metadata
  WHERE object_name = 'campaign_log_delete';

  IF v_camp_count <> 1 THEN
    RAISE EXCEPTION 'Rollback aborted: Expected exactly 1 baseline record for campaign_log_delete, found %', v_camp_count;
  END IF;

  SELECT * INTO v_camp_rec
  FROM public._workstream1_baseline_metadata
  WHERE object_name = 'campaign_log_delete';

  IF v_camp_rec.funcdef IS NULL 
     OR v_camp_rec.owner_role IS NULL 
     OR v_camp_rec.prosecdef IS NULL 
     OR v_camp_rec.trigdef IS NULL 
     OR v_camp_rec.tgenabled IS NULL 
     OR v_camp_rec.acl_is_null IS NULL THEN
    RAISE EXCEPTION 'Rollback aborted: Incomplete or corrupted baseline record for campaign_log_delete.';
  END IF;

  -- Validate ACL consistency for campaign_log_delete
  IF v_camp_rec.acl_is_null = true THEN
    IF v_camp_rec.acl_entries IS NOT NULL THEN
      RAISE EXCEPTION 'Rollback aborted: Inconsistent ACL metadata for campaign_log_delete (acl_is_null is true but acl_entries is present).';
    END IF;
  ELSIF v_camp_rec.acl_is_null = false THEN
    IF v_camp_rec.acl_entries IS NULL OR jsonb_typeof(v_camp_rec.acl_entries) <> 'array' THEN
      RAISE EXCEPTION 'Rollback aborted: Inconsistent ACL metadata for campaign_log_delete (acl_is_null is false but acl_entries is missing or not a JSON array).';
    END IF;
  END IF;

  -- C. Verify cleanup_vault_secret function baseline record and ACL consistency
  SELECT count(*) INTO v_vault_func_count
  FROM public._workstream1_vault_triggers_baseline_metadata
  WHERE object_type = 'function' AND object_name = 'cleanup_vault_secret' AND table_name = '';

  IF v_vault_func_count <> 1 THEN
    RAISE EXCEPTION 'Rollback aborted: Expected exactly 1 baseline record for cleanup_vault_secret, found %', v_vault_func_count;
  END IF;

  SELECT * INTO v_vault_func_rec
  FROM public._workstream1_vault_triggers_baseline_metadata
  WHERE object_type = 'function' AND object_name = 'cleanup_vault_secret' AND table_name = '';

  IF v_vault_func_rec.existed IS NULL THEN
    RAISE EXCEPTION 'Rollback aborted: cleanup_vault_secret baseline metadata missing existed flag.';
  END IF;

  -- If it existed prior to Migration 20261123b, verify its restoration properties and ACL consistency
  IF v_vault_func_rec.existed = true THEN
    IF v_vault_func_rec.def_sql IS NULL 
       OR v_vault_func_rec.owner_role IS NULL 
       OR v_vault_func_rec.prosecdef IS NULL 
       OR v_vault_func_rec.acl_is_null IS NULL THEN
      RAISE EXCEPTION 'Rollback aborted: Pre-existing cleanup_vault_secret record is missing required restoration definitions.';
    END IF;

    -- Validate ACL consistency for cleanup_vault_secret
    IF v_vault_func_rec.acl_is_null = true THEN
      IF v_vault_func_rec.acl_entries IS NOT NULL THEN
        RAISE EXCEPTION 'Rollback aborted: Inconsistent ACL metadata for cleanup_vault_secret (acl_is_null is true but acl_entries is present).';
      END IF;
    ELSIF v_vault_func_rec.acl_is_null = false THEN
      IF v_vault_func_rec.acl_entries IS NULL OR jsonb_typeof(v_vault_func_rec.acl_entries) <> 'array' THEN
        RAISE EXCEPTION 'Rollback aborted: Inconsistent ACL metadata for cleanup_vault_secret (acl_is_null is false but acl_entries is missing or not a JSON array).';
      END IF;
    END IF;
  END IF;

  -- D. Verify all 4 Vault triggers have exact corresponding baseline records
  SELECT count(*) INTO v_trig_count
  FROM public._workstream1_vault_triggers_baseline_metadata
  WHERE object_type = 'trigger';

  IF v_trig_count <> 4 THEN
    RAISE EXCEPTION 'Rollback aborted: Expected exactly 4 trigger baseline records, found %', v_trig_count;
  END IF;

  FOREACH v_target IN ARRAY v_expected_trigs LOOP
    SELECT * INTO v_trig_rec
    FROM public._workstream1_vault_triggers_baseline_metadata
    WHERE object_type = 'trigger'
      AND object_name = split_part(v_target, ':', 1)
      AND table_name = split_part(v_target, ':', 2);

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Rollback aborted: Missing baseline record for expected trigger %', v_target;
    END IF;

    IF v_trig_rec.existed IS NULL THEN
      RAISE EXCEPTION 'Rollback aborted: Trigger % baseline record missing existed flag.', v_target;
    END IF;

    IF v_trig_rec.existed = true THEN
      IF v_trig_rec.def_sql IS NULL OR v_trig_rec.tgenabled IS NULL THEN
        RAISE EXCEPTION 'Rollback aborted: Pre-existing trigger % is missing required restoration definitions.', v_target;
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE 'Rollback Pre-check PASSED: All baseline metadata records and ACL representations verified consistent.';
END $$;

-- =============================================================================
-- STEP 2: DROP FOREIGN KEYS ADDED IN MIGRATION 20261123a
-- =============================================================================
ALTER TABLE public.campaign_deletions DROP CONSTRAINT IF EXISTS campaign_deletions_team_id_fkey;
ALTER TABLE public.campaign_deletions DROP CONSTRAINT IF EXISTS campaign_deletions_deleted_by_fkey;

-- =============================================================================
-- STEP 3: RESTORE OR DROP MIGRATION 20261123b TRIGGERS AND FUNCTION
-- Only drops objects when verified baseline explicitly records existed = false.
-- =============================================================================
DO $$
DECLARE
  v_rec record;
  v_grant_sql text;
  v_entry record;
  v_setting text;
  v_eq_pos int;
  v_param text;
  v_val text;
  v_curr_grantee text;
BEGIN
  -- A. Process all 4 Vault triggers
  FOR v_rec IN 
    SELECT * FROM public._workstream1_vault_triggers_baseline_metadata 
    WHERE object_type = 'trigger'
  LOOP
    -- Drop the trigger installed by Migration 20261123b
    EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(v_rec.object_name) || ' ON public.' || quote_ident(v_rec.table_name);

    -- Only restore if it existed prior to Migration 20261123b
    IF v_rec.existed = true THEN
      EXECUTE v_rec.def_sql;

      IF v_rec.tgenabled = 'D' THEN
        EXECUTE 'ALTER TABLE public.' || quote_ident(v_rec.table_name) || ' DISABLE TRIGGER ' || quote_ident(v_rec.object_name);
      ELSIF v_rec.tgenabled = 'A' THEN
        EXECUTE 'ALTER TABLE public.' || quote_ident(v_rec.table_name) || ' ENABLE ALWAYS TRIGGER ' || quote_ident(v_rec.object_name);
      ELSIF v_rec.tgenabled = 'R' THEN
        EXECUTE 'ALTER TABLE public.' || quote_ident(v_rec.table_name) || ' ENABLE REPLICA TRIGGER ' || quote_ident(v_rec.object_name);
      ELSE
        EXECUTE 'ALTER TABLE public.' || quote_ident(v_rec.table_name) || ' ENABLE TRIGGER ' || quote_ident(v_rec.object_name);
      END IF;

      RAISE NOTICE 'Rollback: Restored pre-existing trigger % on %', v_rec.object_name, v_rec.table_name;
    ELSIF v_rec.existed = false THEN
      RAISE NOTICE 'Rollback: Dropped Migration 20261123b trigger % on % (did not exist previously)', v_rec.object_name, v_rec.table_name;
    END IF;
  END LOOP;

  -- B. Process cleanup_vault_secret function
  SELECT * INTO v_rec 
  FROM public._workstream1_vault_triggers_baseline_metadata 
  WHERE object_type = 'function' AND object_name = 'cleanup_vault_secret' AND table_name = '';

  IF v_rec.existed = true THEN
    -- Restore pre-existing function definition and attributes
    EXECUTE v_rec.def_sql;
    EXECUTE 'ALTER FUNCTION public.cleanup_vault_secret() OWNER TO ' || quote_ident(v_rec.owner_role);

    IF v_rec.prosecdef THEN
      ALTER FUNCTION public.cleanup_vault_secret() SECURITY DEFINER;
    ELSE
      ALTER FUNCTION public.cleanup_vault_secret() SECURITY INVOKER;
    END IF;

    ALTER FUNCTION public.cleanup_vault_secret() RESET ALL;
    IF v_rec.proconfig IS NOT NULL AND cardinality(v_rec.proconfig) > 0 THEN
      FOREACH v_setting IN ARRAY v_rec.proconfig LOOP
        v_eq_pos := position('=' in v_setting);
        IF v_eq_pos > 0 THEN
          v_param := trim(substring(v_setting from 1 for v_eq_pos - 1));
          v_val := substring(v_setting from v_eq_pos + 1);
          EXECUTE 'ALTER FUNCTION public.cleanup_vault_secret() SET ' || quote_ident(v_param) || ' = ' || quote_literal(v_val);
        END IF;
      END LOOP;
    END IF;

    -- Reset all grants and re-apply captured ACL
    FOR v_curr_grantee IN
      SELECT DISTINCT CASE WHEN grantee = 0 THEN 'PUBLIC' ELSE (grantee::regrole)::text END
      FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid = 'public.cleanup_vault_secret()'::regprocedure))
    LOOP
      IF v_curr_grantee = 'PUBLIC' THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.cleanup_vault_secret() FROM PUBLIC';
      ELSE
        EXECUTE 'REVOKE ALL ON FUNCTION public.cleanup_vault_secret() FROM ' || quote_ident(v_curr_grantee);
      END IF;
    END LOOP;

    IF v_rec.acl_is_null THEN
      GRANT EXECUTE ON FUNCTION public.cleanup_vault_secret() TO PUBLIC;
    ELSIF v_rec.acl_entries IS NOT NULL THEN
      FOR v_entry IN SELECT * FROM jsonb_to_recordset(v_rec.acl_entries) AS x(grantee text, privilege_type text, is_grantable boolean) LOOP
        IF v_entry.grantee = 'PUBLIC' THEN
          v_grant_sql := 'GRANT ' || v_entry.privilege_type || ' ON FUNCTION public.cleanup_vault_secret() TO PUBLIC';
        ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_entry.grantee) THEN
          v_grant_sql := 'GRANT ' || v_entry.privilege_type || ' ON FUNCTION public.cleanup_vault_secret() TO ' || quote_ident(v_entry.grantee);
        ELSE
          RAISE EXCEPTION 'Rollback aborted: Grantee role % for cleanup_vault_secret no longer exists', v_entry.grantee;
        END IF;
        IF v_entry.is_grantable THEN v_grant_sql := v_grant_sql || ' WITH GRANT OPTION'; END IF;
        EXECUTE v_grant_sql;
      END LOOP;
    END IF;

    RAISE NOTICE 'Rollback: Restored pre-existing function cleanup_vault_secret';
  ELSIF v_rec.existed = false THEN
    -- Only drop if verified baseline proves it did not exist before Migration 20261123b
    DROP FUNCTION IF EXISTS public.cleanup_vault_secret();
    RAISE NOTICE 'Rollback: Dropped Migration 20261123b function cleanup_vault_secret (did not exist previously)';
  END IF;
END $$;

-- =============================================================================
-- STEP 4: RESTORE BASELINE CAMPAIGN_LOG_DELETE FUNCTION AND TRIGGER
-- =============================================================================
DO $$
DECLARE
  v_meta record;
  v_setting text;
  v_eq_pos int;
  v_param text;
  v_val text;
  v_entry record;
  v_grant_sql text;
  v_curr_grantee text;
BEGIN
  SELECT * INTO v_meta 
  FROM public._workstream1_baseline_metadata 
  WHERE object_name = 'campaign_log_delete';

  -- A. Restore exact baseline function definition
  EXECUTE v_meta.funcdef;

  -- B. Restore exact baseline function owner
  EXECUTE 'ALTER FUNCTION public.campaign_log_delete() OWNER TO ' || quote_ident(v_meta.owner_role);

  -- C. Restore exact prosecdef attribute
  IF v_meta.prosecdef THEN
    ALTER FUNCTION public.campaign_log_delete() SECURITY DEFINER;
  ELSE
    ALTER FUNCTION public.campaign_log_delete() SECURITY INVOKER;
  END IF;

  -- D. Restore proconfig safely and exactly
  ALTER FUNCTION public.campaign_log_delete() RESET ALL;

  IF v_meta.proconfig IS NOT NULL AND cardinality(v_meta.proconfig) > 0 THEN
    FOREACH v_setting IN ARRAY v_meta.proconfig
    LOOP
      v_eq_pos := position('=' in v_setting);
      IF v_eq_pos = 0 THEN
        RAISE EXCEPTION 'Rollback aborted: Malformed proconfig setting "%" in baseline metadata', v_setting;
      END IF;

      v_param := trim(substring(v_setting from 1 for v_eq_pos - 1));
      v_val := substring(v_setting from v_eq_pos + 1);

      IF v_param = '' THEN
        RAISE EXCEPTION 'Rollback aborted: Empty parameter name in proconfig setting "%"', v_setting;
      END IF;

      EXECUTE 'ALTER FUNCTION public.campaign_log_delete() SET ' || quote_ident(v_param) || ' = ' || quote_literal(v_val);
    END LOOP;
  END IF;

  -- E. Complete ACL restoration without residual grants
  FOR v_curr_grantee IN
    SELECT DISTINCT CASE WHEN grantee = 0 THEN 'PUBLIC' ELSE (grantee::regrole)::text END
    FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid = 'public.campaign_log_delete()'::regprocedure))
  LOOP
    IF v_curr_grantee = 'PUBLIC' THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.campaign_log_delete() FROM PUBLIC';
    ELSE
      EXECUTE 'REVOKE ALL ON FUNCTION public.campaign_log_delete() FROM ' || quote_ident(v_curr_grantee);
    END IF;
  END LOOP;

  -- Explicit safety revocation for roles altered by Migration 20261123a
  REVOKE ALL ON FUNCTION public.campaign_log_delete() FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.campaign_log_delete() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.campaign_log_delete() FROM authenticated;
  END IF;

  -- Restore exact captured baseline ACL
  IF v_meta.acl_is_null THEN
    GRANT EXECUTE ON FUNCTION public.campaign_log_delete() TO PUBLIC;
  ELSE
    IF v_meta.acl_entries IS NOT NULL AND jsonb_array_length(v_meta.acl_entries) > 0 THEN
      FOR v_entry IN SELECT * FROM jsonb_to_recordset(v_meta.acl_entries) AS x(grantee text, privilege_type text, is_grantable boolean)
      LOOP
        IF v_entry.grantee <> 'PUBLIC' AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_entry.grantee) THEN
          RAISE EXCEPTION 'Rollback aborted: Grantee role "%" from captured baseline ACL no longer exists in database', v_entry.grantee;
        END IF;

        IF v_entry.grantee = 'PUBLIC' THEN
          v_grant_sql := 'GRANT ' || v_entry.privilege_type || ' ON FUNCTION public.campaign_log_delete() TO PUBLIC';
        ELSE
          v_grant_sql := 'GRANT ' || v_entry.privilege_type || ' ON FUNCTION public.campaign_log_delete() TO ' || quote_ident(v_entry.grantee);
        END IF;

        IF v_entry.is_grantable THEN
          v_grant_sql := v_grant_sql || ' WITH GRANT OPTION';
        END IF;

        EXECUTE v_grant_sql;
      END LOOP;
    END IF;
  END IF;

  -- F. Restore trigger and its exact enabled state
  DROP TRIGGER IF EXISTS campaigns_log_delete ON public.campaigns;
  EXECUTE v_meta.trigdef;

  IF v_meta.tgenabled = 'D' THEN
    ALTER TABLE public.campaigns DISABLE TRIGGER campaigns_log_delete;
  ELSIF v_meta.tgenabled = 'A' THEN
    ALTER TABLE public.campaigns ENABLE ALWAYS TRIGGER campaigns_log_delete;
  ELSIF v_meta.tgenabled = 'R' THEN
    ALTER TABLE public.campaigns ENABLE REPLICA TRIGGER campaigns_log_delete;
  ELSE
    ALTER TABLE public.campaigns ENABLE TRIGGER campaigns_log_delete;
  END IF;

  RAISE NOTICE 'Rollback: Successfully restored exact baseline metadata (Owner: %, prosecdef: %, tgenabled: %, proconfig: %)',
    v_meta.owner_role, v_meta.prosecdef, v_meta.tgenabled, coalesce(array_to_string(v_meta.proconfig, ', '), 'NONE');
END $$;

COMMIT;

-- Note on Archived Data:
-- Tables _campaign_deletions_orphans_backup, _campaign_deletions_invalid_users_backup,
-- _workstream1_baseline_metadata, and _workstream1_vault_triggers_baseline_metadata are preserved.
-- Archived tombstones cannot be restored into active campaign_deletions without their referenced teams.
-- Prerequisite for restoring tombstones: recreate the referenced team records in public.teams.