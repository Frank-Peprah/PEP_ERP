# 02 — Benchmark research: what established systems do, and what we adopt

Research carried out 29 Oct 2026. Items marked **[unverified]** or **[vendor claim]** are flagged as such; nothing so marked is relied on for a control or a tax rule.

## 1. UI and UX benchmark

| Pattern | Who does it | Adopt in PEP ERP? |
|---|---|---|
| Spreadsheet-style editable tables (Accounts, Transactions, VAT codes, FX rates) that recalculate as you type | Banana Accounting | **Yes — core entry model.** Glide Data Grid journal grid: per-row validation, account autocomplete, live balances, an inline errors column instead of modals. Commits only as a balanced journal. Forms view for non-accountants |
| Task-grouped left sidebar (Sales, Purchases, Banking, Accounting, Reports) with a card dashboard | Xero, QuickBooks Online, Zoho Books | **Yes.** Sidebar groups map to modules (see 05) |
| Role centres (Controller, AP clerk) with saved views and KPI tiles | NetSuite, Sage Intacct, Odoo | **Yes.** The landing dashboard is chosen by role |
| Entity switcher with a consolidated "top level" view | Sage Intacct | **Yes**, first-class in the top bar from Phase 0 |
| Transactions inbox; ledger mostly hidden; work by exception | Pennylane, Digits, Midday | **Yes, for operations staff:** the "Inbox" for unmatched bank lines, documents and AI suggestions |
| Three-state matching: auto-matched, suggested, pending; rejected pairs remembered; undo; a "what automation did" page; automation switch per bank account | Midday, Xero JAX (Dec 2025 beta) | **Yes** (bank reconciliation, Phase 3) |
| Cmd/Ctrl-K command palette for search and actions | Digits, Midday, Ramp | **Yes**, with no open/close animation (Emil rule: keyboard-initiated) |
| Drill-down: statement line → note → account → journal → source document | All serious products | **Yes.** Statements to journals exist today (R2); attachments added in Phase 1 |
| Close checklist with owners, lock dates, days-to-close analytics | Sage Intacct 2026 R1, NetSuite | **Yes** (Phase 1 checklist; analytics in Phase 6) |
| Approval inbox with policy thresholds | Ramp, Brex | **Yes.** Journal, bill, payment and master-data approvals |
| Mobile = capture + approvals; bookkeeping stays on desktop | All | **Yes.** PWA scope is receipts, photos, approvals and dashboards |

## 2. Architecture benchmark

| Lesson | Source | Status in PEP ERP |
|---|---|---|
| Transactions are mutable while pending, immutable once posted; corrections by reversal or adjusting entry; failed items archived, never deleted | Modern Treasury | **Done** (R1 trigger guards and linked reversals) |
| Optimistic locking on balance versions | Modern Treasury | Done for journals (version column); to add for the Phase 1 balance cache |
| Two-phase transfers (pending, then post or void) with separate pending/posted balances | TigerBeetle | Matches our draft → submitted → approved → posted lifecycle. Add "pending" balances to the dashboards (approved but unposted) |
| Clearing accounts that must net to zero, with continuous data-quality checks | Stripe Ledger [unverified detail] | **Adopt:** settlement clearing accounts (Paystack/Hubtel/MoMo) with a nightly zero-check job |
| Hybrid design: an append-only journal as the event log, CRUD for master data and documents | Industry norm | **Adopt.** Business documents (contracts, invoices, bills) are mutable until they emit a posting event |
| RLS performance: index policy columns; wrap auth functions in `(select …)`; security-definer helpers in a private schema; `= ANY(array)` instead of joins; `TO authenticated` | Supabase docs (measured: 178 s → 12 ms; 9 s → 20 ms) | **Mandatory pattern** for every policy (see 04) |
| Edge Functions: 2 s CPU per request, 256 MB, 400 s wall clock on paid plans | Supabase limits | Heavy work (statements, imports, depreciation runs, consolidation) moves to Postgres functions plus queues |
| Realtime: Postgres Changes is single-threaded and runs an RLS check per subscriber (sample ceiling about 64 changes/s); Broadcast handles over 150k msgs/s | Supabase benchmarks | **Use Broadcast from DB triggers** on `entity:{id}` channels. Never Postgres Changes on ledger tables |
| Queues on pgmq: guaranteed delivery, visibility window, archive; pg_cron triggers workers | Supabase Queues | **Adopt** for imports, OCR, notifications, nightly checks |
| Migrations in the repo, preview branch per pull request | Supabase branching | **Adopt.** Don't rely on the dashboard diff engine (alpha) for the ledger schema |

## 3. Security and control benchmark

- SOC 2 / ISO 27001 control set: role-based access with MFA, quarterly access reviews, change management, logging, tested backups, encryption, vendor management. PEP ERP maps each to a concrete control (see 07).
- Accounting-specific controls:
  - Segregation of duties (vendor creator ≠ payer; preparer ≠ approver).
  - Maker-checker thresholds.
  - Locked periods, with override only with a reason that is logged.
  - Hash-chained audit trail, with the chain head anchored outside the database daily.
- Ghana DPC states that **2026 is an enforcement year** under Act 843 and has sought prosecution of about 250 unregistered institutions. Controllers and processors must register.

## 4. AI benchmark

| Product | Capability | Control model | What we take |
|---|---|---|---|
| Xero JAX | Auto-reconciliation | High-confidence only; undo; audit page | The control model |
| QuickBooks (Intuit Assist) | Categorisation and payment agents ("12 h/month saved" [vendor claim]) | Not clearly reviewed | Nothing (weak controls) |
| Sage Intacct 2026 R1 | Natural-language Q&A, close/AP/assurance agents, AI import with preview and rollback | Preview and rollback | AI import preview and rollback |
| Digits | "95% bookkeeping automated" [vendor claim] | Language models orchestrate; **custom models and SQL do the maths**; unsure items go to an inbox | **Rule: no LLM arithmetic; all figures come from SQL** |
| Midday | Inbox matching; embedding-based categorisation | Suggested state; rejections learned | Pattern only (AGPL — no code) |
| TaxHacker (MIT) | Receipt/invoice OCR extraction, FX at transaction date, handwritten receipts | User reviews each extraction | **Port the extraction prompts and field schema** (see 03) |

## 5. Ghana integration reality

- **Bank feeds:** the Bank of Ghana open-banking framework is at pilot stage with no timeline. Mono/Okra coverage of Ghanaian banks is [unverified]. **Statement import (CSV/MT940/PDF) is the primary path**, with an adapter interface ready for APIs.
- **MTN MoMo:** the Collections API charges about 2% per transaction. Statements come from the partner portal (3-month window) with no statement API advertised → monthly import plus webhooks.
- **Gateways:** Paystack GH settles T+1/T+2 (third-party source; verify). Hubtel and Flutterwave publish settlement APIs → model gross / fee / net settlement clearing accounts.
- **Offline:** PowerSync has an official Supabase integration → capture and drafts offline; posting always online.

## 6. Ghana compliance facts that drive design

These are research findings. **Every rate must be re-verified by a Ghanaian tax practitioner before activation** (GHANA_TAX_RULES.md governance).

| Area | Finding (source) | Design consequence |
|---|---|---|
| VAT (from 1 Jan 2026, VAT Act 2025, Act 1151) | 15% VAT + 2.5% NHIL + 2.5% GETFund = 20%, same base, NHIL/GETFund now input-deductible; COVID levy abolished; flat-rate scheme (including 5% real estate) abolished; goods threshold GHS 750k; service providers register regardless (Crowe, TaxLawGH) | Effective-dated VAT codes; legacy codes kept for pre-2026 periods |
| E-VAT | Clearance model through GRA's VSDC: signature, QR code, number and timestamp returned; offline invoices transmitted within 24 h; onboarding in batches with about 4 weeks of testing (Fonoa) | Adapter, submission queue, storage of the signature and QR code. Mandatory date and specification [unverified] — obtain from GRA |
| WHT | Goods 3%, works 5%, services 7.5%, commission 10%, commercial rent 15%, residential rent 8%; GHS 2,000 threshold (PwC, Mar 2026) | WHT engine by payee and payment type; certificates |
| PAYE | Act 1178 bands effective 1 Sep 2026 (0 / 5 / 10 / 17.5 / 25 / 30 / 35%) | Tax tables versioned by effective date, including mid-year changes |
| SSNIT | 5.5% employee + 13% employer; Tier 1 13.5% (incl. 2.5% NHIS), Tier 2 5%; insurable earnings GHS 587.80–69,000 (2026) | Payroll module, Phase 7 |
| Corporate tax | CIT 25%; Growth and Sustainability Levy 2.5% of PBT (2023–2028), not deductible; company land gains taxed at 25% | Tax provision schedule |
| Stamp duty (conveyance) | 0.25% / 0.5% / 1% bands; leases 0.5% / 1% | Real-estate sale calculator |
| Real Estate Agency Act 2020 (Act 1047) | s.45 no cash; s.46 client account; s.47 transaction certificate; s.48 no commingling and no commission sharing with unlicensed persons; s.49 quarterly reports; s.50 records 5+ years and auditor; s.52 annual report within 3 months | Hard controls in the real-estate module (05, M4) |
| Retention | Act 915: at least 6 years | Retention policy and archive, no hard deletes |
| Reporting framework | Public interest entities: full IFRS; other SMEs: IFRS for SMEs (ICAG) | Template per entity (IFRS_GENERAL exists; IFRS_SMES to add) |

**Still to verify** (owner: CEO with the tax practitioner, by Fri 20 Nov 2026):
- GRA E-VAT technical specification and mandatory date.
- Companies Act s.127 retention period.
- Land Act s.133 registration deadline.
- DPC renewal cycle and fees.
- Ghanaian bank coverage on Mono and Okra.
- Whether Supabase has an African region.
- ICAG adoption of the third edition of IFRS for SMEs.

## Sources
[Modern Treasury: immutability](https://moderntreasury.com/journal/enforcing-immutability-in-your-double-entry-ledger) ·
[Modern Treasury: optimistic locking](https://www.moderntreasury.com/journal/designing-ledgers-with-optimistic-locking) ·
[TigerBeetle: two-phase transfers](https://docs.tigerbeetle.com/coding/two-phase-transfers/) ·
[Supabase: RLS performance](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv) ·
[Supabase: Edge Function limits](https://supabase.com/docs/guides/functions/limits) ·
[Supabase: Realtime benchmarks](https://supabase.com/docs/guides/realtime/benchmarks) ·
[Supabase: Queues](https://supabase.com/docs/guides/queues) ·
[Supabase: branching](https://supabase.com/blog/branching-without-git-is-now-the-default) ·
[Xero JAX reconciliation (CFOtech)](https://cfotech.co.uk/story/xero-rolls-out-ai-bank-reconciliation-with-jax-tool) ·
[Midday receipt matching](https://midday.ai/docs/receipt-matching) ·
[Sage Intacct 2026 R1](https://www.cpapracticeadvisor.com/2026/02/17/sage-adds-new-ai-functions-to-intacct-for-financial-analysis-closes-and-management/178236/) ·
[Intuit AI agents](https://www.cpapracticeadvisor.com/2025/06/27/intuit-rolls-out-ai-agents-for-quickbooks/163868/) ·
[Digits AI agents](https://accountingtoday.com/news/digits-says-its-new-ai-agents-can-automate-95-of-bookkeeping-tasks) ·
[DPC enforcement 2026 (GNA)](https://gna.org.gh/2026/01/2026-will-be-a-year-of-enforcement-data-protection-commission-warns/) ·
[DPC processor registration](https://graphiconline.com/business/business-news/data-commission-begins-registration-of-data-processors.html) ·
[Record retention, Act 915](https://www.fiscal-requirements.com/news/2464-how-long-do-taxpayers-in-ghana-have-to-keep-records-and-what-are-the-penalties-for-non-compliance) ·
[BoG open banking pilot](https://www.newsghana.com.gh/bank-of-ghana-to-pilot-open-banking-framework/) ·
[MTN MoMo Collections](https://momodeveloper.mtn.com/Ghana_Collection_productDetails) ·
[Paystack GH settlement](https://mctaba.com/learn/paystack/settlement-and-payouts-on-paystack-in-ghana) ·
[Hubtel developers](https://developers.hubtel.com/) ·
[Flutterwave settlements](https://developer.flutterwave.com/docs/settlements) ·
[PowerSync + Supabase](https://docs.powersync.com/integrations/supabase) ·
[Crowe: Ghana VAT reform 2026](https://www.crowe.com/gh/news/ghana-vat-reform-2026) ·
[TaxLawGH rates](https://www.taxlawgh.com/ghana-tax-rates) ·
[Fonoa: Ghana E-VAT](https://www.fonoa.com/resources/blog/ghana-e-vat-e-invoicing-2026) ·
[GRA E-VAT onboarding (Graphic)](https://www.graphic.com.gh/news/general-news/ghana-news-e-vat-system-gra-signs-on-3-000-businesses-5-000-more-prepare-to-onboard.html) ·
[PwC: Ghana WHT](https://taxsummaries.pwc.com/ghana/corporate/withholding-taxes) ·
[PAYE Act 1178](https://regfollower.com/ghana-revises-individual-income-tax-rates/) ·
[Templars Ghana tax guide](https://www.templars-law.com/app/uploads/2026/10/Ghana.pdf) ·
[ICAG IFRS for SMEs](https://www.icagh.org/wp-content/uploads/2021/03/Adoption-of-IFRS-for-SMEs-publication.pdf) ·
[ORC annual returns 2026](https://orc.gov.gh/wp-content/uploads/2026/03/ORC-Sets-Thursday-30th-April-2026-As-Deadline-For-Filing-Annual-Returns.pdf) ·
[Real Estate Agency Act 2020 (GhaLII)](https://ghalii.org/akn/gh/act/2020/1047/eng@2020-12-29) ·
[Land Act 2020](https://superlawgh.com/land-act-2020-act-1036/)
