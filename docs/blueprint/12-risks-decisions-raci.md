# 12 — Decisions, risks, accountability, costs

## 1. Decision register

Each decision has a default. If the default is used, the decision can be revisited later; the cost of doing so is noted under Impact.

| # | Decision | Options | Default / recommendation | Owner | Due | Impact if late |
|---|---|---|---|---|---|---|
| D1 | Supabase plan for production | Free / **Pro + PITR** | **Pro + PITR** for production. Staging stays free until preview branching is needed | CEO (billing) | Mon 2 Nov 2026 | Blocks preview branches, the production project and backups |
| D2 | Repository visibility | Public / **Private** | **Private.** Move staging web off GitHub Pages to Netlify or Cloudflare Pages (free tiers work with private repos) | CEO | Mon 2 Nov 2026 | Schema and controls stay publicly readable |
| D3 | Production web host | Netlify / Cloudflare Pages / SiteGround | **Cloudflare Pages or Netlify** (security headers, previews). SiteGround as a static fallback | CEO | Fri 6 Nov 2026 | Phase 4 |
| D4 | Year-end close | Closing journal / presentational | **Closing journal** to retained earnings | CEO (FCCA) | Fri 13 Nov 2026 | Phase 1 rework |
| D5 | FX rate source | BoG reference / bank rate | **BoG reference** with manual override and reason | CEO | Fri 13 Nov 2026 | Phase 1 |
| D6 | Trulander framework | Full IFRS / IFRS for SMEs | Full IFRS in use now. **IFRS for SMEs** is probably what applies unless Trulander is a public interest entity | CEO | Fri 13 Nov 2026 | Note library size |
| D7 | Principal/agent mix; mandate terms | — | Both supported per contract | CEO | Fri 27 Nov 2026 | Phase 2 posting rules |
| D8 | Revenue trigger event | Indenture executed / possession / full payment | **Indenture executed or possession, whichever is first** | CEO | Fri 27 Nov 2026 | Phase 2 |
| D9 | Commission policy | Expense / capitalise | **Capitalise** incremental commissions; use the practical expedient for periods of 12 months or less | CEO | Fri 27 Nov 2026 | Phase 2 |
| D10 | SMS/WhatsApp provider | Hubtel / Twilio / Africa's Talking | **Hubtel** (local, also covers payments) | CEO | Fri 4 Dec 2026 | Phase 2 notifications |
| D11 | Banks and wallets in scope | — | The banks Trulander uses plus MTN MoMo | Finance lead | Fri 8 Jan 2027 | Phase 3 parsers |
| D12 | Payment approval thresholds | — | Two approvers above GHS 50,000 (placeholder) | CEO | Fri 8 Jan 2027 | Phase 3 |
| D13 | Ghana tax practitioner | — | Appoint an ICAG/CITG member to verify rules | CEO | Fri 15 Jan 2027 | Phase 5 blocked |
| D14 | E-VAT obligation for Trulander | — | Confirm with GRA. Start onboarding in Phase 5 | CEO + practitioner | Fri 26 Feb 2027 | E-VAT timing |
| D15 | AI provider | — | Provider behind an interface; must offer no-training terms and a DPA | CEO | Fri 2 Apr 2027 | Phase 6 |
| D16 | Payroll: build or keep outsourced | — | **Keep outsourced** until Phase 7 review; import the payroll journal | CEO | Fri 30 Apr 2027 | Phase 7 scope |
| D17 | Finance lead (owner of cleanup and UAT) | — | Named person, about 2 days/week Nov–Feb | CEO | Mon 2 Nov 2026 | **Go-live at risk** |

## 2. Risk register

| # | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | Opening balances aren't clean by cutover | H | H | The cleanup runs from Nov in parallel. Suspense (2990) is time-boxed to 60 days from the opening-TB load (zero by Fri 9 Apr 2027). Rehearsal on Oct–Dec data | Finance lead |
| R2 | Accounting decisions arrive late and force rework | M | H | Defaults in place (D-register). Decisions due before the phase that needs them | CEO |
| R3 | Review time is the bottleneck | H | M | Fixed 2–3 h CEO review slot per sprint (proposed: Fridays 14:00) | CEO |
| R4 | Glide Data Grid unmaintained (no stable release since Feb 2024) | M | M | Vendored fork. Grid isolated behind `packages/grid`. RevoGrid (MIT) as the fallback | Claude |
| R5 | Edge Function CPU limit (2 s) hit by heavy reports | M | M | Aggregation in SQL; queued jobs; measured in perf tests | Claude |
| R6 | Free-tier pausing or caps disrupt staging | H | L | D1; keep-alive check | CEO |
| R7 | Tax rules wrong or stale (PAYE changed mid-2026; VAT reform Jan 2026) | M | H | Effective-dated rules, practitioner sign-off, golden tests, DRAFT labels until reviewed | Practitioner |
| R8 | Bank and MoMo formats vary or change | H | M | Parser per format with fixtures; unknown-format queue; manual mapping UI | Claude |
| R9 | Data breach or non-compliance with Act 843 | L | H | Controls C1–C17; DPC registration; pen test | CEO |
| R10 | Scope creep pushes go-live past 19 Feb | M | H | Go-live scope frozen (Phases 0–4). New requests go to Phase 5+ unless they replace something | CEO |
| R11 | Copyleft code enters the codebase | L | H | CI licence gate; PR checkbox; studied projects are never vendored | Claude |
| R12 | Concurrent sessions changing the same repo collide (other chats also building PEP_ERP) | M | M | **One build stream at a time on `main`.** Other sessions work on branches; this blueprint is the single plan of record | CEO + Claude |
| R13 | AI suggestions trusted blindly | M | M | Suggestions only, measured thresholds, undo, activity log, benchmarks | Claude |
| R14 | Supabase region outside Africa (cross-border data transfer) | M | M | Disclosure in the privacy notice and DPC registration; review if an African region becomes available | CEO |

L = likelihood, I = impact (H/M/L).

## 3. Accountability (RACI)

| Activity | CEO (Frank) | Claude (build) | Finance lead (TBD) | Tax practitioner | External pen tester |
|---|---|---|---|---|---|
| Blueprint and phase plans | A | R | C | C | — |
| Accounting policy decisions (D4–D9, D12) | **A/R** | C | C | C | — |
| Migrations, services, UI, tests, docs | A | **R** | I | — | — |
| Scenario books (expected journals) | **A** (signs) | R (drafts) | C | C (tax cases) | — |
| Opening-balance cleanup | A | C (templates, import) | **R** | — | — |
| UAT and dress rehearsal | A | C | **R** | — | — |
| Tax rules verification | A | R (encode) | I | **R** (verify) | — |
| Security testing | A | R (fix) | — | — | **R** |
| Production deploy approval | **A/R** | R (execute) | I | — | — |
| DPC registration, GRA onboarding, billing | **A/R** | C (paperwork drafts) | C | C | — |

R = responsible, A = accountable, C = consulted, I = informed.

## 4. Running costs (estimate, to confirm in each vendor's dashboard)

| Item | Monthly | Note |
|---|---|---|
| Supabase Pro (organisation) | $25 | Includes $10 compute credit; no pausing; 8 GB DB |
| Production compute (Small) | about $15 | Micro is covered by the credit; Small recommended for production |
| PITR add-on (7 days) | about $100 | Third-party source (Sep 2026); confirm |
| Staging project compute on Pro | about $10 | Or keep staging on a separate free organisation |
| Web host (Cloudflare Pages / Netlify) | $0–$19 | Free tier likely sufficient |
| Sentry | $0–$26 | Free tier at first |
| SMS / WhatsApp | Usage-based | Hubtel per-message pricing |
| AI provider | Usage-based | Expected low hundreds of dollars a month at Trulander volume |
| External pen test | One-off | Quote needed (Phase 4) |
| **Platform total** | **about $150–$200 per month** | Excludes usage-based items and the pen test |
