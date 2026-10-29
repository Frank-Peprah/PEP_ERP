# Phase 0 — Re-platform & foundations: status

**Window:** Mon 2 Nov → Fri 13 Nov 2026 (started early, Thu 29 Oct). **Branch:** `phase0-platform`.

## Done

| Item (09 §Phase 0) | Evidence |
|---|---|
| 3 Identity: Supabase Auth, MFA enrolment/challenge, `users.auth_user_id`, API verifies JWT + requires aal2 | ADR-006; `tests/security/supabase-auth.test.ts` (8); sign-in screen passes axe at 1440 px and 390 px |
| 4 DB role and RLS: `pep_app`, `private.entities_with`, read policies, column grants | ADR-007; migrations 005–006; `tests/security/roles-and-rls.test.ts` (14); full suite runs as `pep_app` |
| 2 (part) `btree_gist` out of `public` | Supabase security advisor: **0 findings** on staging (was 16) |
| 6 CI: typecheck, tests on Postgres 17, budgets, browser journeys + axe, edge build; licence gate, npm audit, gitleaks | `.github/workflows/ci.yml`; `scripts/check-licences.mjs` (223 production packages, all permissive); 0 known vulnerabilities |
| Staging deploy | Migrations 005–006 applied. API v10 runs as `pep_app`. Smoke test through the live API: health 200, forged token 401, TB balanced (GHS 4,362,280 = 4,362,280), draft journal 201, audit chain intact |

**Incident (29 Oct, about 15 min):** API v8 crashed at boot because writing the reserved `SUPABASE_URL` env var is refused by Supabase's runtime. It was rolled back to v7 (ce112cd), fixed in 5890620, and redeployed as v10. Smoke tests now run from inside the database via `pg_net` after every deploy.

### Added 29 Oct (afternoon)

| Item | Evidence |
|---|---|
| Invitation flow (M0): admin invites with roles → Supabase e-mail → set password (12+ chars) → MFA enrolment | `POST /entities/:id/users/invite`, A02 Set password screen; claim-on-first-sign-in only with an open invitation for the provider-verified e-mail; `tests/platform/users-policies.test.ts` (10) |
| S04 Users & Access, S05 Approval Policies screens | `tests/e2e/platform.e2e.mjs`: 10 journeys, desktop + phone, axe clean |
| Groups, approval policies (effective-dated, append-only), `approvals_required()` | Migration 007 (staging applied; both demo entities grouped) |
| Rate limiting: 600/min per IP, 20/min on sign-in, demo and invitation routes | `lib/rate-limit.ts`; test proves the 21st attempt is refused and other clients are unaffected |
| Secret scan tuned | `.gitleaks.toml`: publishable keys allowed (public by design); **new rule catches Supabase secret keys**, which the defaults missed |
| Staging deploy from CI | `.github/workflows/deploy-staging.yml` (Supabase CLI, server-side bundling, smoke test). Waits for the `SUPABASE_ACCESS_TOKEN` secret |
| Staging | API v11 at aeb724d: users list 200, `canSendInvites: true`, policy lookup 200; advisor 0 findings |

## Remaining in Phase 0 (by Fri 13 Nov)

| Item | Owner | Note |
|---|---|---|
| Supabase Auth URL settings: Site URL and redirect allow-list = `https://frank-peprah.github.io/PEP_ERP/app/` | **CEO** (dashboard → Authentication → URL Configuration) | Without this, invitation links open the default Site URL instead of the app |
| `SUPABASE_ACCESS_TOKEN` GitHub secret | **CEO** | Enables the staging deploy workflow; then the repo can go private (D2) |
| Move migrations to `supabase/migrations` + `migration repair`; automated migration deploy | Claude | Migrations 005–007 were applied to staging with review via the Supabase tools |
| Split `pep-api` into module functions | Claude | Bundle 112 KB; low urgency |
| Error monitoring (Sentry) and health page | Claude | Needs a Sentry DSN (CEO, free tier) |
| Decisions D1 (Supabase Pro), D17 (finance lead) | **CEO** | |
