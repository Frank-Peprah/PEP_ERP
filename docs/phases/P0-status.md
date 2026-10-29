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

## Remaining in Phase 0 (by Fri 13 Nov)

| Item | Owner | Note |
|---|---|---|
| Staging Auth users for real sign-in | **CEO** (dashboard step) + Claude (link) | CEO: Supabase → Authentication → Add user (your email, auto-confirm). Claude links it to the demo controller profile |
| Invitation flow (admin invites, user sets password, enrols MFA) | Claude | Needs the Edge Function's service key; set-password screen |
| Groups, `approval_policies` | Claude | Needed from Phase 2 |
| Split `pep-api` into module functions | Claude | Bundle 107 KB, well under 20 MB, so low urgency |
| Rate limiting, Sentry, health page | Claude | |
| `deploy-staging.yml` (migrations + function deploy from CI) | Claude | Needs a `SUPABASE_ACCESS_TOKEN` GitHub secret (**CEO**) |
| Decisions D1 (Supabase Pro), D2 (private repo), D17 (finance lead) | **CEO** | **D2 note:** the API is currently deployed by importing the bundle from the public repo via jsDelivr. Making the repo private needs the CI deploy (above) first, or the next deploy will fail |
