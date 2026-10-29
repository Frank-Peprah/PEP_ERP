# 04 — Target architecture on Supabase

## 1. Where we are vs where we are going

| Concern | Today (v0.2.0) | Target | Why |
|---|---|---|---|
| Identity | Custom HMAC tokens, demo login and a shared staging access code | **Supabase Auth**: email/password + TOTP MFA; AAL2 required for every finance role; SSO later | SECURITY.md blocker 1; MFA is a hard requirement |
| API | One Fastify app bundled into one Edge Function (`pep-api`), dispatched via `app.inject()` | **The same Fastify services, split into per-module Edge Functions** (`ledger`, `realestate`, `banking`, …), sharing `packages/*` | Keeps every bundle well under 20 MB and isolates failures. The 2 s CPU limit applies per request |
| DB access from the API | Privileged `SUPABASE_DB_URL` | **Dedicated non-superuser role `pep_app`**: DML only on its own tables, no DDL, cannot disable triggers | SECURITY.md blocker 2 |
| Reads | Everything through the API | **Commands via the API; queries via PostgREST** on an `api` schema of `security_invoker` views protected by RLS | Faster lists, Realtime, and less API code. Permissions are enforced by RLS on the same tables |
| RLS | Enabled, no policies (deny-all) | **Policies on every table**: entity membership + permission + AAL2, using the Supabase performance pattern | Third enforcement layer (ADR-002) |
| Long work | Inside the request (statements, TB) | **pgmq queues + pg_cron + worker functions**; heavy aggregation in SQL | Edge CPU limit; reliable retries |
| Live updates | None | **Realtime Broadcast** from DB triggers on `entity:{id}` channels | Live dashboards and approval inboxes |
| Documents | None | **Storage**, private bucket, RLS by entity path, SHA-256 per file | Evidence drill-down (R1b gap) |
| Secrets | `app_config` table | **Supabase Vault**; `app_config` kept only for non-secret settings | Managed secrets with rotation |
| Web hosting | GitHub Pages (public repo; cannot set security headers) | **Staging:** GitHub Pages or Netlify. **Production:** Netlify or Cloudflare Pages (security headers, preview deploys) or SiteGround, all static | Headers, CSP, previews |
| Supabase plan | Free (pauses after 7 days idle; 2-project cap already reached; no PITR) | **Pro for production** (no pausing, 8 GB, daily backups) **plus the PITR add-on** (about $100/mo for a 7-day window, per a third-party Sep 2026 source; confirm in dashboard) | RPO/RTO targets; branching needs a paid plan |

## 2. Logical architecture

```
┌──────────────────────── Browser / PWA (apps/web: shadcn-admin fork) ────────────────────────┐
│ TanStack Router · TanStack Query cache · Glide grid · TanStack Table v9 · cmdk · Sonner      │
│ supabase-js: Auth (MFA) · PostgREST reads (api.*) · Realtime Broadcast · Storage uploads     │
│ PowerSync local SQLite (Phase 8: capture & drafts only)                                       │
└───────────────┬───────────────────────────────┬───────────────────────────────┬──────────────┘
         commands (JWT)                   queries (JWT, RLS)               files (JWT, RLS)
                │                               │                               │
┌───────────────▼───────────── Supabase Edge Functions (Deno) ──────────────┐   │
│ ledger · statements · realestate · receivables · payables · banking ·     │   │
│ tax · ai · imports · notifications · webhooks (MoMo/Paystack/Hubtel)      │   │
│   → apps/api services + @pep/accounting-domain (decimal.js, pure rules)   │   │
│   → connect as role pep_app; SET pep.actor_id = <auth uid> per tx         │   │
└───────────────┬───────────────────────────────────────────────────────────┘   │
                │                                                               │
┌───────────────▼────────────────────────── Postgres 17 ───────────────────────▼──────────────┐
│ schemas:  pep (tables, not exposed) · api (security_invoker views, exposed) · private (RLS    │
│           helpers, security definer) · audit · reporting (read-only BI / AI views) · pgmq     │
│ invariants: triggers & constraints (balance, immutability, period lock, SoD, audit chain)     │
│ events: pep.outbox → broadcast trigger (realtime) + pgmq enqueue (workers)                    │
│ jobs: pg_cron → worker functions (imports, OCR, nightly checks, FX reval, anchoring)          │
│ Vault (secrets) · Storage (documents bucket) · pgvector (AI embeddings, Phase 6)              │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

**The rule that keeps this correct:** reads may go direct (RLS-protected), but **every state change to financial data goes through a command service**. The service validates, the database re-validates, and both audit. PostgREST never receives INSERT/UPDATE/DELETE grants on financial tables.

## 3. Module boundaries: a modular monolith

Each module owns:
- its tables (in schema `pep`, prefixed by module);
- its service file(s) in `apps/api/src/modules/<m>/`;
- its Edge Function entry;
- its `api.*` views;
- its UI route folder;
- its tests.

Modules talk to each other in exactly two ways:

1. **Posting events → ledger.** A module never inserts journal lines. It calls `ledger.postFromEvent(eventType, sourceRef, payload)`. That resolves the **effective-dated posting rule** (ported from M0), builds a journal, and runs it through the normal workflow. Auto-approval applies only where policy allows (for example a system receipt under a threshold); otherwise the journal is a draft in the approval inbox.
2. **Domain events → outbox.** For example `contract.signed` or `receipt.recorded`. These are written in the same transaction to `pep.outbox`, then fanned out to Realtime and queues. Consumers are idempotent (`event_id` unique).

```
realestate ──contract.control_transferred──▶ posting engine ──▶ journal (draft/auto) ──▶ ledger
banking    ──statement_line.matched────────▶ posting engine ──▶ journal
payables   ──bill.approved─────────────────▶ posting engine ──▶ journal
every module ──outbox──▶ realtime broadcast (UI) + pgmq (AI, notifications, analytics)
```

## 4. Data model roadmap

`●` exists today · `◐` partly exists · `○` to build.

| Domain | Tables | Phase |
|---|---|---|
| Core ledger | ● entities, users, roles, role_permissions, user_entity_roles, financial_years, accounting_periods, accounts, journal_entries, journal_lines, journal_sequences, audit_events, report_templates, financial_statement_runs | — |
| Ledger completion | ○ dimensions + dimension_values (cost centre, project, parcel, department); ○ journal_line_dimensions; ○ fx_rates, fx_revaluation_runs; ○ close_checklists, close_tasks; ○ attachments (journal/document links); ○ import_batches, import_rows; ○ period_balances (cache, rebuildable) | 1 |
| Tenancy & identity | ○ groups; ◐ entities.group_id; ○ auth link (users.auth_user_id); ○ approval_policies (thresholds by document type) | 0 |
| Posting engine | ○ business_events, posting_rules, posting_rule_lines (from M0); ○ outbox | 2 |
| Parties | ○ parties (customer, landowner, agent, vendor, employee, related party), party_contacts, party_bank_accounts (maker-checker on change), party_kyc (Ghana Card / TIN, encrypted) | 2 |
| Real estate | ○ estates, parcels (status machine, GLRRA score link), parcel_cost_components, sale_contracts, contract_parties, instalment_schedules, receipts, mandates, client_money_accounts, commissions, reac_quarterly_reports | 2 |
| Receivables | ○ customer_invoices, credit_notes, allocations, dunning_runs, ecl_matrix | 2–3 |
| Payables | ○ bills, bill_lines, payment_runs, payments, wht_deductions, wht_certificates | 3 |
| Banking | ○ bank_accounts (bank, MoMo wallet, gateway, petty cash), statement_imports, statement_lines, match_rules, matches, settlement_batches | 3 |
| Tax | ○ tax_codes, tax_rules (effective-dated, with source, reviewer and verified date), tax_returns, evat_submissions | 5 |
| Intelligence | ○ suggestions, model_runs, embeddings (pgvector), anomaly_alerts, saved_questions | 6 |
| Fixed assets | ○ asset_classes, assets, depreciation_schedules, disposals | 7 |
| Payroll | ○ employees, pay_elements, payroll_runs, payslips, ssnit_schedules, paye_returns | 7 |
| Group | ○ intercompany_pairs, ic_transactions, consolidation_runs, eliminations, budgets, budget_lines, forecasts | 8 |
| Industry packs | ○ items, warehouses, stock_moves (wholesale, FMCG, manufacturing); ○ boms, work_orders (Brandini); ○ projects, contract_milestones, retentions (construction); ○ bookings, supplier_settlements (travel) | 8+ |

## 5. RLS standard (applies to every table, no exceptions)

```sql
-- helper (private schema, security definer, stable): entity ids where the caller
-- holds a given permission. Takes no row column, so wrapped in (select …) it is
-- evaluated ONCE per statement (initPlan), not once per row.
create function private.entities_with(p_perm text) returns uuid[] ...;

create policy journals_read on pep.journal_entries
  for select to authenticated
  using ( entity_id = any ( (select private.entities_with('journals.read')) )
          and (select auth.jwt() ->> 'aal') = 'aal2' );
create index on pep.journal_entries (entity_id);   -- every policy column indexed
```

- There are no insert/update/delete policies for `authenticated` on financial tables. Writes go only through `pep_app` in command services.
- pgTAP tests prove, for each role × table: what may be read, that nothing may be written, and cross-entity isolation. These extend the existing `tests/security` suite.

## 6. Realtime and jobs

**All channels are private** (`config: { private: true }`). RLS policies on `realtime.messages` allow a subscription only when the topic's entity id is in `private.entities_with('<perm>.read')` for the caller. Broadcast payloads carry ids and status only, never amounts or PII; the client refetches the details through RLS.

| Channel / queue | Producer | Consumer |
|---|---|---|
| `entity:{id}:inbox` (broadcast) | Outbox trigger on approval-state changes | Approval inbox badge and list |
| `entity:{id}:cash` (broadcast) | Posting to cash-class accounts | Live cash tile |
| `entity:{id}:jobs` (broadcast) | Worker progress | Import and statement progress bars |
| `q_imports` (pgmq) | Upload completed | Import worker: parse, validate, preview (never auto-posts) |
| `q_ocr` (pgmq) | Document uploaded | AI extraction worker → `suggestions` |
| `q_notifications` (pgmq) | Outbox | Email, SMS or WhatsApp sender (Hubtel/Twilio adapter) |
| Nightly cron | pg_cron | Clearing-account zero check; suspense ageing; overdue instalments; audit-chain anchoring; balance-cache reconciliation; FX rate fetch (BoG) |

## 7. Observability and operations

- **Logs:** Supabase logs (API, Postgres, Edge, Auth) plus structured JSON logs from services with `request_id` and `actor_id`.
- **Errors:** Sentry SDK (MIT) on web and Edge, with PII scrubbing.
- **Uptime:** `/health` per function, monitored externally every 5 minutes.
- **Business monitors:** TB balanced per entity; audit chain verified; clearing accounts at zero; queue depth; failed jobs. These appear on an "System health" admin page and raise alerts.
- **Backups:** Pro daily backups + PITR, plus a weekly `pg_dump` to storage outside Supabase (encrypted). A quarterly restore drill is recorded in `docs/ops/restore-log.md`.

## 8. Architecture decisions to record as ADRs (Phase 0)

| ADR | Decision |
|---|---|
| ADR-005 | Supabase Auth with MFA replaces custom tokens; AAL2 enforced in RLS and the API |
| ADR-006 | Commands through module Edge Functions as `pep_app`; queries through PostgREST `api` views with RLS |
| ADR-007 | Posting engine: modules emit events; effective-dated rules build journals; no module writes ledger lines |
| ADR-008 | Outbox → Realtime Broadcast + pgmq; Postgres Changes is not used on ledger tables |
| ADR-009 | Clone strategy and licence policy (03) |
| ADR-010 | TanStack Table v9 and the Glide fork as the grid standards |
| ADR-011 | Environments: local → PR preview branch → staging → production, with migration promotion rules |
