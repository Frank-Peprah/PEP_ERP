# IFRS disclosure governance (Release 2 — not yet implemented)

No IFRS statements or notes are generated in Release 1. The chart of accounts carries
`statement_line_code` and `note_ref` mappings so Release 2 can build mapping-driven statements.

Governance rules for R2:
- Disclosure library entries record: standard, paragraph reference (no copyrighted text), effective period,
  applicability test, required data, owner, reviewer, status, last-verified date.
- Statements are never labelled "IFRS compliant" or "audited" by the system.
- Every statement line must trace to approved mappings → TB balances → ledger → journals → evidence.
- Reviewer: a qualified accountant (ICAG / ACCA) signs off templates before first use.
