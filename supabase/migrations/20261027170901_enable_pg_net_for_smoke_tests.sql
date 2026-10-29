-- pep:hosted-only — skipped by database/migrate.ts on plain Postgres (CI, local).
-- Staging smoke tests call the deployed API from inside the database with pg_net.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
