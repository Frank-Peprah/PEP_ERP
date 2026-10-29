# 10 — Testing strategy

**Principle:** an accounting system is tested on the *books it produces*, not just on whether its code runs. Every layer has its own test suite. Each suite runs in CI on every PR unless marked otherwise.

| Layer | Tool | What it proves | Today | Target |
|---|---|---|---|---|
| Domain unit | Vitest | Money precision, FX translation, balance, workflow state machine, SoD, schedule generators, tax maths | ✓ | Every rule in `packages/accounting-domain`; ≥ 95% branch coverage on that package |
| Property-based | fast-check | For any random set of valid lines: posting preserves Dr = Cr, reversal nets to zero, TB balances, allocations never exceed amounts | — | Phase 0 for the ledger; extended per module |
| Database invariants | Vitest tamper suite + **pgTAP** | Direct SQL cannot break balance, immutability, period lock, audit chain or SoD; RLS per role × table; `pep_app` privilege limits | ✓ (tamper) | pgTAP for RLS and privileges (Phase 0); every new table gets policy tests in the same PR |
| API integration | Vitest + Fastify inject on a real Postgres | Each command: happy path, validation, permission, SoD, idempotency, concurrency (two approvers, double-sell) | ✓ | Per module |
| **Accounting scenario books** | Vitest, data-driven YAML scenarios | End-to-end business cases produce the exact expected journals, subledger balances and statement lines (40 Trulander cases in Phase 2; 50 tax cases in Phase 5) | — | Written by Claude, **reviewed and signed by the CEO**; the source of truth for "correct" |
| Reconciliation tests | SQL assertions | Subledger = GL control (AR, AP, inventory, escrow, WHT, assets); clearing accounts = 0; consolidated = Σ entities − eliminations | — | Run in CI on seed data **and** nightly in production as monitors |
| E2E user journeys | Playwright | Per persona: receipt in under 30 s; journal draft → post; reconcile a statement; close a month; generate and finalise statements; auditor drill-down | ✓ `tests/e2e/phase0.e2e.mjs`: 14 browser journeys at 1440 px and 390 px, with axe (v0.3.0) | About 25 journeys by go-live; staging smoke tests after every deploy |
| Visual regression | Playwright screenshots | Key screens don't drift | — | Phase 0 |
| Accessibility | axe-core in the browser journeys | WCAG 2.1 AA on every route | ◐ Phase 0 screens (v0.3.0) | Every new route; the build fails on serious issues |
| Performance | k6 + `tests/perf` | TB < 500 ms at 1M lines; P95 command < 300 ms; 50 concurrent users; grid scroll at 60 fps | ◐ `tests/perf/tb-100k.ts` (tsx script; 100k lines, TB measured at 130 ms) | Phase 4 load test, then monthly |
| Security | gitleaks, npm audit, licence check, OWASP ZAP baseline, Supabase advisors, external pen test | No secrets, no high-severity vulnerabilities, no copyleft licences, headers correct, no advisor warnings | — | Phase 0 in CI; pen test in Phase 4 |
| AI evaluation | Benchmark sets in `tests/ai` | Extraction accuracy; Q&A correct-or-refuse; match precision | — | Phase 6; blocks merges on regression |
| Migration safety | Shadow DB in CI | Migrations apply cleanly from zero **and** from the staging snapshot; no edited migrations (existing check) | ✓ (partial) | Phase 0 |
| UAT | Scripts per persona in `docs/uat/` | Real users complete their real tasks | — | End of each phase (CEO + finance lead); full UAT in Phase 4 |
| Dress rehearsal | Real Oct–Dec 2026 data on a separate copy | The system produces the books Trulander actually has, with differences explained | — | Phase 4 |

## Definition of Done (every PR)

1. Typecheck, lint, unit, integration, pgTAP and Playwright smoke tests pass in CI.
2. New tables have RLS and pgTAP tests; new commands have permission, SoD and idempotency tests.
3. Every accounting behaviour change has a scenario case and an updated `ACCOUNTING_RULES.md`. An ADR is required if the behaviour is new.
4. UI follows 06: axe passes, keyboard path works, Emil rules checked (Before/After table in the PR for UI changes).
5. No copyleft or unknown licences; no secrets.
6. CHANGELOG entry.
7. User manual (the *PEP Accounting — User Manual* doc) updated for anything users see, with a change-log row.

## Test data

- **Seed A (demo):** the existing illustrative Trulander and Pep Landbank data. Public-safe.
- **Seed B (scenario):** generated from the scenario books, deterministic.
- **Seed C (scale):** synthetic 1M lines, 5k parties, 2k parcels.
- **Real data** lives only in the rehearsal and production projects. It is never in the repo, CI, staging or AI benchmarks unless anonymised.
