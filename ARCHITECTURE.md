# Architecture

```
apps/web  (React + Vite)  ──HTTP/JSON──▶  apps/api (Fastify, TypeScript)
                                              │  routes → services (transactions, RBAC, audit)
                                              │           └─ @pep/accounting-domain (pure rules, Decimal)
                                              ▼
                                       PostgreSQL 16
                                       • constraints + triggers enforce every accounting invariant
                                       • ledger_postings VIEW = posted journal lines (the ledger)
                                       • audit_events append-only, SHA-256 hash chain
```

## Layers
| Layer | Location | Responsibility |
|---|---|---|
| Domain | `packages/accounting-domain` | Money parsing/precision, FX translation, balance checks, workflow state machine, SoD. No I/O. |
| Services | `apps/api/src/services` | Transactions, row locks, permission checks, audit events, numbering. |
| Database | `supabase/migrations` | Second, independent enforcement of invariants (see ADR-002). |
| Web | `apps/web` | Presentation only. Live journal totals use integer minor units (BigInt) — never floats. |

## Key data flows
- **Posting:** `transition('post')` locks the journal row, re-validates balance/period/accounts, takes the next number from `journal_sequences` (row-locked upsert ⇒ gapless), updates status. The `journal_guard` trigger re-checks balance, period status, account validity and approval inside the same statement.
- **Reversal:** creates a *draft* of type `reversal` with sides swapped and functional amounts copied exactly (never re-translated). On posting, the original's `reversed_by_journal_id` is set — the only mutation the trigger permits on a posted journal.
- **Trial balance:** a single aggregate over `ledger_postings`. Income-statement accounts open at zero each FY; unclosed prior-year results appear as one explicit system line on retained earnings. Measured: 130 ms for 100,000 posted lines.

## Entity isolation
Every route is `/api/entities/:entityId/...`. `loadScope` resolves the caller's roles for that entity; none ⇒ 404 (no existence leak). All queries filter by `entity_id`; triggers prevent cross-entity accounts in journals. **Planned hardening:** PostgreSQL row-level security as a third layer.

## Decisions
- ADR-001 stack · ADR-002 database-enforced invariants · ADR-003 ledger as a view over posted lines
