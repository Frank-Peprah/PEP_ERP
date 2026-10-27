# ADR-003: The ledger is a view over posted journal lines
**Status:** Accepted · 2026-10-27
**Decision:** No mutable balance table. `ledger_postings` is a view of lines whose journal is posted; TB and ledger aggregate it directly.
**Why:** eliminates drift between ledger and journals; every balance is reproducible from source.
**Consequences:** at 100k lines TB = 130 ms. If volumes reach tens of millions, add a rebuildable, reconciled period-balance cache (spec §6D) — never authoritative.
