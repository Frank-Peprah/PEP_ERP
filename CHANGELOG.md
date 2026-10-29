# Changelog

## 0.4.0-dev — 2026-10-29 — Blueprint Phase 0 (in progress): identity, least privilege, CI
Plan of record: `docs/blueprint/` (Build Blueprint v1.0). Status: `docs/phases/P0-status.md`.
- **Supabase Auth with mandatory two-step verification** (ADR-006): the API verifies Supabase JWTs (JWKS or legacy
  HS256; audience and issuer checked); finance routes require aal2 (`MFA_REQUIRED`); demo login refused in production.
  Web sign-in: email + password, then TOTP enrolment (QR + manual key) or challenge; auth client lazy-loaded (22 KB).
- **Least-privilege API role** (ADR-007, migrations 005–006): `pep_app` (no superuser, no BYPASSRLS, not owner),
  applied per transaction; audit log insert-only; statement runs undeletable; no DDL; cannot disable triggers.
- **RLS read policies** for Supabase Auth users: entity + permission + MFA; sensitive columns not granted; no writes.
- **CI** (`.github/workflows/ci.yml`): Postgres 17, full suite as `pep_app`, budgets, 14 browser journeys with axe,
  edge build; licence gate, npm audit, gitleaks.
- Tests: 96 (adds 14 role/RLS and 8 Supabase Auth tests). Staging: Supabase security advisor 0 findings.
- Fix: Edge entry no longer writes reserved `SUPABASE_*` env vars (caused a 15-minute staging outage on deploy).

## 0.3.0 — 2026-10-29 — UI Phase 0: design system, app shell, dashboard
Blueprint: "PEP ERP — UI Blueprint" (100 screens, six phases, go-live 19 Feb 2027).
- **Stack (Option A):** React 19, Vite 8, Tailwind CSS 4, Radix UI primitives, React Router 8, TanStack Query, cmdk,
  Sonner, Lucide icons; fonts self-hosted (no Google Fonts requests). Charts are plain SVG (`design/ComboChart.tsx`):
  a charting library would have cost 105 KB and broken the 80 KB module budget.
- **Design system** (`apps/web/src/design`): navy/gold tokens from the reference, semantic colours that pass WCAG AA
  (text uses the -700 shades), motion rules from Emil Kowalski's design-engineering skill: press scale 0.97, menus scale
  from their trigger with a strong ease-out, drawer curve for the phone menu, no animation on the command palette,
  hover gated to fine pointers, reduced-motion respected.
- **App shell** (`apps/web/src/shell`): grouped navy sidebar; top bar with Ctrl/Cmd+K command palette (screens,
  accounts, journals, actions, entity switch), entity switcher that keeps the current screen, global period switcher,
  work bell with role-aware counts, user menu; phone bottom bar and slide-in menu; lock banner on locked periods.
  Entity and period live in the URL (`/trulander/trial-balance?period=2026-10`). Roadmap modules show their phase.
- **Dashboard (G01) rebuilt to the reference** on a new endpoint `GET /entities/:id/dashboard`: four KPIs with a stated
  comparison basis, 12-month revenue/expenses/net-profit chart, financial position (ties), role-aware tasks, period
  close, latest statement run, trial-balance check, audit-chain status. Every card links to its source.
- **System pages** Z01 Not found, Z02 No access, Z03 Offline. Release 1–2 screens run inside the new shell through a
  bridge until Phase 1 rebuilds them; their stylesheet sits in a lower CSS layer. Emoji removed from all screens.
- **Security:** content security policy (meta tag in every build; header plus HSTS and Permissions-Policy in the
  SiteGround `.htaccess`); no data: URIs in the build.
- **Performance budgets** enforced by `scripts/check-budgets.sh` (shell 167 KB of 180 KB; modules 1–6 KB of 80 KB).
- **Tests:** 74 unit/API/database tests (adds dashboard and formatting) and `tests/e2e/phase0.e2e.mjs`: 14 browser
  journeys at 1440 px and 390 px with axe accessibility checks, run against the local build and the exact Pages artefact.
- Staging Pages build uses hash routes (`#/trulander/dashboard`) because Pages cannot rewrite paths.

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
