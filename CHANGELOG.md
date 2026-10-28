# Changelog

## 0.1.4 — 2026-10-28 — Pages live; workflow buttons fixed
- Pages: the built app is committed to `app/` with root `index.html`/`404.html` redirects and `.nojekyll`, so the
  branch-based Pages build publishes the app. That ends the race in which Jekyll overwrote the Actions deploy with README.md.
  Relative asset paths (`VITE_BASE=./`); `scripts/build-pages.sh`; workflow rebuilds and commits `app/` and deploys `_site/`.
- **Bug fix:** Submit / Approve / Post / Return / Lock failed with HTTP 400 from the web app, which sent
  `content-type: application/json` with no body. Web now omits the header without a body; API also accepts empty JSON bodies.
- **Bug fix:** after *Switch user*, signing in as another user of the same entity hung on "Loading…". Entity now reloads
  per user; load failures show an error with a way back to sign-in.
- Migration 003 `app_config`: API reads `AUTH_SECRET` / `STAGING_ACCESS_CODE` / `CORS_ORIGIN` from env, else this locked table.
  CORS allow-list is evaluated per request. Staging secrets generated in-database.
- Tests: 48 (adds empty-body workflow, DB-sourced secrets, env precedence, CORS allow-list). Browser end-to-end test of
  the exact Pages artefact: access gate → sign-in → dashboard → TB → submit → approve → post.

## 0.1.3 — 2026-10-28 — GitHub Pages deployment fix
- Root cause: Pages was publishing the repo via Jekyll ("Deploy from a branch"), which renders README.md; the React app was never built.
- Added `.github/workflows/deploy-pages.yml` (npm ci → Vite build with `VITE_BASE=/PEP_ERP/` → Pages artefact with `.nojekyll` and `404.html`).
- Vite `base` configurable via `VITE_BASE`.
- Missing `AUTH_SECRET` now returns 503 `AUTH_NOT_CONFIGURED` instead of a generic 500; network failures show a readable message (44 tests).

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
