-- PEP ERP — Migration 005 (Blueprint Phase 0): least-privilege application role,
-- row-level security read policies, and the identity link to Supabase Auth.
--
-- 1. pep_app: the role the API runs as. Not superuser, not table owner, so it cannot
--    ALTER/DROP tables, disable triggers or bypass RLS. It gets only the DML each table
--    needs (audit log: insert + select; statement runs: no delete; etc.). LOGIN and the
--    password are set per environment, never in a migration.
-- 2. pep_app policies are permissive (USING true): the API already scopes every query to
--    the caller's entity, and triggers enforce the accounting invariants. RLS here stops
--    any *other* non-owner role from reading or writing.
-- 3. authenticated (Supabase Auth users, via PostgREST): SELECT only, filtered by entity
--    membership AND permission AND MFA (aal2), through private.entities_with(perm).
--    No INSERT/UPDATE/DELETE for authenticated on any table: every change goes through
--    the command API. Sensitive columns (entities.tin_encrypted) are not granted.
-- 4. users.auth_user_id links a PEP user to a Supabase Auth user (auth.users.id).
-- 5. btree_gist moves out of the public schema (Supabase advisor 0014).

-- ── Roles (cluster-wide; idempotent) ──────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pep_app') THEN
    CREATE ROLE pep_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  -- Present on Supabase; created here so plain-Postgres environments (CI, local) match.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END $$;

-- ── Extensions out of public ──────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS extensions;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
              WHERE e.extname = 'btree_gist' AND n.nspname = 'public') THEN
    ALTER EXTENSION btree_gist SET SCHEMA extensions;
  END IF;
END $$;

-- ── Identity link ─────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN auth_user_id uuid UNIQUE;
COMMENT ON COLUMN users.auth_user_id IS 'Supabase Auth user id (auth.users.id). NULL = cannot sign in through Supabase Auth.';

-- ── pep_app privileges ────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO pep_app;
DO $$
DECLARE s text;
BEGIN
  -- Trigger functions resolve pgcrypto (digest) from its schema; pep_app needs USAGE there.
  FOR s IN SELECT DISTINCT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
            WHERE e.extname IN ('pgcrypto', 'btree_gist') LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO pep_app', s);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  entities, users, user_entity_roles, financial_years, accounting_periods,
  accounts, journal_entries, journal_lines
TO pep_app;
GRANT SELECT ON roles, role_permissions, app_config TO pep_app;
GRANT SELECT, INSERT, UPDATE ON journal_sequences TO pep_app;
GRANT SELECT, INSERT ON audit_events TO pep_app;                       -- append-only
GRANT SELECT, INSERT ON report_templates TO pep_app;                   -- append-only
GRANT SELECT, INSERT, UPDATE ON financial_statement_runs TO pep_app;   -- no DELETE
GRANT SELECT ON ledger_postings TO pep_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pep_app;
GRANT EXECUTE ON FUNCTION verify_audit_chain() TO pep_app;
-- No access at all: schema_migrations.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'entities','users','user_entity_roles','financial_years','accounting_periods','accounts',
    'journal_entries','journal_lines','journal_sequences','audit_events','report_templates',
    'financial_statement_runs','roles','role_permissions','app_config']
  LOOP
    EXECUTE format('CREATE POLICY pep_app_all ON %I FOR ALL TO pep_app USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- ── Helper for authenticated policies ─────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

-- JWT claims as PostgREST/Supabase sets them (request.jwt.claims). Works on plain Postgres too.
CREATE FUNCTION private.jwt_claims() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

-- Entity ids where the signed-in user holds permission p_perm.
-- Returns an empty array unless the session is MFA-verified (aal2).
-- Takes no row column, so `(select private.entities_with('x'))` in a policy is evaluated once
-- per statement (initPlan), not once per row (Supabase RLS performance guidance).
CREATE FUNCTION private.entities_with(p_perm text) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN private.jwt_claims() ->> 'aal' IS DISTINCT FROM 'aal2' THEN '{}'::uuid[]
         ELSE coalesce((
           SELECT array_agg(DISTINCT uer.entity_id)
             FROM users u
             JOIN user_entity_roles uer ON uer.user_id = u.id
             JOIN role_permissions rp   ON rp.role_code = uer.role_code
            WHERE u.auth_user_id = nullif(private.jwt_claims() ->> 'sub', '')::uuid
              AND u.is_active
              AND rp.permission = p_perm), '{}'::uuid[]) END
$$;

-- The PEP user id of the signed-in Supabase user (or NULL).
CREATE FUNCTION private.current_pep_user() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM users
   WHERE auth_user_id = nullif(private.jwt_claims() ->> 'sub', '')::uuid AND is_active
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.jwt_claims(), private.entities_with(text), private.current_pep_user() TO authenticated;

-- ── authenticated: read-only, entity + permission + MFA ───────────────────────
GRANT USAGE ON SCHEMA public TO authenticated;

-- entities: every column except tin_encrypted
GRANT SELECT (id, code, legal_name, trading_name, registration_no, jurisdiction, industry,
              reporting_framework, functional_currency, presentation_currency, segregation_enabled,
              retained_earnings_account_id, materiality_threshold, created_at, updated_at)
  ON entities TO authenticated;
CREATE POLICY auth_read ON entities FOR SELECT TO authenticated
  USING (id = ANY ((SELECT private.entities_with('entity.read'))::uuid[]));

GRANT SELECT ON financial_years, accounting_periods, accounts, journal_entries, journal_lines,
                audit_events, financial_statement_runs, report_templates, roles, role_permissions,
                user_entity_roles, ledger_postings TO authenticated;
GRANT SELECT (id, email, full_name, is_active, created_at) ON users TO authenticated;

CREATE POLICY auth_read ON financial_years FOR SELECT TO authenticated
  USING (entity_id = ANY ((SELECT private.entities_with('entity.read'))::uuid[]));
CREATE POLICY auth_read ON accounting_periods FOR SELECT TO authenticated
  USING (entity_id = ANY ((SELECT private.entities_with('entity.read'))::uuid[]));
CREATE POLICY auth_read ON accounts FOR SELECT TO authenticated
  USING (entity_id = ANY ((SELECT private.entities_with('coa.read'))::uuid[]));
CREATE POLICY auth_read ON journal_entries FOR SELECT TO authenticated
  USING (entity_id = ANY ((SELECT private.entities_with('journal.read'))::uuid[]));
CREATE POLICY auth_read ON journal_lines FOR SELECT TO authenticated
  USING (journal_id IN (SELECT id FROM journal_entries
                         WHERE entity_id = ANY ((SELECT private.entities_with('journal.read'))::uuid[])));
CREATE POLICY auth_read ON audit_events FOR SELECT TO authenticated
  USING (entity_id = ANY ((SELECT private.entities_with('audit.read'))::uuid[]));
CREATE POLICY auth_read ON financial_statement_runs FOR SELECT TO authenticated
  USING (entity_id = ANY ((SELECT private.entities_with('reports.read'))::uuid[]));
CREATE POLICY auth_read ON report_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_read ON roles FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_read ON role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_read ON user_entity_roles FOR SELECT TO authenticated
  USING (user_id = (SELECT private.current_pep_user())
         OR entity_id = ANY ((SELECT private.entities_with('users.manage'))::uuid[]));
CREATE POLICY auth_read ON users FOR SELECT TO authenticated
  USING (id = (SELECT private.current_pep_user()));
-- journal_sequences, app_config, schema_migrations: no grant, no policy → invisible.

-- Indexes backing the policies (entity_id is already the leading column of the main
-- entity-scoped indexes; these cover the remaining lookups).
CREATE INDEX IF NOT EXISTS uer_entity ON user_entity_roles (entity_id);
CREATE INDEX IF NOT EXISTS fy_entity ON financial_years (entity_id);
CREATE INDEX IF NOT EXISTS ap_entity ON accounting_periods (entity_id);
CREATE INDEX IF NOT EXISTS acc_entity ON accounts (entity_id);
CREATE INDEX IF NOT EXISTS jl_journal ON journal_lines (journal_id);

-- anon gets nothing (002 already revoked; restated for clarity on new objects).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
