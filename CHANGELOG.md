# Changelog

## 0.1.0 — 2026-10-27 — Release 1 vertical slice
- Accounting core schema with database-enforced invariants (balance, immutability, period lock, workflow, audit chain).
- Journal workflow with segregation of duties, linked reversals, gapless numbering, idempotent creation, optimistic locking.
- General ledger with running balances; trial balance (YTD/period) with exception detection.
- RBAC per entity; entity isolation.
- React web app: dashboard, journals (grid entry), ledger, TB (CSV export), chart of accounts, periods, audit trail.
- 42 automated tests; 100k-line performance check (TB 130 ms).
- Demo seed: Trulander JSF Limited and Pep Landbank Ltd (illustrative data).
