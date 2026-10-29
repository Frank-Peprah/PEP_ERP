# PEP ERP — Build Blueprint v1.0 (29 Oct 2026)

**This is the plan of record** for turning PEP ERP (R1 ledger core + R2 statements, v0.2.0) into a full, Ghana-first, multi-entity accounting platform hosted on Supabase. Any other plan in the repo or in chat that conflicts with it is superseded.

## Executive summary

1. **Strategy: clone around a core we already own.** No open-source system is both double-entry and Supabase-native. The existing PEP ledger is stronger than any permissively licensed alternative, so it stays as the core.
   - **Forked:** the shadcn-admin UI shell (MIT).
   - **Adopted:** Basejump's tenancy/RLS patterns and pgTAP harness (MIT); Glide Data Grid (MIT, vendored); TanStack Table v9 (MIT).
   - **Ported:** TaxHacker's AI extraction (MIT); our own M0 real-estate posting engine.
   - **Study only:** ERPNext, Odoo, Midday and Bigcapital (copyleft). → [03](03-clone-strategy.md)
2. **Architecture: Supabase-native without weakening controls.**
   - Supabase Auth with mandatory MFA.
   - Commands through per-module Edge Functions running as a least-privilege role.
   - Reads through RLS-protected `api` views.
   - Realtime Broadcast; pgmq queues; Storage for evidence; Vault for secrets.
   - Every invariant enforced in three layers. → [04](04-target-architecture.md)
3. **Scope:** 13 modules and about 128 screens. Trulander's real-estate operations come first:
   - parcels, contracts and instalments;
   - mandates and client money, under the Real Estate Agency Act 2020 controls;
   - receivables, payables with WHT, and bank/MoMo reconciliation.
   → [05](05-module-catalogue.md)
4. **Delivery:** 9 phases, each with **plan → build → test → deploy** and a gate.
   - **Go-live: Fri 19 Feb 2027** (opening TB at 31 Dec 2026).
   - After go-live: Ghana tax engine with E-VAT (Mar–Apr), AI (Apr–May), assets and payroll (May–Jul), then group consolidation and industry packs (Jul–Dec 2027).
   → [09](09-phased-delivery-plan.md)
5. **Three decisions before Phase 0 starts on Mon 2 Nov:**
   - D1 Supabase Pro + PITR for production.
   - D2 make the repo private.
   - D17 name a finance lead.
   → [12](12-risks-decisions-raci.md)

## Contents

| # | Section |
|---|---|
| 01 | [Problems & requirements](01-problems-and-requirements.md): personas, 27 problems, non-functional thresholds |
| 02 | [Benchmark research](02-benchmark-research.md): Xero, QuickBooks, Intacct, NetSuite, Banana, Midday, Digits; Supabase limits; Ghana compliance facts, with sources |
| 03 | [Clone strategy](03-clone-strategy.md): what we fork, port, study and exclude; licence policy |
| 04 | [Target architecture](04-target-architecture.md): Supabase design, module boundaries, data model roadmap, RLS standard, jobs, ADRs |
| 05 | [Module catalogue](05-module-catalogue.md): 13 modules with features, screens, events, controls and acceptance gates |
| 06 | [UI/UX system](06-ui-ux-system.md): navigation, interaction standards, Emil Kowalski motion rules, front-end architecture |
| 07 | [Security & compliance](07-security-compliance.md): 17 controls; Acts 1047, 1151, 1178, 915, 992 and 843 |
| 08 | [Intelligence, real-time & integrations](08-intelligence-realtime-integrations.md): AI guardrails; banks, MoMo, gateways, E-VAT; offline |
| 09 | [Phased delivery plan](09-phased-delivery-plan.md): dated phases, gates and decisions |
| 10 | [Testing strategy](10-testing-strategy.md): 15 test layers, scenario books, Definition of Done |
| 11 | [Deployment & DevOps](11-deployment-devops.md): environments, repo layout, pipelines, migration rules |
| 12 | [Decisions, risks, RACI, costs](12-risks-decisions-raci.md) |

## Change control

The blueprint is versioned with the code. Any change to scope, dates or architecture goes in a PR that edits this folder, with a line in the table below.

| Version | Date | Change |
|---|---|---|
| 1.0 | 29 Oct 2026 | First issue, with 22 fixes from an independent consistency review applied |
