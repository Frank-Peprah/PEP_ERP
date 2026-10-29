# 06 — UI/UX system

Foundation: **Emil Kowalski design-engineering rules** (standing project preference) on a **shadcn-admin fork**, branded navy #1B2A4A / gold #C9A84C.

## 1. Information architecture

```
Top bar:  [Entity switcher ▾ | Group (consolidated)]  [Cmd-K search]  [Inbox ●]  [Approvals ●]  [Profile]
Sidebar (role-aware; hidden items are not rendered, and the API also denies them):
  Home (role dashboard)
  Inbox (documents, unmatched lines, AI suggestions)
  Real Estate: Estates · Parcels · Contracts · Receipts · Mandates · Commissions · REAC
  Sales: Customers · Invoices · Ageing · Statements
  Purchases: Vendors · Bills · Payment runs · WHT
  Banking: Accounts · Reconcile · Cash position · Petty cash
  Accounting: Journals · Ledger · Trial balance · Chart of accounts · Periods & close · FX
  Reports: Statements · Notes · Management · Auditor pack
  Tax: VAT · WHT · CIT · E-VAT · Calendar
  Assets · Payroll · Group (when enabled)
  Settings: Entity · Users & roles · Approval policies · Integrations · System health · Audit trail
```

## 2. Interaction standards

| Standard | Rule |
|---|---|
| **Drill-down everywhere** | Every figure is a link: statement line → note → account → ledger line → journal → source document. Breadcrumbs keep the path; Back returns to the same scroll position |
| **Cross-page awareness** | The record header shows related items (a contract shows its parcel, customer, receipts and journals). Each journal shows its originating event and document. "Used in" panels on accounts and parties |
| **Keyboard-first** | Cmd-K for navigation and actions. Grid: Enter commits a cell, Tab moves on, Ctrl+Enter saves the journal, `/` focuses search, `?` opens the shortcut sheet |
| **Banana-style grid** | Account autocomplete by code or name. Live Dr/Cr totals and difference using BigInt minor units. Inline errors column. Paste from Excel. Fill handle. Save is disabled until the journal balances (drafts may be unbalanced) |
| **State is always visible** | Status chips (Draft / Submitted / Approved / Posted / Reversed). DRAFT watermark on unfinalised reports. Period-lock badge on dates |
| **Destructive and irreversible actions** | Posting, reversing, locking, payment release: a confirmation dialog that names the consequence ("Posts JV to Oct 2026; cannot be edited afterwards"). Sensitive approvals require MFA step-up |
| **Empty, loading and error states** | Skeletons for tables. Every empty state has a primary action. Errors show the stable code (for example `PERIOD_LOCKED`) and a fix |
| **Realtime** | Inbox and approval badges update live. When a record changes under you: "updated by Kofi just now — reload" (no silent overwrite; optimistic locking already exists) |
| **Mobile (PWA)** | Receipts, document capture, approvals and dashboards. Bottom navigation. Offline queue in Phase 8 |

## 3. Visual and motion rules (Emil Kowalski, applied to finance)

| Rule | Value |
|---|---|
| Figures | `font-variant-numeric: tabular-nums`; right-aligned; negatives in brackets (accounting format); `en-GH` formats; GHS prefix |
| Headings | Tracking −0.02em on large headings; body text capped at about 65ch |
| Motion: keyboard actions, Cmd-K, grid navigation | **None** |
| Motion: dropdowns and popovers | 150–200 ms, `cubic-bezier(0.23,1,0.32,1)`, origin-aware (`--transform-origin`), from `scale(0.95)` + opacity |
| Motion: modals and drawers | 200–300 ms ease-out; modals stay centred; exit faster than enter |
| Press feedback | `scale(0.97)` on `:active`, 160 ms |
| Tooltips | Delay on the first, instant on subsequent ones |
| Hover | Gated behind `(hover: hover) and (pointer: fine)` |
| Animated properties | Transform and opacity only; never `transition: all` |
| Reduced motion | Movement removed; opacity kept |
| Counts | `Intl.PluralRules`; dates absolute after 7 days |
| Accessibility | WCAG 2.1 AA, visible focus rings, ARIA on the grid (Glide accessibility mode plus a form fallback) |

## 4. Front-end architecture

- **Routing:** TanStack Router (file-based) with typed search params, so filters live in the URL and are shareable.
- **Data:** TanStack Query; supabase-js for `api.*` reads; a typed `commands` client for Edge Functions (zod schemas shared from `packages/contracts`). Mutations invalidate by query key, and Realtime events invalidate too.
- **Permissions:** `useCan('journals.approve')` hides UI. The API and RLS remain the authority.
- **Packages:** `packages/ui` (components), `packages/grid` (Glide fork + PEP cells: account, amount, date, dimension), `packages/contracts` (zod DTOs), `packages/accounting-domain` (existing).
- **Performance budgets:**
  - initial JS ≤ 250 kB gzipped (route-split);
  - interaction-to-next-paint < 200 ms;
  - a 10k-row ledger scrolls at 60 fps (virtualised);
  - Lighthouse ≥ 90 on the dashboard.
- **Quality gates:** Storybook for `packages/ui` and grid cells, axe accessibility checks in CI, and Playwright visual snapshots of key screens.
