-- Migration 070: Campaign Deletions Integrity & Safe Archival
-- Workstream 1 (Database Reliability)

-- 1. Create baseline metadata and recovery backup tables
CREATE TABLE IF NOT EXISTS public._workstream1_baseline_metadata (
  object_name text PRIMARY KEY,
  owner_role  text NOT NULL,
  prosecdef   boolean NOT NULL,
  proconfig   text[],
  acl_is_null boolean NOT NULL,
  acl_entries jsonb,
  funcdef     text NOT NULL,
  trigdef     text NOT NULL,
  tgenabled   text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public._workstream1_baseline_metadata ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._workstream1_baseline_metadata FROM public, anon, authenticated;

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

-- 2. Capture exact runtime baseline metadata before modification
DO $$
DECLARE
  v_func_count int;
  v_trig_count int;
  v_func_oid oid;
  v_trig_oid oid;
BEGIN
  -- Verify exactly one public.campaign_log_delete function exists
  SELECT count(*), max(p.oid) INTO v_func_count, v_func_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'campaign_log_delete';

  IF v_func_count <> 1 THEN
    RAISE EXCEPTION 'Baseline capture aborted: Expected exactly 1 public.campaign_log_delete function, found %', v_func_count;
  END IF;

  -- Verify exactly one campaigns_log_delete trigger exists on public.campaigns for this function
  SELECT count(*), max(t.oid) INTO v_trig_count, v_trig_oid
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' 
    AND c.relname = 'campaigns' 
    AND t.tgname = 'campaigns_log_delete'
    AND t.tgfoid = v_func_oid
    AND NOT t.tgisinternal;

  IF v_trig_count <> 1 THEN
    RAISE EXCEPTION 'Baseline capture aborted: Expected exactly 1 campaigns_log_delete trigger on public.campaigns, found %', v_trig_count;
  END IF;

  INSERT INTO public._workstream1_baseline_metadata (
    object_name, owner_role, prosecdef, proconfig, acl_is_null, acl_entries, funcdef, trigdef, tgenabled
  )
  SELECT
    'campaign_log_delete',
    p.proowner::regrole::text,
    p.prosecdef,
    p.proconfig,
    (p.proacl IS NULL),
    CASE 
      WHEN p.proacl IS NULL THEN NULL 
      ELSE (
        SELECT jsonb_agg(jsonb_build_object(
          'grantee', CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE (e.grantee::regrole)::text END,
          'privilege_type', e.privilege_type,
          'is_grantable', e.is_grantable
        ))
        FROM aclexplode(p.proacl) e
      )
    END,
    pg_get_functiondef(p.oid),
    pg_get_triggerdef(t.oid),
    t.tgenabled::text
  FROM pg_proc p
  JOIN pg_trigger t ON t.oid = v_trig_oid
  WHERE p.oid = v_func_oid
  ON CONFLICT (object_name) DO NOTHING;
END $$;

-- 3. Execute transactional archival, purge, and invalid reference cleanup
DO $$
DECLARE
  v_unverified_orphans bigint;
  v_expected_purge_count bigint;
  v_actual_purged_count bigint;
  v_invalid_user_count bigint;
BEGIN
  -- A. Archive orphans without overwriting existing evidence
  INSERT INTO public._campaign_deletions_orphans_backup (
    campaign_id, team_id, name, status, snapshot, leads, sent, deleted_by, deleted_at, archived_at
  )
  SELECT
    cd.campaign_id, cd.team_id, cd.name, cd.status, cd.snapshot, cd.leads, cd.sent, cd.deleted_by, cd.deleted_at, now()
  FROM public.campaign_deletions cd
  WHERE NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = cd.team_id)
  ON CONFLICT (campaign_id) DO NOTHING;

  -- B. Null-safe completeness verification: every orphan must have an exact backup match
  SELECT count(*) INTO v_unverified_orphans
  FROM public.campaign_deletions cd
  WHERE NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = cd.team_id)
    AND NOT EXISTS (
      SELECT 1 FROM public._campaign_deletions_orphans_backup b
      WHERE b.campaign_id = cd.campaign_id
        AND b.team_id IS NOT DISTINCT FROM cd.team_id
        AND b.name IS NOT DISTINCT FROM cd.name
        AND b.status IS NOT DISTINCT FROM cd.status
        AND b.snapshot IS NOT DISTINCT FROM cd.snapshot
        AND b.leads IS NOT DISTINCT FROM cd.leads
        AND b.sent IS NOT DISTINCT FROM cd.sent
        AND b.deleted_by IS NOT DISTINCT FROM cd.deleted_by
        AND b.deleted_at IS NOT DISTINCT FROM cd.deleted_at
    );

  IF v_unverified_orphans > 0 THEN
    RAISE EXCEPTION 'Migration 070 Aborted: % orphan records in campaign_deletions have no matching backup row', v_unverified_orphans;
  END IF;

  -- C. Calculate expected purge count
  SELECT count(*) INTO v_expected_purge_count
  FROM public.campaign_deletions cd
  WHERE NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = cd.team_id);

  -- D. Purge verified orphans and capture actual count
  WITH purged AS (
    DELETE FROM public.campaign_deletions cd
    WHERE NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = cd.team_id)
    RETURNING cd.campaign_id
  )
  SELECT count(*) INTO v_actual_purged_count FROM purged;

  IF v_actual_purged_count <> v_expected_purge_count THEN
    RAISE EXCEPTION 'Migration 070 Aborted: Purge count mismatch (expected %, actual %)', v_expected_purge_count, v_actual_purged_count;
  END IF;

  -- E. Post-purge verification
  IF EXISTS (SELECT 1 FROM public.campaign_deletions cd WHERE NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = cd.team_id)) THEN
    RAISE EXCEPTION 'Migration 070 Aborted: Orphan records still exist in campaign_deletions after purge';
  END IF;

  -- F. Handle invalid deleted_by references before adding FK constraint
  SELECT count(*) INTO v_invalid_user_count
  FROM public.campaign_deletions cd
  WHERE cd.deleted_by IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = cd.deleted_by);

  IF v_invalid_user_count > 0 THEN
    RAISE NOTICE 'Detected % rows in campaign_deletions with invalid deleted_by references', v_invalid_user_count;

    -- Preserve original deleted_by in recovery table
    INSERT INTO public._campaign_deletions_invalid_users_backup (campaign_id, invalid_deleted_by, archived_at)
    SELECT cd.campaign_id, cd.deleted_by, now()
    FROM public.campaign_deletions cd
    WHERE cd.deleted_by IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = cd.deleted_by)
    ON CONFLICT (campaign_id) DO NOTHING;

    -- Preserve in row snapshot and safely apply nullification policy
    UPDATE public.campaign_deletions cd
    SET snapshot = jsonb_set(coalesce(cd.snapshot, '{}'::jsonb), '{_original_deleted_by}', to_jsonb(cd.deleted_by::text)),
        deleted_by = NULL
    WHERE cd.deleted_by IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = cd.deleted_by);

    -- Confirm zero invalid references remain
    IF EXISTS (
      SELECT 1 FROM public.campaign_deletions cd
      WHERE cd.deleted_by IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = cd.deleted_by)
    ) THEN
      RAISE EXCEPTION 'Migration 070 Aborted: Failed to nullify invalid deleted_by references';
    END IF;
  ELSE
    RAISE NOTICE 'Zero invalid deleted_by references detected in campaign_deletions';
  END IF;
END $$;

-- 4. Update campaign_log_delete() to prevent cascade foreign key violations
CREATE OR REPLACE FUNCTION public.campaign_log_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- If parent team does not exist or is being deleted, skip tombstone creation
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

-- 5. Strict Foreign Key definition verification and creation
DO $$
DECLARE
  v_other_rel text;
  v_rec record;
BEGIN
  -- ---------------------------------------------------------------------------
  -- Verify team_id FK definition
  -- ---------------------------------------------------------------------------
  -- A. Detect same-named constraint on any other relation in the database
  SELECT n.nspname || '.' || t.relname INTO v_other_rel
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE c.conname = 'campaign_deletions_team_id_fkey'
    AND (n.nspname <> 'public' OR t.relname <> 'campaign_deletions');

  IF v_other_rel IS NOT NULL THEN
    RAISE EXCEPTION 'Strict FK check failed: Constraint campaign_deletions_team_id_fkey exists on another relation: %', v_other_rel;
  END IF;

  -- B. Check target constraint on public.campaign_deletions
  SELECT 
    n.nspname AS schema_name,
    t.relname AS table_name,
    (
      SELECT array_agg(a.attname::text ORDER BY u.ord)
      FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
    ) AS con_cols,
    fn.nspname AS ref_schema,
    ft.relname AS ref_table,
    (
      SELECT array_agg(a.attname::text ORDER BY u.ord)
      FROM unnest(c.confkey) WITH ORDINALITY AS u(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = u.attnum
    ) AS conf_cols,
    c.confdeltype AS on_delete_action
  INTO v_rec
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_class ft ON ft.oid = c.confrelid
  JOIN pg_namespace fn ON fn.oid = ft.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'campaign_deletions'
    AND c.conname = 'campaign_deletions_team_id_fkey'
    AND c.contype = 'f';

  IF FOUND THEN
    IF v_rec.con_cols <> ARRAY['team_id']
       OR v_rec.ref_schema <> 'public'
       OR v_rec.ref_table <> 'teams'
       OR v_rec.conf_cols <> ARRAY['id']
       OR v_rec.on_delete_action <> 'c' THEN
      RAISE EXCEPTION 'Constraint campaign_deletions_team_id_fkey exists on public.campaign_deletions but definition is incorrect (Columns: %, RefSchema: %, RefTable: %, RefColumns: %, OnDelete: %)',
        v_rec.con_cols, v_rec.ref_schema, v_rec.ref_table, v_rec.conf_cols, v_rec.on_delete_action;
    END IF;
  ELSE
    ALTER TABLE public.campaign_deletions
      ADD CONSTRAINT campaign_deletions_team_id_fkey
      FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;
  END IF;

  -- ---------------------------------------------------------------------------
  -- Verify deleted_by FK definition
  -- ---------------------------------------------------------------------------
  -- A. Detect same-named constraint on any other relation in the database
  SELECT n.nspname || '.' || t.relname INTO v_other_rel
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE c.conname = 'campaign_deletions_deleted_by_fkey'
    AND (n.nspname <> 'public' OR t.relname <> 'campaign_deletions');

  IF v_other_rel IS NOT NULL THEN
    RAISE EXCEPTION 'Strict FK check failed: Constraint campaign_deletions_deleted_by_fkey exists on another relation: %', v_other_rel;
  END IF;

  -- B. Check target constraint on public.campaign_deletions
  SELECT 
    n.nspname AS schema_name,
    t.relname AS table_name,
    (
      SELECT array_agg(a.attname::text ORDER BY u.ord)
      FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
    ) AS con_cols,
    fn.nspname AS ref_schema,
    ft.relname AS ref_table,
    (
      SELECT array_agg(a.attname::text ORDER BY u.ord)
      FROM unnest(c.confkey) WITH ORDINALITY AS u(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = u.attnum
    ) AS conf_cols,
    c.confdeltype AS on_delete_action
  INTO v_rec
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_class ft ON ft.oid = c.confrelid
  JOIN pg_namespace fn ON fn.oid = ft.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'campaign_deletions'
    AND c.conname = 'campaign_deletions_deleted_by_fkey'
    AND c.contype = 'f';

  IF FOUND THEN
    IF v_rec.con_cols <> ARRAY['deleted_by']
       OR v_rec.ref_schema <> 'auth'
       OR v_rec.ref_table <> 'users'
       OR v_rec.conf_cols <> ARRAY['id']
       OR v_rec.on_delete_action <> 'n' THEN
      RAISE EXCEPTION 'Constraint campaign_deletions_deleted_by_fkey exists on public.campaign_deletions but definition is incorrect (Columns: %, RefSchema: %, RefTable: %, RefColumns: %, OnDelete: %)',
        v_rec.con_cols, v_rec.ref_schema, v_rec.ref_table, v_rec.conf_cols, v_rec.on_delete_action;
    END IF;
  ELSE
    ALTER TABLE public.campaign_deletions
      ADD CONSTRAINT campaign_deletions_deleted_by_fkey
      FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;