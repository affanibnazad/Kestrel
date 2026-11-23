-- Migration 071: Vault Secret Cleanup Triggers
-- Workstream 1 (Database Reliability)

-- 1. Create baseline metadata table for Vault trigger objects
CREATE TABLE IF NOT EXISTS public._workstream1_vault_triggers_baseline_metadata (
  object_type text NOT NULL, -- 'function' or 'trigger'
  object_name text NOT NULL,
  table_name  text NOT NULL DEFAULT '',
  existed     boolean NOT NULL,
  owner_role  text,
  prosecdef   boolean,
  proconfig   text[],
  acl_is_null boolean,
  acl_entries jsonb,
  def_sql     text,
  tgenabled   text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (object_type, object_name, table_name)
);
ALTER TABLE public._workstream1_vault_triggers_baseline_metadata ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._workstream1_vault_triggers_baseline_metadata FROM public, anon, authenticated;

-- 2. Detect and capture pre-existing objects before modification
DO $$
DECLARE
  v_func_oid oid;
  v_trig_oid oid;
  v_tbl text;
  v_trig text;
  v_tables text[] := ARRAY['mailboxes', 'team_keys', 'team_webhooks', 'seed_inboxes'];
  v_trigs text[] := ARRAY['mailboxes_vault_cleanup', 'team_keys_vault_cleanup', 'team_webhooks_vault_cleanup', 'seed_inboxes_vault_cleanup'];
  i int;
BEGIN
  -- A. Inspect pre-existing cleanup_vault_secret function
  SELECT p.oid INTO v_func_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'cleanup_vault_secret';

  IF v_func_oid IS NOT NULL THEN
    INSERT INTO public._workstream1_vault_triggers_baseline_metadata (
      object_type, object_name, table_name, existed, owner_role, prosecdef, proconfig, acl_is_null, acl_entries, def_sql
    )
    SELECT
      'function',
      'cleanup_vault_secret',
      '',
      true,
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
      pg_get_functiondef(p.oid)
    FROM pg_proc p
    WHERE p.oid = v_func_oid
    ON CONFLICT (object_type, object_name, table_name) DO NOTHING;
  ELSE
    INSERT INTO public._workstream1_vault_triggers_baseline_metadata (
      object_type, object_name, table_name, existed
    ) VALUES (
      'function', 'cleanup_vault_secret', '', false
    ) ON CONFLICT (object_type, object_name, table_name) DO NOTHING;
  END IF;

  -- B. Inspect each of the 4 triggers
  FOR i IN 1..4 LOOP
    v_tbl := v_tables[i];
    v_trig := v_trigs[i];

    SELECT t.oid INTO v_trig_oid
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' 
      AND c.relname = v_tbl 
      AND t.tgname = v_trig 
      AND NOT t.tgisinternal;

    IF v_trig_oid IS NOT NULL THEN
      INSERT INTO public._workstream1_vault_triggers_baseline_metadata (
        object_type, object_name, table_name, existed, def_sql, tgenabled
      )
      SELECT
        'trigger',
        v_trig,
        v_tbl,
        true,
        pg_get_triggerdef(t.oid),
        t.tgenabled::text
      FROM pg_trigger t
      WHERE t.oid = v_trig_oid
      ON CONFLICT (object_type, object_name, table_name) DO NOTHING;
    ELSE
      INSERT INTO public._workstream1_vault_triggers_baseline_metadata (
        object_type, object_name, table_name, existed
      ) VALUES (
        'trigger', v_trig, v_tbl, false
      ) ON CONFLICT (object_type, object_name, table_name) DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- 3. Create or replace cleanup trigger function
CREATE OR REPLACE FUNCTION public.cleanup_vault_secret() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
BEGIN
  IF old.secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = old.secret_id;
  END IF;
  RETURN old;
END $$;

REVOKE ALL ON FUNCTION public.cleanup_vault_secret() FROM public, anon, authenticated;

-- 4. Attach BEFORE DELETE triggers to all 4 secret-referencing tables
DROP TRIGGER IF EXISTS mailboxes_vault_cleanup ON public.mailboxes;
CREATE TRIGGER mailboxes_vault_cleanup
BEFORE DELETE ON public.mailboxes
FOR EACH ROW EXECUTE FUNCTION public.cleanup_vault_secret();

DROP TRIGGER IF EXISTS team_keys_vault_cleanup ON public.team_keys;
CREATE TRIGGER team_keys_vault_cleanup
BEFORE DELETE ON public.team_keys
FOR EACH ROW EXECUTE FUNCTION public.cleanup_vault_secret();

DROP TRIGGER IF EXISTS team_webhooks_vault_cleanup ON public.team_webhooks;
CREATE TRIGGER team_webhooks_vault_cleanup
BEFORE DELETE ON public.team_webhooks
FOR EACH ROW EXECUTE FUNCTION public.cleanup_vault_secret();

DROP TRIGGER IF EXISTS seed_inboxes_vault_cleanup ON public.seed_inboxes;
CREATE TRIGGER seed_inboxes_vault_cleanup
BEFORE DELETE ON public.seed_inboxes
FOR EACH ROW EXECUTE FUNCTION public.cleanup_vault_secret();