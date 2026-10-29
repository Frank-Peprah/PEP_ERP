# 05 — Module catalogue

Each module card follows the same structure: purpose, features, screens, events it emits, controls, reference, phase, and **acceptance gate** (the test that must pass before the module is called done). Screen counts add up to the roughly 100-screen UI programme.

---

## M0 · Platform: identity, entities, settings
- **Features:**
  - Supabase Auth: sign-in, MFA enrolment, recovery, sessions, device list.
  - Groups → entities.
  - Users, invitations, role assignment, approval policies.
  - Entity settings: framework, functional currency, FY, materiality, SoD on/off, numbering.
  - Notifications preferences.
  - System health page.
- **Screens (12):** sign-in, MFA enrol, MFA challenge, forgot password, entity switcher, group overview, entity settings, users & roles, invite user, approval policies, my profile & security, system health.
- **Controls:**
  - AAL2 required for finance roles.
  - The system admin has no financial permissions (existing rule).
  - Role changes are maker-checker and audited.
- **Reference:** shadcn-admin auth/settings pages; Basejump membership model.
- **Phase:** 0.
- **Gate:**
  - Every R1/R2 test passes on Supabase Auth.
  - pgTAP isolation suite green.
  - A finance user without MFA cannot read any financial row.

## M1 · General ledger & close *(R1/R2 exist; completion in Phase 1)*
- **Features:**
  - **Exists:** chart of accounts; journals (grid + form) with full workflow; reversals; ledger; trial balance; periods lock/reopen; audit trail.
  - **To add:**
    - Dimensions.
    - Recurring journals.
    - Accrual/prepayment templates with auto-reversal.
    - CSV/XLSX import with a preview grid.
    - Attachments.
    - Adjusted TB (an adjustment flag on journals).
    - Year-end closing journal.
    - FX rate tables (BoG) and IAS 21 revaluation.
    - Close checklist with owners and due dates.
    - Balance cache above 1M lines.
- **Screens (16):** COA tree, account detail, journal list, journal grid entry, journal detail and timeline, recurring journals, import wizard (upload → map → preview → commit), ledger, TB (unadjusted/adjusted), periods & close, close checklist, FX rates, FX revaluation run, dimensions, audit trail, attachments viewer.
- **Events:** `journal.submitted|approved|posted|reversed`, `period.locked|reopened`.
- **Controls:**
  - Existing invariants.
  - Imports never auto-post; they create drafts.
  - Year-end close only after all 12 periods are locked.
- **Reference:** ERPNext Period Closing Voucher; Odoo `account.move`.
- **Gate:**
  - Closing journal zeroes P&L into retained earnings, and the TB still balances.
  - Opening-balance import of 1,000 rows reconciles to the control total.
  - Revaluation journal reverses on day 1 of the next period.

## M2 · Financial reporting & assurance *(R2 exists)*
- **Features:**
  - **Exists:** SFP, P&L/OCI, SOCE, cash flow, notes, frozen hashed packs, review workflow, PDF/XLSX.
  - **To add:**
    - IFRS for SMEs template.
    - Management reports: P&L by dimension (parcel, estate, project), budget vs actual.
    - Report builder (saved column sets).
    - Scheduled report email.
    - Auditor export pack: TB, GL detail, journals, attachments index, audit chain proof.
- **Screens (8):** statements, notes, runs list, run review, management reports, report builder, scheduled reports, auditor pack.
- **Gate:**
  - An auditor role can trace a random sample of 25 statement figures to source documents in under 10 minutes each.

## M3 · Parties (customers, landowners, agents, vendors)
- **Features:**
  - Unified party master with roles.
  - KYC: Ghana Card and TIN, encrypted and masked.
  - Contacts.
  - Bank and MoMo payout details: changes require maker-checker plus re-verification, and are flagged by the anomaly engine.
  - Agent licence number and expiry (Act 1047 s.48(1)(d)).
  - Statements of account.
- **Screens (6):** party list, party 360 (balances, contracts, documents, timeline), new/edit party, KYC review queue, payout-details change approvals, agent licence register.
- **Gate:**
  - A payout-detail change is not effective until a second user approves it.
  - An unlicensed agent cannot be assigned a commission.

## M4 · Real estate operations *(Trulander's core)*
- **Features:**
  - **Estates and parcels:** map reference, size, status machine `available → reserved → under_contract → sold | withdrawn`, with a DB-unique active contract per parcel. Parcel cost components (IAS 2). Litigation and title flags. GLRRA score link.
  - **Sale contracts:**
    - Principal or agent per contract.
    - Price, currency, discounts.
    - Instalment schedule generator (tenor, frequency, deposit %, interest/SFC flag over 12 months).
    - Transfer-of-control event (indenture, possession).
    - Cancellation and refund flow.
  - **Receipts:**
    - Channel: bank, MoMo, cheque, gateway; **cash blocked on agency transactions** (s.45).
    - Allocation to instalments.
    - Instant receipt PDF and SMS/WhatsApp.
  - **Mandates:** landowner, commission %, client-money account (s.46), escrow reconciliation, settlement to landowner.
  - **Commissions:** rules per agent or scheme, accrual on signing or control, capitalisation (IFRS 15.91), payout approval.
  - **Real Estate Transaction Certificate** tracking (s.47).
  - **REAC quarterly report** (s.49).
  - **Calculators:** stamp duty and CGT on land sales.
- **Screens (16):**
  - Estates
    - estate list
    - estate map/grid of plots, with status colours
  - Parcels
    - parcel detail, with its cost build-up, margin and history
  - Contracts
    - contract list
    - new contract wizard
    - contract detail, with its schedule, receipts and documents
    - instalment schedule editor
    - transfer-of-control action
    - cancellation/refund
  - Receipts
    - receipt entry, mobile-first, under 30 seconds
    - receipts list
  - Mandates and commissions
    - mandate detail and escrow reconciliation
    - commission rules
    - commissions payable
  - Compliance
    - REAC quarterly report
    - transaction certificates
- **Events:**
  - `inventory.land_cost_incurred`
  - `sales.deposit_received`
  - `sales.instalment_received`
  - `sales.control_transferred`
  - `sales.commission_incurred`
  - `sales.contract_cancelled`
  - `mandate.buyer_funds_received`
  - `mandate.sale_settled`
- **Controls:**
  - A parcel cannot be double-sold.
  - Client money never touches revenue: escrow (1150) must equal the client-money liability (2300), checked nightly.
  - Revenue is recognised only on the control event.
  - Refunds need approval.
- **Reference:** our M0 posting engine and real-estate chart of accounts (branch); ERPNext Sales Invoice / Payment Schedule (study).
- **Phase:** 2.
- **Gate:** a scripted "Trulander scenario book" of 40 cases posts correctly and ties out, covering:
  - own-land sale
  - mandate sale
  - cancellation with refund
  - partial instalments
  - USD contract with GHS receipts
  - commission capitalisation and amortisation

## M5 · Receivables
- **Features:**
  - Customer invoices (non-land services: advisory and valuation fees).
  - Credit notes.
  - Allocation and unallocated cash.
  - Ageing (by contract or invoice).
  - Dunning: SMS, WhatsApp and email reminders before and after due date.
  - ECL provision matrix (IFRS 9 simplified).
  - Customer statements and a self-service statement link (signed, expiring URL).
- **Screens (8):** invoices, invoice editor, credit notes, allocations, ageing, dunning runs, ECL matrix, customer statement.
- **Phase:** 2–3.
- **Gate:** the AR subledger equals the GL control accounts (1210/1215/1220) at every period end. This is the close-checklist auto-check.

## M6 · Payables & payments
- **Features:**
  - Bills (manual, OCR-suggested in Phase 6).
  - Approval by threshold.
  - **WHT deducted at source** by payee and payment type, with certificates.
  - Payment runs (bank file or MoMo bulk), with payment approval separate from bill approval.
  - Landowner payouts.
  - Agent commission payouts.
  - Vendor statements.
- **Screens (9):** bills, bill entry, approvals, payment run builder, payment run review, payments, WHT register, WHT certificates, vendor statement.
- **Controls:**
  - The vendor creator cannot approve payment to that vendor.
  - Payment-detail changes are maker-checker.
  - Duplicate-bill detection (same vendor, amount, ref).
- **Phase:** 3.
- **Gate:** the AP subledger equals the GL; the WHT register equals the WHT payable account; an SoD conflict is blocked in the API and the DB.

## M7 · Cash, bank & MoMo
- **Features:**
  - Accounts: banks, MoMo wallets, gateways, petty cash.
  - Statement import: CSV, MT940, Excel, PDF parser per bank; MoMo portal export; Paystack, Hubtel and Flutterwave settlement reports.
  - Webhooks: MoMo/Paystack/Hubtel, idempotent.
  - Matching:
    - Three-state: auto, suggested, pending.
    - Rule engine (Blnk-style: amount, date window, reference regex, counterparty).
    - Learned rejections; undo; "what automation did" log.
  - Settlement clearing accounts: gross / fee / net.
  - Bank reconciliation report with sign-off.
  - Cash position, live.
  - Petty cash vouchers.
  - Transfers between accounts.
- **Screens (10):** accounts, account detail, import, reconciliation workspace (two-pane), match rules, automation log, settlement batches, reconciliation reports, cash position, petty cash.
- **Phase:** 3.
- **Gate:**
  - A 3-month real-format MoMo statement and a bank CSV reconcile to zero difference.
  - Auto-match precision is at least 98% on high-confidence matches in the test set.
  - Every match can be undone.

## M8 · Tax & statutory (Ghana)
- **Features:**
  - Effective-dated tax rules: source Act, from/to, reviewer, verified date.
  - VAT codes: Act 1151 structure plus legacy codes.
  - VAT return workpaper.
  - WHT returns.
  - CIT + GSL provision and deferred tax schedule.
  - Stamp duty register.
  - **E-VAT adapter:** queue, VSDC submission, signature/QR storage, 24-hour offline catch-up.
  - Statutory calendar with reminders (GRA, SSNIT, ORC annual returns, REAC quarterly, DPC renewal).
  - Exports labelled DRAFT until reviewed.
  - "Filed" status requires submission evidence.
- **Screens (8):** tax codes, rule versions, VAT return, WHT return, CIT computation, E-VAT submissions, statutory calendar, filing evidence.
- **Phase:** 5 (post go-live). Until then filings continue on the current process and we reconcile against them.
- **Gate:**
  - A Ghanaian tax practitioner signs off every rule version.
  - A golden dataset of 50 transactions computes exactly to the practitioner's workings.

## M9 · Intelligence: AI, analytics, alerts
- **Features:**
  - Document inbox: email forward, upload, mobile photo.
  - OCR extraction (TaxHacker port).
  - Categorisation and matching suggestions (pgvector + learned history).
  - Anomaly alerts:
    - duplicate receipts or bills
    - round sums
    - weekend or after-hours postings
    - payout-detail changes
    - suspense ageing
    - escrow ≠ liability
  - "Ask the books": natural-language questions → SQL on the `reporting` schema under a read-only role with RLS, a 5-second timeout and row limits. Answers cite the journals behind them; **no LLM arithmetic**.
  - Close-assist: checklist items auto-ticked by checks.
  - CEO dashboard: live cash, collections vs schedule, parcel margin, approvals pending, days-to-close.
- **Screens (8):** inbox, suggestion review, anomaly centre, ask the books, saved questions, CEO dashboard, entity dashboards, AI activity log.
- **Controls:**
  - AI only creates suggestions or drafts.
  - Auto-apply only above a confidence threshold, per rule and per account, switchable, with undo.
  - Model, prompt version and inputs logged.
  - No PII sent to models beyond what the task needs.
  - Provider terms checked for no training on our data.
- **Phase:** 6 (dashboards and alerts start in Phase 3).
- **Gate:**
  - Measured extraction accuracy is at least 95% on fields from 200 real Ghanaian receipts and invoices.
  - "Ask the books" answers on a 50-question benchmark match SQL ground truth 100% or refuse.

## M10 · Fixed assets
- **Features:** asset register, classes, depreciation (straight-line or reducing balance, by component), capital allowances for tax (separate book), disposals, revaluation (IAS 16), monthly depreciation run via the queue.
- **Screens (5):** register, asset detail, depreciation run, disposals, tax vs book.
- **Phase:** 7.
- **Gate:** the depreciation run is idempotent per period, and the register equals the GL.

## M11 · Payroll *(may stay outsourced; build only if confirmed)*
- **Features:** employees, pay elements, PAYE (Act 1178 tables, effective-dated), SSNIT Tier 1/2/3 with caps, payslips, bank/MoMo payroll file, PAYE and SSNIT returns, payroll journal.
- **Screens (6):** employees, pay elements, payroll run, payslips, statutory returns, payroll journal.
- **Phase:** 7.
- **Gate:** parallel run against the current payroll for 2 months shows zero differences.

## M12 · Group: consolidation, budgets & industry packs
- **Features:**
  - Intercompany: matching, mismatch alerts, elimination journals.
  - Consolidation runs (IFRS 10), with NCI where needed.
  - Group reporting currency.
  - Budgets and forecasts, entered in the grid.
  - Industry packs: chart-of-accounts template, posting rules and module bundle.
    - Proptech: Landbank, GLRRA, CLAF.
    - Manufacturing: Brandini (BOM, WIP, standard cost).
    - Construction: IFRS 15 over-time recognition, retentions, milestones.
    - Wholesale/FMCG: items, warehouses, landed cost, stock moves.
    - Travel: agent vs principal, supplier settlements.
- **Screens (10):** IC pairs, IC reconciliation, consolidation runs, eliminations, group statements, budgets, forecast, pack installer, items/stock (pack), projects (pack).
- **Phase:** 8.
- **Gate:** the consolidated TB equals the sum of entity TBs less eliminations, with intercompany balances netting to zero.

## Public website *(already in the UI programme)*
- **Screens (6):** home, product, industries, pricing, security & compliance, contact/demo request. Static, no customer data.

**Screen total:** 12 + 16 + 8 + 6 + 16 + 8 + 9 + 10 + 8 + 8 + 5 + 6 + 10 + 6 = **128 screens**. The 100-screen programme covers M0–M7, M9 dashboards and the website. M8, M10, M11 and M12 screens follow with their back ends.
