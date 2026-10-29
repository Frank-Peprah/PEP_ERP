# 01 — Problems the system must solve, and the requirements that follow

This section is the test for every later design decision: if a feature does not solve one of these problems, it is out of scope.

## 1. Who uses the system, and what they need from it

| Persona | Volume / frequency | What breaks today | What they need |
|---|---|---|---|
| **Sales officer / front desk** (Trulander) | Tens of receipts a day; cash, MoMo, bank transfer | Receipts in books or WhatsApp, with no link to plot or contract. Duplicates and missing receipts | Record a receipt in under 30 seconds against a customer, contract and plot. Instant receipt PDF and SMS/WhatsApp. Works on a phone with poor network |
| **Accountant / preparer** | Daily | Excel journals, re-keyed bank data, no subledgers, opening balances not clean | Banana-style grid entry, bank/MoMo import and matching, subledgers tied to the GL, import templates |
| **Approver / finance manager** | Daily approvals, monthly close | No maker-checker; corrections overwrite history | Approval inbox, SoD enforced, reversal-only corrections, a close checklist |
| **CEO / Group CFO (Frank)** | Weekly and monthly, often on mobile | No real-time cash, receivables or land-margin view; six businesses with no consolidated view | Live cash and receivables by entity, parcel margin, collections forecast, group consolidation, AI questions over the books |
| **External auditor / ICAG reviewer** | Annual | No evidence trail from statement back to source document | Read-only role, drill-down from statement → note → account → journal → attachment, hash-verified audit log, export packs |
| **Customer / landowner** (later) | Occasional | Calls the office for balances and statements | Self-service statement link or portal: instalments paid and due, receipts, documents |
| **GRA / SSNIT / Registrar** (outputs only) | Monthly and annual | Manual preparation of returns | Effective-dated tax engine, filing schedules, E-VAT invoice data when mandated |

## 2. Problems, by domain

### A. Ledger integrity (the foundation, built in R1–R2)
1. Books can be altered silently → **immutable posted ledger, reversal-only corrections, hash-chained audit** *(done)*
2. Entries post to closed months → **period locks enforced in the database** *(done)*
3. One person can create and approve an entry → **SoD and maker-checker in both service and database** *(done)*
4. Statements cannot be reproduced later → **frozen, hashed statement packs** *(done)*
5. No adjusted TB, no year-end close journal, no import, no attachments → **R1b gap, scheduled in Phase 1**

### B. Real-estate operations (Trulander's core and the biggest gap)
6. Deposits treated as income → **deposits are contract liabilities until transfer of control (IFRS 15)**
7. Instalment plans tracked in Excel → **contract and instalment schedule engine, with ageing, reminders and a significant-financing-component flag**
8. Land cost not tracked per plot, so margin is unknown → **parcel cost register by component (IAS 2); cost relieved on sale**
9. Mandate sales mix landowner money with company money → **client-money ledger tied to a designated client account (Act 1047 s.46, s.48(1)(f)), escrow reconciliation; only commission is revenue**
9a. Cash taken on real-estate transactions (prohibited by Act 1047 s.45) → **cash receipts blocked on agency land transactions; bank, cheque, transfer or e-money only**
9b. Real Estate Agency Council quarterly transaction reports (s.49) prepared by hand → **report generated from the contract and receipt subledgers**
10. Agent commissions paid ad hoc → **commission rules, accrual, capitalisation (IFRS 15.91), payout approval**
11. Double-selling a plot → **parcel status machine (available → reserved → under contract → sold) with database uniqueness on an active contract per parcel**
12. Litigation and title risk invisible in the books → **parcel risk flags; GLRRA score linked later; NRV review**

### C. Cash and banking (Ghana reality)
13. Payments arrive through MoMo, bank, cash and Paystack/Hubtel, and are reconciled by hand → **multi-channel import, auto-match with rules, unmatched queue**
14. No real-time cash position → **live cash dashboard across banks, MoMo and petty cash, by entity**
15. FX (USD land prices, GHS functional) → **rate tables (BoG reference), IAS 21 revaluation journals**

### D. Purchasing and payables
16. Landowner, surveyor and contractor payments without approval or WHT → **bills, approvals, WHT deduction at source, payment runs, WHT certificates**

### E. Tax and statutory compliance (Ghana)
17. VAT/levies, WHT, PAYE, SSNIT and CIT are computed manually and change often → **effective-dated rules engine, verified by a Ghanaian tax practitioner before activation**
18. E-VAT invoice integration → **adapter boundary designed now, built when Trulander's mandate status is confirmed**
19. Data protection (Act 843) → **DPC registration, consent and retention rules, PII encryption, access logging**

### F. Group scale (later phases)
20. Six businesses with different models (manufacturing inventory, construction contracts, wholesale distribution, travel agency) → **industry packs on one core: chart-of-accounts template, posting rules and modules per industry**
21. Intercompany transactions and consolidation → **intercompany matching, elimination, IFRS 10 consolidation**
22. Group management reporting → **consolidated dashboards, budget vs actual, cash forecasting**

### G. Intelligence and automation
23. Hours spent categorising bank lines and keying receipts → **AI suggestions (categorisation, OCR extraction) that always land as drafts for human approval**
24. The CEO cannot query the books → **natural-language Q&A through a read-only, entity-scoped semantic layer, with every answer citing the journals behind it**
25. Problems are found at month-end, not when they happen → **anomaly alerts: duplicate receipts, unusual amounts, overdue instalments, unreconciled escrow, suspense ageing**

## 3. Non-functional requirements (acceptance thresholds)

| Area | Requirement |
|---|---|
| **Correctness** | Money is NUMERIC in the database, decimal.js in services, and integer minor units (BigInt) in the browser; never floats. Every invariant enforced in both the database and the service. Property-based tests on posting |
| **Performance** | TB under 500 ms at 1M lines (cache only above that, and reconciled). Grid entry has no input lag (virtualised). P95 API under 300 ms in-region |
| **Availability** | Production on Supabase Pro or above with daily backups and PITR. RPO 5 minutes (PITR) / RTO 4 hours. Restore test passed before go-live |
| **Connectivity** | Field and receipt screens usable offline, queueing writes, with conflict-free sync for drafts. Posting always happens online (server-authoritative) |
| **Security** | Supabase Auth with MFA for all finance roles. RLS by entity as the third layer. Least-privilege DB roles. Secrets in Vault. OWASP ASVS L2 checklist. External pen test before go-live |
| **Auditability** | Every state change audited and hash-chained. Daily anchoring of the chain off-database. Drill-down from statement to source document |
| **Retention** | At least 6 years from the end of the year the records relate to (Revenue Administration Act 2016, Act 915). Real-estate transaction records at least 5 years (Act 1047 s.50). Configurable per entity, never below 6 years. Soft-archive only; no hard deletes of financial records |
| **Accessibility** | WCAG 2.1 AA. Keyboard-first entry. Tabular numerals. Emil Kowalski design-engineering rules: no animation on keyboard actions, motion under 300 ms |
| **Localisation** | GHS default, en-GH formats, Ghana date conventions (DD/MM/YYYY), Ghana Card and TIN formats, MoMo-first payments |
| **Licensing** | No AGPL/GPL code copied into the product. Permissive (MIT/Apache/BSD/ISC) building blocks only. Copyleft systems are studied, not copied (see 03) |
