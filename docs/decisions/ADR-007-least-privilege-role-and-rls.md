# ADR-007 — Commands as a least-privilege role; reads through RLS

**Status:** accepted (Blueprint Phase 0) · **Date:** 2026-10-29

## Decision
1. **The API runs as `pep_app`** (migration 005):
   - not a superuser, not a table owner, and has no BYPASSRLS;
   - holds only the DML each table needs (the audit log is insert/select only; statement runs cannot be deleted; `schema_migrations` is not visible);
   - cannot alter tables, disable the invariant triggers or set `session_replication_role`.
2. **The role is applied per transaction (`SET LOCAL ROLE`)**, and stand-alone queries are wrapped in a transaction. This is correct behind Supabase's transaction-mode pooler, where session settings neither persist nor stay private to one client. Migration 006 grants SET on `pep_app` to the connection role, because Supabase gives a role's creator ADMIN but not SET.
3. **Supabase Auth users (`authenticated`) can read only, through RLS.** A row is visible only if:
   - it belongs to an entity where the user holds the permission (`private.entities_with(perm)`, evaluated once per statement), and
   - the session is two-step verified (aal2).

   Sensitive columns (`entities.tin_encrypted`) are not granted, and no write privilege is granted to `authenticated` on any table. `anon` has nothing.

## Deviation from Blueprint 04 §1
The blueprint proposes moving tables to an unexposed `pep` schema and exposing `api` views. Phase 0 achieves the same guarantees without moving tables: no write grants, column-level read grants, and RLS on every table. Moving tables would mean a large, risky rename while the API uses unqualified names. Shaped `api` views are added when a screen needs them.

## Production follow-up (Phase 4)
Replace `SET LOCAL ROLE` with a dedicated LOGIN role for `pep_app`, whose password is set by the CEO in the Supabase dashboard. The current connection role can still `RESET ROLE`, so a SQL-injection flaw could escalate. Parameterised SQL throughout the API mitigates this until then.

## Evidence
- `tests/security/roles-and-rls.test.ts`: 14 tests.
- The full suite (96 tests) runs as `pep_app`. Tamper tests use an owner-level connection, which proves the triggers hold even against privileged SQL.
- On staging, the Supabase security advisor reports 0 findings after migration 005.
