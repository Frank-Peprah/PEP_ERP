# Trulander Ledger

Group accounting platform for Trulander JSF Limited and, in later waves, the rest of the group (Landbank, Brandini, construction, wholesale, travel).

The model is **Banana Accounting-style double entry**: a spreadsheet-grid interface for journal entry, sitting on an immutable, auditable Postgres ledger. Excel is an import/export format only; it is not the system of record.

## Status

| Module | Scope | Status |
|---|---|---|
| **M0 Ledger Core** | Entities, chart of accounts, periods, posting engine, reversals, event posting rules, audit log, trial balance | **Built — 31/31 tests passing** |
| M1 Users & controls | Roles, maker-checker approvals, RLS | Roles and RLS in M0; approvals workflow pending |
| M2 Land Inventory | Parcel register, cost build-up by parcel | Master table in M0; module pending |
| M3 Sales Contracts & AR | Contracts, instalment schedules, revenue-recognition triggers | Posting rules in M0; module pending |
| M4 Payables | Vendors, landowner payouts, agent commissions | Pending |
| M5 Cash, Bank & MoMo | Feeds, matching, reconciliation | Pending |
| M6 Tax Engine | VAT/levies, WHT, CIT, stamp duty (effective-dated) | Pending — rates to be verified against GRA |
| M7 Reporting | IFRS statements, management pack, parcel profitability | Trial balance in M0 |
| M8 Payroll | PAYE, SSNIT | Pending |
| M9 Consolidation | Intercompany elimination, entity onboarding | Pending |

## Repository layout

```
supabase/
  migrations/
    20261026000001_ledger_core.sql                   M0 schema, invariants, posting engine
    20261026000002_ledger_security.sql               Row-level security and grants
    20261026000003_coa_template_ghana_real_estate.sql  Chart of accounts and posting-rule templates
  seed.sql                                           Trulander entity, FY2026–2027 periods
  tests/ledger_core_test.sql                         Invariant test suite (rolls back)
docs/
  ARCHITECTURE.md        Module design and the event → posting-rule contract
  ACCOUNTING_POLICIES.md Policy decisions encoded in the system (pending sign-off)
  OPENING_BALANCES.md    Cutover and data-cleanup plan
.github/workflows/ci.yml Runs migrations, seed and tests on every push
```

## Ledger invariants (enforced in the database, not the app)

1. **Append-only.** `UPDATE` and `DELETE` on journals, lines, events and the audit log raise errors. Corrections are made with `ledger.reverse_journal()`.
2. **Balanced.** A deferred constraint trigger checks debits = credits and at least two lines at commit, so it cannot be bypassed by direct inserts.
3. **Open periods only.** A posting into a soft-closed or closed period is refused. Only an admin can reopen a closed period, and the reopening is audited.
4. **Postable accounts only.** Header and inactive accounts, and accounts belonging to another entity, are rejected.
5. **Gapless numbering.** Journal numbers are sequential per entity, and failed postings do not consume a number.
6. **Idempotent events.** One business event per `(entity, event_type, source_ref)`, so reposting the same receipt returns the original journal.
7. **Fully audited.** Every posting and period change writes to `ledger.audit_log`.

## Run locally

```bash
# Postgres 15+ (or `supabase start`)
createdb ledger
for f in supabase/migrations/*.sql supabase/seed.sql; do psql -d ledger -v ON_ERROR_STOP=1 -f "$f"; done
psql -d ledger -v ON_ERROR_STOP=1 -f supabase/tests/ledger_core_test.sql
```

## Posting examples

```sql
-- Manual journal
select ledger.post_journal(:entity, '2027-01-05', 'Capital injection',
  '[{"account":"1110","debit":500000},{"account":"3100","credit":500000}]');

-- Module event (preferred): customer deposit on a plot
select ledger.record_event(:entity, 'sales', 'sales.deposit_received', 'RCPT-0001', '2027-01-06',
  jsonb_build_object('customer_id', :customer, 'parcel_id', :plot, 'amount', 30000));

-- Correction
select ledger.reverse_journal(:journal_id, '2027-01-31', 'Posted to wrong parcel');

-- Trial balance
select * from ledger.trial_balance(:entity, '2027-01-31');
```
