# 03 — Clone strategy: what we fork, what we port, what we only study

**Principle:** we do not write from scratch what a maintained, permissively licensed project already does well. We also do not copy copyleft code into a product that may be sold as SaaS or used by separate group companies over a network. Licences below were verified from each repo's LICENSE file on 29 Oct 2026.

## 1. The finding that shapes the strategy

**No open-source system is both double-entry and Supabase-native.**

| Project | Why it doesn't fit as-is |
|---|---|
| Midday | Supabase-native, but not a general ledger (it categorises transactions and syncs out to accounting software) |
| Bigcapital | Double-entry, but on MySQL |
| ERPNext | Double-entry, but on MariaDB/Python |
| Odoo | Double-entry, but on Python |

The PEP ERP ledger core (R1–R2: workflow, SoD, gapless numbering, hash-chained audit, frozen statement packs) is **already stronger than any permissive ledger we could clone**, including pgledger. So the core stays ours, and we clone around it.

## 2. Clone map

| Layer | Clone source | Licence | How we use it | Phase |
|---|---|---|---|---|
| **Frontend shell** (layout, sidebar, top bar, theming, auth pages, data-table, settings, command palette, error pages) | [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) | MIT | **Fork into `apps/web`.** React 19, Vite, Tailwind 4, TanStack Router, shadcn/ui. Rebrand navy/gold. Port the existing 9 PEP pages into it. Replace demo auth with Supabase Auth | 0 |
| **Component system** | [shadcn/ui](https://ui.shadcn.com) (copy-in), Radix/Base UI, Sonner, cmdk, react-hook-form + zod, react-day-picker, lucide, Recharts | MIT / ISC | Components live in-repo (`packages/ui`) and are tuned to the Emil Kowalski rules (06) | 0 |
| **Spreadsheet entry grid** | [Glide Data Grid](https://github.com/glideapps/glide-data-grid) 6.0.3 | MIT | Journal grid, bank-statement grid, import preview, budget grid. **Pinned, and vendored as a fork** because there has been no stable release since Feb 2024 | 0–1 |
| **Report and list tables** | [TanStack Table](https://github.com/TanStack/table) **v9** + TanStack Virtual | MIT | Standardise on v9 now (v9.3.1, Oct 2026); port shadcn-admin's v8 data-table once in Phase 0 | 0 |
| **Multi-tenancy, RLS and DB test harness** | [Basejump](https://github.com/usebasejump/basejump) migrations + `supabase_test_helpers` | MIT | Copy its membership/role and RLS patterns and its pgTAP helpers. Remodel as **group → entity → user role**, mapped onto our existing `user_entity_roles` and `role_permissions`. Unmaintained upstream, so we own the copy | 0 |
| **Ledger balance cache pattern** | [pgledger](https://github.com/pgr0ss/pgledger) | MIT | Borrow its versioned account-balance design for a **rebuildable, reconciled** period-balance cache (ADR-003 trigger: above 1M lines). Not authoritative | 1 / 6 |
| **Real-estate posting engine** | Our own M0 build (branch `m0-realestate-posting-engine`) | Ours | Port event → effective-dated posting rules, parcels, parties and the real-estate chart of accounts into `database/migrations/005+` on the PEP schema | 2 |
| **AI document extraction** | [vas3k/TaxHacker](https://github.com/vas3k/TaxHacker) | MIT | Port the extraction prompts, field schema and FX-at-transaction-date logic into a Supabase Edge Function worker. Replace Prisma with our DB layer. Add Ghana fields (TIN, E-VAT QR/signature, Ghana Card) | 6 |
| **Offline capture and sync** | [PowerSync JS SDK](https://github.com/powersync-ja/powersync-js) | Apache-2.0 (service FSL-1.1-ALv2: OK for our own product, can't be resold as a sync service) | Receipt capture, drafts and field screens offline; posting stays server-side | 8 |
| **Optional workpaper spreadsheet** | [Univer](https://github.com/dream-num/univer) core | Apache-2.0 | Only if users need formulas or workpapers. **Avoid the Pro features** (collaboration, import/export, print) | 8 (optional) |

## 3. Study only: design reference, no code copied

| Project | Licence | What we study | Where it lands |
|---|---|---|---|
| ERPNext / Frappe HRMS | GPL-3.0 | Doctypes: Sales/Purchase Invoice, Payment Entry, Payment Ledger, Period Closing Voucher, Asset, Depreciation Schedule, Salary Structure, multi-company | M3–M8 data models |
| Odoo Community | LGPL-3.0 | `account.move` / `account.move.line`, the reconciliation model, multi-company and intercompany rules | Bank reconciliation, consolidation |
| Midday | AGPL-3.0 (plus a commercial-licence claim in its README) | Magic Inbox UX, three-state matching, embedding categorisation, RLS volume (111 policies) | Inbox, AI suggestions |
| Bigcapital | AGPL-3.0 | Module scope, report catalogue, default chart of accounts | Report catalogue (05) |
| LedgerSMB | GPL-2.0 | Postgres GL and AR/AP schema, audit controls | Cross-check of our schema |
| Blnk | Apache-2.0 (code reusable, but it's a Go service) | Reconciliation rule language, matching strategies | Bank-matching rules engine |
| Apache Fineract | Apache-2.0 | Loan product accounting | CLAF / lending products (later) |
| Twenty | AGPL core; MIT `twenty-ui` | Metadata-driven custom fields | Custom fields per industry pack |
| Modern Treasury, Stripe, TigerBeetle write-ups | Docs | Immutability, clearing accounts, pending vs posted balances | Already adopted (02) |

## 4. Excluded

| Project | Reason |
|---|---|
| Akaunting | BSL 1.1: production limits and a ban on "Accounting Service" use |
| Invoice Ninja | Elastic License 2.0: no managed-service use |
| Handsontable | Commercial licence with a non-compete clause |
| Crater | Stale for about 2 years |
| Frappe Books | Archived (EOL Oct 2026) |
| Formance v3 | No licence file on `main` |
| TigerBeetle | Not Postgres; overkill at our volumes |
| AG Grid Community for entry | Clipboard and range selection are Enterprise features |
| Refine, Ant Design Pro | Generic look; an extra abstraction layer we don't need |

## 5. Licence hygiene: enforced in CI from Phase 0

1. `license-checker` (or `licensee`) runs in CI. **The build fails on any AGPL, GPL, SSPL, BSL, ELv2 or unknown licence** in production dependencies.
2. `THIRD_PARTY_NOTICES.md` is generated on every release (MIT/Apache attribution). Obra shadcn/ui Figma kit: credit Obra Studio BV (CC BY 4.0).
3. Forked code keeps its upstream licence header. Each fork records the upstream commit SHA in `vendor/<name>/UPSTREAM`.
4. PR template checkbox: "No code copied from copyleft or source-available projects."

## 6. Fork mechanics

```
apps/web/            ← forked from shadcn-admin @ <sha>; history squashed; UPSTREAM file kept
packages/ui/         ← shadcn components (copy-in), tuned to the Emil rules
packages/grid/       ← vendored Glide Data Grid fork @ 6.0.3 + PEP patches
packages/accounting-domain/   ← existing (ours)
database/migrations/ ← existing 001–004 + new; Basejump patterns adapted as 005_tenancy_rls.sql
supabase/            ← Supabase CLI project (config.toml, functions/, tests/ pgTAP)
```

Upstream sync: once a quarter, review upstream changes in shadcn-admin and Glide for security fixes only, and cherry-pick them deliberately. We never merge an upstream wholesale.
