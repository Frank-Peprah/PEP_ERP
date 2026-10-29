# 08 — Intelligence, real-time and integrations

## 1. AI architecture

```
document / bank line / question
   │
   ▼
q_ocr / q_suggest (pgmq) ──▶ ai worker (Edge Function)
   │                          ├─ extraction: TaxHacker-derived prompts + zod schema → fields + confidence
   │                          ├─ retrieval: pgvector over the entity's COA, parties and past accepted postings
   │                          ├─ proposal: draft journal / match / category (arithmetic recomputed in SQL)
   │                          └─ log: model, prompt version, input hash, latency, cost → model_runs
   ▼
pep.suggestions (status: proposed → accepted | rejected | auto_applied | undone)
   │
   ▼
Inbox UI: accept / edit / reject  ──▶ accepted → command service → normal workflow (draft → approval)
```

**Rules:**
1. AI never posts. It creates suggestions and drafts only.
2. Auto-apply is allowed only for matching rules whose measured precision is at least 98%, per bank account, switchable, and logged on an automation page with undo.
3. No LLM arithmetic. Totals, balances and tax come from SQL and the domain package.
4. "Ask the books" works like this:
   - The model writes SQL against `reporting.*` only. That schema holds curated views with business names.
   - The SQL runs under the role `pep_reporting_ro`, with RLS, `statement_timeout = 5s` and a 1,000-row limit.
   - The SQL is shown to the user, and the answer cites the journals behind it.
   - Questions outside the schema are refused.
5. **Provider:** chosen behind an interface (`packages/ai`). It must offer no training on our data and a DPA. Data is minimised: masked PII, no Ghana Card or TIN in prompts.
6. **Evaluation:** each AI capability has a benchmark set in `tests/ai/`, run in CI on prompt or model change. A regression blocks the merge.

## 2. Real-time intelligence

| Signal | Source | Delivery | Phase |
|---|---|---|---|
| Cash position (by bank, MoMo, petty cash, entity) | Posted lines on cash-class accounts, plus pending (approved, unposted) | Broadcast `entity:{id}:cash`; dashboard tile | 3 |
| Collections vs schedule (today, week, month) | Instalment schedules vs receipts | Dashboard plus a daily digest | 2 |
| Approvals waiting | Workflow state | Badge, inbox, optional SMS for over-threshold items | 0–1 |
| Exceptions | Nightly and continuous checks: escrow ≠ liability, suspense ageing, unreconciled more than 7 days, overdue instalments, anomaly rules | Anomaly centre plus alerts | 3–6 |
| Parcel margin | Contract price vs cost components | Estate map colour and parcel detail | 2 |
| Close progress | Checklist plus auto-checks | Close dashboard; days-to-close | 1 / 6 |

## 3. Integrations: adapter pattern

Every external system sits behind `packages/integrations/<name>`, with this interface:

`fetchStatement(range)` · `handleWebhook(payload, signature)` · `normalise() → StatementLine` · `healthcheck()`

| Integration | Mode | Phase | Notes |
|---|---|---|---|
| Ghanaian banks | CSV / Excel / MT940 / PDF import parsers per bank | 3 | Open banking is at BoG pilot stage, so API adapters come later |
| MTN MoMo (Collections) | Webhook (callbacks) plus monthly portal statement import | 3 | Settlement clearing account; about 2% fee modelled |
| Telecel Cash, AT Money | Statement import | 3 | Same parser framework |
| Paystack / Hubtel / Flutterwave | Webhooks plus settlement report API | 3 | Gross / fee / net clearing; T+1/T+2 settlement |
| SMS / WhatsApp (Hubtel SMS, WhatsApp Business API) | Outbound through `q_notifications` | 2 | Receipts, reminders, approvals. Opt-in recorded (Act 843) |
| Email (Resend / SMTP) | Outbound; inbound document forwarding address | 2 / 6 | |
| GRA E-VAT (VSDC) | Clearance API; submission queue; 24 h offline catch-up | 5 | Start onboarding with GRA early: about 4 weeks of joint testing |
| BoG FX reference rates | Daily fetch (or manual entry fallback) | 1 | Rate source hierarchy is an open decision |
| GLRRA / Landbank marketplace | Parcel risk score and listing sync via API | 8 | Group synergy |
| Excel | Import templates and exports everywhere | 1+ | Banana-like familiarity |

**Webhook rules:**
- Verify signatures.
- Make handlers idempotent: provider event id unique.
- Store the raw payload (encrypted) for 90 days.
- Never post directly; always go through matching or a posting event.

## 4. Offline and sync (Phase 8)

- PowerSync SDK in the PWA, with sync rules scoped to the user's entity and role.
- **Offline-capable:** receipt capture (queued), document photos, draft journals and draft contracts, read-only dashboards (last sync).
- **Never offline:**
  - posting
  - approvals
  - period actions
  - payments
- Conflicts: drafts are last-writer-wins, with the version shown. Server validation rejects stale submissions (the existing `STALE_VERSION`).
