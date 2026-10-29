# PEP ERP — New Industry AI ERP

**Module: Accounting Core (Release 1 vertical slice)**

Modular accounting and financial-assurance platform for Ghana-first, multi-entity groups.
This repository contains the **Release 1 vertical slice** defined in the master specification §17:
entity & period setup, chart of accounts, journal workflow with segregation of duties,
immutable ledger, trial balance, period lock, and a hash-chained audit trail.

> **Compliance boundary.** Outputs are drafts. Nothing here is certified IFRS-compliant,
> audited, or GRA-approved. No tax rates or rules are implemented in this release.

## Quick start

Requirements: Node 22+, PostgreSQL 16 (needs `pgcrypto` and `btree_gist`, both bundled).

```bash
cp .env.example .env              # set DATABASE_URL, TEST_DATABASE_URL, AUTH_SECRET (32+ chars)
createdb pep_dev && createdb pep_test
npm install
npm run db:seed                   # resets pep_dev, migrates, loads DEMO data (Trulander + Pep Landbank)
npm run build:web                 # builds the React app into apps/web/dist
npm run dev:api                   # http://localhost:4000 — serves API and the built UI
# or, for UI development with hot reload:  npm run dev:web  → http://localhost:5173
npm test                          # 74 tests: invariants, DB-bypass attempts, isolation, statements, dashboard
node tests/e2e/phase0.e2e.mjs     # 14 browser journeys, desktop + phone, accessibility (API on :4000 serving the build)
npx tsx tests/perf/tb-100k.ts     # performance check: 100,000 posted lines
```

### Demo users (development login only — disabled when `NODE_ENV=production`)

| User | Entity / role | Use it to test |
|---|---|---|
| ama@pep.local | Trulander — preparer, accountant | create, edit, submit journals |
| kofi@pep.local | Trulander — approver | approve, post, reject, return |
| frank@pep.local | Both — controller | lock/reopen periods; SoD blocks approving own journals |
| auditor@pep.local | Trulander — auditor | read-only TB, ledger, journals, audit trail |
| admin@pep.local | Trulander — system admin | proves admin has **no** financial access |
| esi@pep.local | Pep Landbank only | proves entity isolation (Trulander returns 404) |

**All seeded figures are illustrative DEMO data — not Trulander's actual books.**

## Staging environment

| Part | Where | Notes |
|---|---|---|
| Database | Supabase project `pep-erp-staging` (eu-west-2, London) | Migrations 001–002 applied; RLS on, public REST roles revoked |
| API | Supabase Edge Function `pep-api` | Same Fastify app, bundled by `node scripts/build-edge.mjs` |
| Web app | GitHub Pages: https://frank-peprah.github.io/PEP_ERP/ (`docs/deploy-github-pages.md`); also SiteGround or Netlify | Built by GitHub Actions with `VITE_BASE=/PEP_ERP/` and `VITE_API_BASE` |
| Access | Staging access code + demo users | `AUTH_SECRET`, `STAGING_ACCESS_CODE` from Supabase secrets, else the locked `app_config` table |

Re-seed an empty staging database with `database/seeds/demo_seed.sql` (pure SQL; refuses to run if entities exist).
Redeploy the API after code changes: `node scripts/build-edge.mjs`, then deploy `supabase/functions/pep-api/index.ts`.

## Demonstration workflow

1. Sign in as **Ama** → Journal Entries → *New journal* → enter lines in the grid → *Save & submit*.
2. Sign in as **Kofi** → Dashboard → "journals awaiting approval" → *Approve* → *Post to ledger* (gets `JV-2026-nnnnnn`).
3. Trial Balance → click any account → ledger → click a line → the journal.
4. As **Ama**, open a posted journal → *Reverse* (reason + date) → reversal draft goes through approval again.
5. As **Frank**, Periods & Close → lock a period → try posting into it (rejected, HTTP 423) → re-open with a reason.
6. Audit Trail → every action, hash-chained; the badge verifies the chain.

## Scope of this release

| Delivered | Excluded (next releases) |
|---|---|
| Entities, FYs, monthly periods, lock/reopen | Close checklist beyond TB-balance gate; year-end closing journal |
| Chart of accounts (hierarchy, mappings, flags) | Disclosure checklist, narrative notes editor (R2b) |
| Journal lifecycle draft→submitted→approved→posted, return, reject | Attachments / evidence store (R1b) |
| Linked reversals; gapless posting numbers per entity/FY | CSV/XLSX import (R1b) — idempotency key already supported |
| Ledger with running balance & drill-down; TB (YTD/period) with exceptions | Adjusted vs unadjusted TB split (needs adjustment flag) |
| RBAC per entity; SoD; entity isolation | Year-end close journal to retained earnings |
| Append-only, SHA-256 hash-chained audit log; **R2:** IFRS statements, notes, comparatives, cross-checks, draft→review→approve→final runs, PDF/Excel export | Subledgers (R3), tax (R4), AI (R5), consolidation (R6) |
| Multi-currency journal capture (rate per journal) | FX revaluation, rate tables |

See `ARCHITECTURE.md`, `ACCOUNTING_RULES.md`, `SECURITY.md`, `docs/decisions/`.
