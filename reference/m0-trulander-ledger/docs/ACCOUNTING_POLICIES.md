# Accounting policies encoded in the system

**Status: DRAFT. Pending sign-off by the CEO (FCCA).** Each policy below is already reflected in the chart of accounts or the posting rules. Changing a policy means changing the template or adding a new rule version.

| # | Area | Position encoded | Standard | Decision needed |
|---|---|---|---|---|
| P1 | Principal vs agent | Supported per contract. Own land: gross revenue (4100). Mandate sales: net commission (4200), with buyer funds held as client money (1150 / 2300) | IFRS 15 B34–B38 | Confirm the mix of own-land and mandate sales, and the mandate contract terms (who controls the land before sale) |
| P2 | Revenue recognition point | On transfer of control (indenture executed or possession handed over), not on deposit. Deposits sit in contract liabilities (2210) | IFRS 15.31–38 | Confirm the trigger event used in practice |
| P3 | Significant financing component | Account 4400 provided. Instalment schedules longer than 12 months to be split in M3 | IFRS 15.60–65 | Confirm typical instalment tenor and whether interest is charged |
| P4 | Land classification | Held for sale = inventory (1300 series), costed by component per parcel. Held for appreciation = investment property (1510) | IAS 2, IAS 40 | Confirm the landbank held for appreciation, and the measurement model (cost or fair value) |
| P5 | Inventory cost components | Acquisition, survey and demarcation, title regularisation and litigation, infrastructure, capitalised borrowing costs | IAS 2.10–22, IAS 23 | Confirm litigation costs meet the IAS 2 definition of cost (not abnormal) |
| P6 | NRV | Write-down account 1360 / 5400 | IAS 2.28–33 | Set the year-end review process |
| P7 | Contract costs | Incremental agent commissions capitalised (1410) and amortised on transfer of control (5200) | IFRS 15.91–94 | Confirm commissions are incremental, and whether to use the practical expedient for periods of one year or less |
| P8 | Client money | Escrow balances segregated (1150) with a matching liability (2300); never in revenue or operating cash | Fiduciary / IFRS 9 | Confirm a separate bank account exists or will be opened |
| P9 | ECL | Allowance account 1230 / expense 6900, using a simplified approach on receivables | IFRS 9.5.5.15 | Set the provision matrix in M3 |
| P10 | Functional currency | GHS. USD balances are revalued at period-end | IAS 21 | — |
| P11 | Year-end | 31 December assumed. FY2026 (comparative) and FY2027 (go-live) periods created | — | **Confirm** |

## Tax — not yet configured

All tax rates go into the M6 Tax Engine as **effective-dated configuration**, verified against the current GRA position before go-live. Nothing is hard-coded. The open items are:

- VAT treatment of land supplies compared with commission and advisory services (Act 870 and amendments, including levy restructuring)
- Withholding tax on commissions and on payments to landowners and suppliers
- Capital gains treatment of land disposals (Act 896)
- Stamp duty on conveyances
