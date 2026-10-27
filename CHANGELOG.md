# Changelog

## 0.1.2 — 2026-10-27 — SiteGround hosting option
- Web app API origin configurable via `VITE_API_BASE`; Apache `.htaccess` for SPA routing and security headers.
- CORS now allows PUT/PATCH/DELETE and the app's custom headers (regression test added; 43 tests).

## 0.1.1 — 2026-10-27 — Staging deployment
- Migration 002: RLS on all tables, security_invoker ledger view, revoke hosted REST roles, pinned function search_path.
- Supabase Edge Function bundle of the API (`scripts/build-edge.mjs`); Netlify config for the web app.
- Staging access-code gate on demo login; portable SQL demo seed (`database/seeds/demo_seed.sql`).

## 0.1.0 — 2026-10-27 — Release 1 vertical slice
- Accounting core schema with database-enforced invariants (balance, immutability, period lock, workflow, audit chain).
- Journal workflow with segregation of duties, linked reversals, gapless numbering, idempotent creation, optimistic locking.
- General ledger with running balances; trial balance (YTD/period) with exception detection.
- RBAC per entity; entity isolation.
- React web app: dashboard, journals (grid entry), ledger, TB (CSV export), chart of accounts, periods, audit trail.
- 42 automated tests; 100k-line performance check (TB 130 ms).
- Demo seed: Trulander JSF Limited and Pep Landbank Ltd (illustrative data).
