# Phase 1 — Ledger completeness: status

Plan: `docs/blueprint/` (P1 window 16–27 Nov 2026; started early, 29 Oct). API 0.5.2-dev on staging.

| Item | Status | Evidence |
|---|---|---|
| Year-end close (closing journal, guards, screen) | Done, on staging | migrations 008–009; `tests/accounting-invariants/year-end-close.test.ts` (10); `tests/e2e/close.e2e.mjs` (4) |
| Adjusted trial balance (adjustment flag) | Done, on staging | migration 010; `tests/accounting-invariants/adjusted-trial-balance.test.ts` (4); journey in `tests/e2e/close.e2e.mjs` |
| Recurring and auto-reversing journals | Done, on staging | migration 011; `tests/accounting-invariants/recurring-and-auto-reversing.test.ts` (13); journey in `tests/e2e/close.e2e.mjs` |
| Attachments (Supabase Storage) | Next | — |
| CSV/XLSX journal and opening-balance import | Planned | — |
| FX rates (BoG) and IAS 21 revaluation | Planned — needs D-decision on rate source | — |
| Close checklist | Planned | — |
| Audit-chain anchoring, retention | Planned | — |
| Queue/scheduler skeleton (pgmq, pg_cron) | Planned | — |
| Realtime approvals | Planned | — |
| IFRS for SMEs chart template, dimensions | Planned | — |

## Risks
- Recurring drafts are created when someone presses "Create due drafts"; the nightly scheduler (pg_cron) that does it automatically is a later Phase 1 item.
- Staging is on the Supabase free plan (D1 open): no leaked-password protection, no PITR, project can pause.
- Finance lead (D17) not appointed: close mechanics need professional sign-off before go-live.
