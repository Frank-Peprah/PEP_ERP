# Phase 1 — Ledger completeness: status

Plan: `docs/blueprint/` (P1 window 16–27 Nov 2026; started early, 29 Oct). API 0.5.0-dev on staging.

| Item | Status | Evidence |
|---|---|---|
| Year-end close (closing journal, guards, screen) | Done, on staging | migrations 008–009; `tests/accounting-invariants/year-end-close.test.ts` (10); `tests/e2e/close.e2e.mjs` (4) |
| Adjusted trial balance (adjustment flag) | Next | — |
| Recurring and auto-reversing journals | Planned | — |
| Attachments (Supabase Storage) | Planned | — |
| CSV/XLSX journal and opening-balance import | Planned | — |
| FX rates (BoG) and IAS 21 revaluation | Planned — needs D-decision on rate source | — |
| Close checklist | Planned | — |
| Audit-chain anchoring, retention | Planned | — |
| Queue/scheduler skeleton (pgmq, pg_cron) | Planned | — |
| Realtime approvals | Planned | — |
| IFRS for SMEs chart template, dimensions | Planned | — |

## Risks
- Staging is on the Supabase free plan (D1 open): no leaked-password protection, no PITR, project can pause.
- Finance lead (D17) not appointed: close mechanics need professional sign-off before go-live.
