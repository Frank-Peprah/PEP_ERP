# Opening balances and cutover plan

**Cutover:** opening trial balance at **31 December 2026**, with live posting from **1 January 2027**. FY2026 periods exist in the system so that the comparative year can be loaded.

**Rule:** nothing enters the ledger without a supporting schedule. Unexplained differences go to **2990 Suspense**, which must be cleared within 60 days of go-live.

| # | Workstream | Output | Owner | Deadline |
|---|---|---|---|---|
| 1 | Inventory of data sources: bank statements, MoMo statements, receipt books, sale agreements, indentures, Excel trackers | Source register | CEO | Fri 6 Nov 2026 |
| 2 | Bank and MoMo reconciliations to 31 Oct 2026, then 31 Dec 2026 | Reconciled cash (1110–1150) | Finance lead | Fri 27 Nov 2026 |
| 3 | Customer ledger rebuilt **by contract and parcel**: price, paid to date, balance, transfer status | Receivables (1210/1215) vs contract liabilities (2210/2220) | Finance lead | Fri 11 Dec 2026 |
| 4 | Parcel cost register rebuilt from acquisition documents, split by cost component | Land inventory (1310–1350) by parcel | Finance lead and CEO | Fri 11 Dec 2026 |
| 5 | Mandate sales: funds held for landowners, matched to escrow | Client money (1150 = 2300) | Finance lead | Fri 11 Dec 2026 |
| 6 | Payables, agent commissions, statutory liabilities (GRA, SSNIT) | Liability schedules (2100–2460) | Finance lead | Fri 18 Dec 2026 |
| 7 | Opening trial balance prepared, reviewed and loaded as a single `opening_balance` journal | Opening TB in system | CEO signs off | Fri 8 Jan 2027 |
| 8 | Suspense cleared | 2990 = 0 | Finance lead | Mon 8 Mar 2027 |

## Load mechanics

- Load by **parcel and party**, not just by account. Every receivable, deposit and inventory line carries `party_id` and `parcel_id` so that the subledgers tie to the GL from day one.
- The load is one journal per entity with `source = 'opening_balance'`, posted into the December 2026 period. That period is then closed.
- An Excel import template is provided in Sprint 2.
