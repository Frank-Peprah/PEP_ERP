-- PEP ERP — Migration 003: server-side runtime configuration
-- Holds secrets the API needs when the hosting platform's environment variables are not set
-- (e.g. AUTH_SECRET, STAGING_ACCESS_CODE on Supabase Edge Functions). Environment variables,
-- when present, always take precedence. Values are generated inside the database where possible
-- so they never transit chat, logs or source control.
CREATE TABLE app_config (
  key         text PRIMARY KEY CHECK (key ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  value       text NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;  -- no policies: invisible to non-owner roles

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON app_config FROM %I', r);
    END IF;
  END LOOP;
END $$;
