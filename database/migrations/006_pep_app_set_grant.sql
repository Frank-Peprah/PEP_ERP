-- PEP ERP — Migration 006: allow the migrating/connection role to SET ROLE pep_app.
-- On Supabase (PG 16+), the creator of a role receives ADMIN OPTION but not SET, so
-- 005's membership check passed while SET ROLE was still refused. Check SET explicitly.
DO $$
BEGIN
  IF NOT pg_has_role(current_user, 'pep_app', 'SET') THEN
    EXECUTE format('GRANT pep_app TO %I WITH INHERIT FALSE, SET TRUE', current_user);
  END IF;
END $$;
