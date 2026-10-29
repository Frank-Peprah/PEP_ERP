# 11 — Deployment & DevOps (GitHub `Frank-Peprah/PEP_ERP` + Supabase)

## 1. Environments

| Env | Supabase | Web | Data | Who deploys | Trigger |
|---|---|---|---|---|---|
| **Local** | `supabase start` (Docker) or plain Postgres 17 (existing tests; matches production) | Vite dev server | Seed A / B | Developer | — |
| **Preview** | Supabase branch per PR (needs a paid plan) | Netlify / Cloudflare preview URL | Seed B | CI | PR opened or updated |
| **Staging** | `pep-erp-staging` (exists, eu-west-2) | GitHub Pages today → staging host | Seed A (demo only) | CI | Merge to `main` |
| **Rehearsal** | `pep-erp-rehearsal` (temporary, Phase 4) | Staging host, separate config | Real Oct–Dec 2026 copy | CI + manual | Manual |
| **Production** | `pep-erp-prod` (new, **Pro + PITR**, eu-west-2 unless an African region is confirmed) | Production host with custom domain (e.g. `app.pepaccounting.com`, to confirm) | Real | CI after manual approval | Tag `v*` + GitHub environment approval by the CEO |

## 2. Repository structure (target)

```
PEP_ERP/
├─ apps/
│  ├─ web/                 React app: design system + shell (ADR-005)
│  ├─ api/                 Fastify services (commands), grouped by module
│  └─ site/                public website (static)
├─ packages/
│  ├─ accounting-domain/   pure rules (exists)
│  ├─ contracts/           zod DTOs shared web ↔ api
│  ├─ ui/                  design system
│  ├─ grid/                Glide fork + PEP cells
│  ├─ integrations/        banks, MoMo, gateways, E-VAT, SMS
│  └─ ai/                  provider interface, prompts, evals
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/          single ordered migration history
│  ├─ functions/           ledger, statements, realestate, banking, … (thin entry files)
│  ├─ tests/               pgTAP
│  └─ seed.sql
├─ tests/                  vitest: unit, integration, security, scenarios, perf, ai
├─ e2e/                    playwright
├─ docs/
│  ├─ blueprint/  decisions/  phases/  uat/  ops/  security/  compliance/
└─ .github/workflows/      ci, deploy-staging, deploy-prod, pages, nightly
```

## 3. Pipelines

| Workflow | Trigger | Steps |
|---|---|---|
| `ci.yml` | Every PR and push | Install → typecheck → lint → unit → spin up Postgres 17 → migrations from zero → integration + tamper + scenarios → pgTAP → build web → Playwright smoke + axe → licence check, gitleaks, npm audit → upload reports |
| `preview.yml` | PR (once on a paid plan) | Create Supabase branch → migrate + Seed B → deploy functions to branch → web preview → comment URLs on the PR |
| `deploy-staging.yml` | Merge to `main` | `supabase db push` (staging) → deploy functions → build and deploy web → smoke tests on staging → post a summary |
| `deploy-prod.yml` | Tag `v*.*.*` | **Manual approval (CEO)** → pre-deploy backup marker → `supabase db push` (prod) → deploy functions → deploy web → smoke tests → automatic rollback of web/functions on failure (DB migrations are forward-only; a fix-forward migration is prepared in advance for risky changes) |
| `nightly.yml` | 02:00 GMT | Reconciliation monitors against staging; dependency audit; ZAP baseline; AI evals (when prompts change) |

**Secrets:** GitHub environment secrets per environment (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, project refs, host tokens). The service-role key is never stored in the web build.

## 4. Branching and release

- **Trunk-based.** Short-lived branches `feat/<module>-<topic>`; squash-merge to `main`; feature flags (`app_config` + per-entity flags) for incomplete modules.
- Protected `main`: PR required, CI green, linear history.
- **Versions:** `v0.<phase+4>.<patch>` until go-live (v0.3.0 was UI Phase 0, so Phase 0 is v0.4.0 and Phase 4 is v0.8.0), then `v1.0.0` on Fri 19 Feb 2027 and semantic versioning after.
- Every release has CHANGELOG notes, a migration list and a rollback note.

## 5. Migration rules

1. Forward-only and immutable once merged (the existing edited-migration check stays).
2. Expand → migrate → contract for breaking changes; never drop a column in the release that stops using it.
3. Every migration is tested from zero **and** on the staging snapshot in CI.
4. Ledger tables: no destructive DDL without an ADR and CEO approval.

## 6. Clean-up of the current setup (Phase 0)

| Item | Action |
|---|---|
| Two migration histories (`database/migrations` and the M0 branch) | One history under `supabase/migrations`; M0 ported as new numbered migrations in Phase 2. The `m0-realestate-posting-engine` branch is kept as reference until then |
| Committed build output (`app/`, root `index.html`/`404.html`) for branch-mode Pages | Move to Actions-only Pages deployment, or the new staging host; stop committing build artefacts to `main` |
| Single `pep-api` function | Split by module |
| Public repository | See decision D2 (12) |
| Free plan, 2 active projects (cap reached) | See decision D1 (12) |
