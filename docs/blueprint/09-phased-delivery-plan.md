# 09 — Phased delivery plan

**Cadence:** two-week sprints, Mon–Fri. Back end and front end are built together in every phase: no screen ships without its API, and no API ships without its screen.

**Every phase runs the same four steps:**

| Step | What happens | Output |
|---|---|---|
| **Plan** (days 1–2) | Confirm scope against this blueprint; resolve the decisions listed for the phase; write ADRs; write the phase test plan (golden datasets, scenarios) | `docs/phases/P<n>-plan.md`, ADRs |
| **Build** (days 3–8) | Migrations → domain rules → command services → `api` views + RLS → UI screens → docs. Small PRs to `main` behind feature flags | PRs with green CI |
| **Test** (days 8–9) | Full automated suite (10), phase gate tests, Playwright journeys, security scans, CEO review session (2–3 h, fixed day) | Gate report `docs/phases/P<n>-gate.md` |
| **Deploy** (day 10) | Tag `v0.<n+4>.0` (Phase 0 → v0.4.0; v0.3.0 was UI Phase 0) → migrations to staging → functions → web → smoke tests → release notes. Production deploys start at Phase 4 | Release notes, deploy log |

**Go-live target:** opening TB at 31 Dec 2026, live posting from 1 Jan 2027. **Production switch-on Fri 19 Feb 2027**, with January closed in parallel.

---

## Phase 0 — Re-platform & foundations · Mon 2 Nov → Fri 13 Nov 2026

**Goal:** the existing R1/R2 logic and the v0.3.0 UI shell run on the target platform (Supabase Auth, RLS, CI/CD) with zero regressions.

**Build:**
1. Repo restructure (03 §6).
   - UI shell and dashboard already done (v0.3.0). Add sign-in, MFA enrolment/challenge and session screens to the shell (shadcn-admin auth pages as the pattern).
   - Create `packages/grid` (Glide fork) and `packages/contracts`.
   - The Release 1–2 screens are rebuilt inside the shell by the UI programme's Phase 1, not here.
2. Supabase CLI project.
   - `supabase/config.toml`; migrations moved under the CLI convention, keeping the existing `database/migrate.ts` for local Postgres tests.
   - Move `btree_gist` out of `public` (advisor warning).
   - `supabase migration repair` on staging, plus a filename map in `database/migrate.ts`, so moved migrations are not re-run.
3. **Identity.**
   - Supabase Auth with MFA enrolment and challenge.
   - `users.auth_user_id` link.
   - API verifies the Supabase JWT and requires AAL2 for finance permissions.
   - Demo login kept for local dev only.
   - Staging access code retired once real auth is live.
4. **DB role and RLS.**
   - `pep_app` role; Edge Functions connect as `pep_app`.
   - `private.entities_with(perm)` helper (returns entity ids; evaluated once per statement).
   - Read policies on the 14 data tables. `app_config` gets no policies, and its secrets move to Vault.
   - **Move all tables from `public` to the unexposed `pep` schema** (`ALTER TABLE … SET SCHEMA`; `pep_app` search_path updated), so PostgREST only sees `api` views.
   - `api` schema views.
   - Basejump pgTAP helpers.
5. Split `pep-api` into the module functions `ledger` and `statements`, sharing packages.
6. **CI** (`.github/workflows/ci.yml`):
   - typecheck, Vitest (existing 65 tests), pgTAP, Playwright smoke;
   - licence check, gitleaks, npm audit, axe.
7. **CD:**
   - `deploy-staging.yml`: on merge to `main`, run migrations, deploy functions and deploy the web app.
   - `deploy-prod.yml`: on tag plus manual approval; inactive until Phase 4.
8. Security headers, CSP and rate limiting.
9. Sentry and the health page.
10. Groups, user invitations and `approval_policies` (thresholds by document type), used from Phase 2.
11. ADR-006 to ADR-012.

**Gate:**
- All existing tests pass unchanged.
- New tests for MFA, AAL1 denial, PostgREST isolation, `pep_app` privilege limits and licence policy all pass.
- The journal workflow passes end to end in Playwright on staging with real auth.

**Decisions needed:** D2 repo visibility by Mon 2 Nov; D3 production web host by Fri 6 Nov (12). *(v1.3: D17 closed; D1 moved to Mon 25 Jan 2027, Phase 4.)*

## Phase 1 — Ledger completion (R1b) · Mon 16 Nov → Fri 27 Nov 2026

**Build:**
- Dimensions (cost centre, project; the parcel dimension is added in Phase 2 with parcels).
- Attachments (Storage + drill-down).
- CSV/XLSX import wizard with preview grid (opening balances, journals, COA).
- Adjusted TB.
- **Year-end closing journal.**
- Recurring and auto-reversing journals.
- FX rate tables with manual entry (BoG reference default), currencies enabled per entity. *(v1.1: IAS 21 revaluation and the BoG daily fetch are deferred until an entity enables a foreign currency; Trulander is GHS-only.)*
- Close checklist with auto-checks.
- Audit-chain anchoring.
- Retention policy.
- pgmq + pg_cron worker skeleton.
- Realtime broadcast for approvals.
- IFRS for SMEs template.

**Gate:**
- 1,000-row opening-balance import reconciles to the control total.
- Closing journal leaves the TB balanced and P&L at zero.
- ~~Revaluation reverses on day 1 of the next period.~~ Deferred with IAS 21 revaluation (v1.1); auto-reversal on day 1 is proven for accruals.
- The anchor job publishes a hash and the verifier detects tampering.

**Decisions needed:** D4 year-end close mechanics (default: closing journal), D5 FX rate source, D6 IFRS vs IFRS for SMEs for Trulander.

**Parallel workstream (finance lead):** the opening-balance cleanup templates (`OPENING_BALANCES` plan) start now.

## Phase 2 — Real estate operations & receivables · Mon 30 Nov 2026 → Fri 8 Jan 2027 (6 weeks, including the holiday slowdown)

**Build:**
- Port the M0 posting engine (`business_events`, `posting_rules`, outbox) as new migrations, with an account-code remap table from the M0 template to the PEP chart.
- Parties with encrypted KYC.
- Estates and parcels with the status machine and cost components.
- Sale contracts.
- Instalment schedule generator, including the significant financing component (SFC) flag.
- Receipts (mobile-first; cash blocked on agency deals).
- Transfer of control.
- Cancellations and refunds.
- Mandates, client money and the escrow check.
- Commissions with capitalisation.
- AR invoices, credit notes and allocations.
- Ageing.
- Customer statements and signed statement link.
- SMS/WhatsApp receipts and reminders.
- REAC quarterly report.
- Stamp duty and CGT calculators.
- Collections and parcel-margin dashboards.
- Dunning runs (reminders before and after due date).

**Gate:**
- Trulander scenario book (40 cases) posts and ties out.
- Subledger = GL for AR and contract liabilities.
- Escrow = client-money liability.
- A parcel cannot be double-sold (concurrency test).
- Cash is refused on an agency receipt.

**Decisions needed:** D7 principal/agent mix and mandate terms, D8 revenue trigger event, D9 commission policy, D10 SMS/WhatsApp provider.

## Phase 3 — Payables, banking & MoMo · Mon 11 Jan → Fri 22 Jan 2027

**Build:**
- Bills and approvals.
- WHT at source and certificates. Rates are entered as draft rules and verified before Phase 5 activation; until then they are configurable per vendor.
- Payment runs with a bank file and MoMo bulk.
- Landowner and agent payouts.
- Bank, MoMo and gateway accounts.
- Import parsers: two banks Trulander uses, plus MTN MoMo and Paystack/Hubtel.
- Webhooks.
- Three-state matching with the rules engine and undo.
- Settlement clearing accounts.
- Reconciliation report with sign-off.
- Live cash position.
- Petty cash.
- ECL provision matrix (IFRS 9 simplified).

**Gate:**
- 3 months of real-format statements reconcile to zero difference.
- Auto-match precision ≥ 98%.
- SoD conflicts are blocked.
- Clearing accounts net to zero nightly.

**Decisions needed:** D11 banks and MoMo wallets in scope, D12 payment approval thresholds.

## Phase 4 — Hardening, rehearsal & production · Mon 25 Jan → Fri 5 Feb 2027

**Build and run:**
- Production Supabase project (Pro + PITR) and production web host.
- Domain and TLS.
- Load test: 1M lines; 50 concurrent users.
- **External pen test** and fixes.
- Restore drill: RPO/RTO measured.
- Access review.
- DPC registration certificate in hand (application started in Phase 0).
- Management reports (P&L by dimension) and the auditor export pack.
- User guides and in-app help.
- Training: 2 sessions per role.
- **Dress rehearsal:** load Oct–Dec 2026 real data into a *separate rehearsal copy*, close those months, and compare against the current books.

**Gate:**
- Pen test has no high or critical findings open.
- Restore within RTO.
- Rehearsal differences explained to below materiality.
- CEO go/no-go sign-off.

## Cutover & go-live · Mon 8 Feb → Fri 19 Feb 2027

- Load the signed opening TB at 31 Dec 2026, by party and parcel.
- Lock FY2026.
- Enter and post January 2027 in parallel with the current process.
- Close January.
- **Go-live Fri 19 Feb 2027.**
- Hypercare for 4 weeks with a daily check-in.
- Suspense account (2990) must be at zero within 60 days of the opening-TB load: by Fri 9 Apr 2027.

## Phase 5 — Ghana tax engine · Mon 1 Mar → Fri 9 Apr 2027

**Build:**
- Effective-dated tax rules (VAT Act 1151 plus legacy codes, WHT, CIT + GSL, stamp duty), each with source and reviewer.
- VAT and WHT return workpapers.
- Tax provision and deferred tax.
- E-VAT adapter and GRA onboarding test.
- Statutory calendar.

**Gate:** practitioner sign-off; the golden set of 50 transactions matches exactly; E-VAT sandbox clearance passes.

**Decisions needed:** D13 tax practitioner appointed (by Fri 15 Jan 2027), D14 E-VAT obligation and date for Trulander.

## Phase 6 — Intelligence · Mon 12 Apr → Fri 21 May 2027

**Build:**
- Document inbox with email forward, upload and photo.
- TaxHacker-derived OCR.
- Categorisation and match suggestions with pgvector.
- Anomaly centre.
- "Ask the books" on the read-only reporting schema.
- Close analytics.
- Report builder and scheduled report emails.
- CEO dashboard v2.
- AI activity log.

**Gate:** extraction accuracy ≥ 95% on 200 Ghanaian documents; the 50-question benchmark returns 100% correct answers or refusals; every AI action can be undone and is logged.

**Decisions needed:** D15 AI provider and data terms.

## Phase 7 — Fixed assets & payroll · Mon 24 May → Fri 2 Jul 2027

**Build:**
- Asset register, depreciation runs, tax vs book, disposals.
- Payroll (if D16 = build): PAYE Act 1178, SSNIT tiers and caps, payslips, statutory returns.

**Gate:** depreciation is idempotent and the register = GL; payroll shows zero differences over a 2-month parallel run.

## Phase 8 — Group platform & industry packs · Jul → Dec 2027

| Window | Scope |
|---|---|
| Jul–Aug 2027 | Onboard **Pep Landbank** (second entity on live data); intercompany; consolidation; budgets and forecasts, with budget-vs-actual reports; group dashboard |
| Sep–Oct 2027 | **Manufacturing pack** (Brandini): items, BOM, WIP, standard cost |
| Nov–Dec 2027 | **Construction pack** (IFRS 15 over time) and **wholesale/FMCG pack**. PWA offline (PowerSync). Customer self-service portal |
| 2028 | Travel pack. SaaS readiness: tenant onboarding, billing, SOC 2 Type I if selling externally |

**Gate per pack:** that entity's opening balances load and its first month closes in parallel with zero unexplained differences.

---

## Summary timeline

```
Nov 2026  ▐P0 foundations▐P1 ledger completion▐
Dec 2026  ▐P2 real estate & receivables ─────────▐
Jan 2027  ▐P2▐P3 payables·banking·MoMo▐P4 hardening·rehearsal▐
Feb 2027  ▐P4▐ cutover ▐ ★ GO-LIVE Fri 19 Feb (Trulander)
Mar–Apr   ▐P5 Ghana tax engine + E-VAT▐
Apr–May   ▐P6 intelligence (AI, anomalies, ask-the-books)▐
May–Jul   ▐P7 fixed assets · payroll▐
Jul–Dec   ▐P8 Landbank onboard · consolidation · Brandini · construction · wholesale · offline▐
```
