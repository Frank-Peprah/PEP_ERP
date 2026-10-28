# Changelog

## 0.2.0 — 2026-10-28 — Release 2: Financial Reporting & Assurance Engine
- **Statement engine** (`apps/api/src/services/statements.ts`): statement of financial position, profit or loss and OCI
  (expenses by function), changes in equity, cash flows (indirect method) and notes, generated from posted ledger lines
  only, through a versioned template (`IFRS_GENERAL` v1). Retained earnings include prior-year results presentationally.
- **Cross-checks on every pack:** SFP balances; P&L ties to the ledger result; net cash flow equals movement in cash;
  changes in equity close at SFP equity; every note casts to its statement line; every balance mapped.
- **Exceptions:** unmapped balances (blocking above entity materiality, warning below), mapping type mismatches,
  unknown line codes, unclassified cash-flow movements, open periods, template narrative wording, live comparatives.
- **Comparatives:** year-end packs take the prior year from its *final* frozen pack; interim packs take the prior
  year-end position from that pack and the same months' performance from the ledger (IAS 34 pattern).
- **Workflow:** draft → under review → approved → final, plus return, reject, withdraw. Accountant prepares;
  controller approves and finalises; the preparer can never approve or finalise (SoD). Finalisation requires zero
  blocking exceptions and every period to the statement date locked. A run goes stale (409) if the ledger, mappings or
  comparatives change after generation. Regenerating supersedes the open run for the same date.
- **Migration 004:** `report_templates` (append-only), `financial_statement_runs` (pack frozen at insert, SHA-256
  content hash computed by the database, final/superseded/rejected immutable, no deletes, one final run per date,
  DB check that a final run has an independent approver), entity `materiality_threshold`, statement permissions.
- **Web:** Financial Statements and Notes pages — live preview, run list, workflow timeline, checks & exceptions,
  DRAFT watermark until final, Print/PDF (all statements, A4), Excel workbook (one sheet per statement), CSV.
- Tests: 65 (adds 17 statement tests covering spec #10, #11, #12, #16, #18, #21).

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
