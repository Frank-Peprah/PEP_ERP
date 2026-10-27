-- PEP ERP — Migration 002: row-level security baseline and hosted-platform hardening
--
-- 1. Enable RLS on every table. No policies are defined, so any role that does not
--    own the tables (or hold BYPASSRLS) sees nothing. The PEP API connects as the
--    owning role; RLS policies per entity are added when the API moves to a
--    non-owner role (SECURITY.md blocker 2).
-- 2. Views execute with the caller's privileges (security_invoker), so they cannot
--    be used to read around RLS.
-- 3. On hosted Postgres that auto-exposes the public schema over REST (e.g. Supabase
--    roles anon / authenticated), revoke all access. No-op where those roles don't exist.
-- 4. Pin search_path on trigger functions so pgcrypto resolves on platforms that
--    install extensions in a separate schema.

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

ALTER VIEW ledger_postings SET (security_invoker = true);

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE ext_schema text;
BEGIN
  SELECT n.nspname INTO ext_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pgcrypto';
  EXECUTE format('ALTER FUNCTION trg_audit_chain() SET search_path = public, %I', ext_schema);
  EXECUTE format('ALTER FUNCTION verify_audit_chain() SET search_path = public, %I', ext_schema);
  ALTER FUNCTION trg_period_within_fy() SET search_path = public;
  ALTER FUNCTION trg_account_guard() SET search_path = public;
  ALTER FUNCTION trg_lines_frozen() SET search_path = public;
  ALTER FUNCTION trg_journal_guard() SET search_path = public;
  ALTER FUNCTION trg_audit_append_only() SET search_path = public;
END $$;
