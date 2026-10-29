# Architecture

## Design rule: modules emit events, and only the ledger posts

```
 Sales / Mandate / Inventory / Payables / Bank modules
            │  ledger.record_event(entity, module, event_type, source_ref, date, payload)
            ▼
   business_events  ──►  posting_rules (event_type, effective_from)  ──►  posting_rule_lines
            │                                                          (account, side, payload path)
            ▼
   ledger.post_journal()  ──►  journals + journal_lines  ──►  audit_log
            │
            ▼
   trial_balance · v_journal_detail · v_parcel_ledger · (M7) IFRS statements
```

- **Modules stay independent.** A module only needs to know which event types it emits and what is in the payload. It never needs to know account codes.
- **Accounting policy is data.** Changing a treatment means adding a new posting-rule version with a new `effective_from` date, with no code release. History keeps the rule that applied when it was posted.
- **Traceability is complete.** Every journal links to its event, every event to its source document (`source_ref`), and every action to an audit row.
- **The SaaS path stays open.** Rules, the chart of accounts and periods are scoped to an entity, so a tenant is just another entity set.

## Shared master data

| Table | Used by |
|---|---|
| `entities`, `entity_members` | All modules; drives RLS and role checks |
| `accounts` | Ledger; templated per entity through `install_coa_*` |
| `parties` (customer, landowner, agent, vendor, employee, related party) | Sales, Mandate, Payables, Payroll |
| `parcels` (inventory / investment property / PPE / held for client) | Inventory, Sales, Mandate, reporting |
| `fiscal_periods` | Ledger; opened and closed by approvers and admins |

## Event catalogue (v1 — real estate)

| Event type | Emitted by | Payload | Journal |
|---|---|---|---|
| `inventory.land_cost_incurred` | M2 | parcel_id, vendor_id, acquisition, survey, title, infrastructure, total | Dr 1310–1340 / Cr 2110 |
| `sales.deposit_received` | M3 | customer_id, parcel_id, amount | Dr 1110 / Cr 2210 |
| `sales.control_transferred` | M3 | customer_id, parcel_id, consideration, deposits_applied, receivable, cost_of_land | Dr 2210, Dr 1215 / Cr 4100; Dr 5100 / Cr 1310 |
| `sales.instalment_received` | M3 | customer_id, parcel_id, amount | Dr 1110 / Cr 1215 |
| `sales.commission_incurred` | M3/M4 | agent_id, parcel_id, amount | Dr 1410 / Cr 2130 |
| `mandate.buyer_funds_received` | M3 | landowner_id, parcel_id, amount | Dr 1150 / Cr 2300 |
| `mandate.sale_settled` | M3 | landowner_id, parcel_id, gross_proceeds, commission, net_to_landowner | Dr 2300 / Cr 4200, Cr 1150; escrow sweep of commission |

If a payload does not balance under its rule, it is rejected. The module is responsible for computing consistent figures; the ledger is responsible for refusing inconsistent ones.

## Security model

- RLS is enabled on every table, so a user sees only the entities they are a member of.
- There are no direct writes. All writes go through `SECURITY DEFINER` functions that check role:
  - `preparer` posts and records events
  - `approver` reverses and closes periods
  - `admin` reopens closed periods and installs templates
- **Planned for M1:** maker-checker approval, where journals above a set threshold are held as drafts until a second user approves them. Segregation of duties will be enforced in the function, not the UI.

## Stack

- **Database:** Postgres (Supabase). All invariants live in the database.
- **API:** Supabase RPC on the `ledger.*` functions.
- **UI (next):** Next.js with a spreadsheet-grid journal entry screen in Banana style: account autocomplete, live debit/credit totals, and posting disabled until the entry balances.
- **Excel:** import templates for opening balances and bulk receipts, plus export of the trial balance and ledgers.

## Build sequence

| Sprint | Deliverable | Target |
|---|---|---|
| 1 | M0 Ledger Core | ✅ 26 Oct 2026 |
| 2 | M1 approvals; grid UI for journals and trial balance | 27 Nov 2026 |
| 3 | M2 Land Inventory | 11 Dec 2026 |
| 4–5 | M3 Contracts & Receivables (instalment schedules, revenue-recognition triggers) | 8 Jan 2027 |
| 6 | Opening balances loaded; M4 Payables | 22 Jan 2027 |
| 7 | M5 Bank & MoMo reconciliation; M7 core reports | 5 Feb 2027 |
| — | First live month-end close (January 2027), parallel run | 19 Feb 2027 |
