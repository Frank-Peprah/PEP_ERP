# GitHub Pages deployment

**Live URL:** https://frank-peprah.github.io/PEP_ERP/ (redirects to `/PEP_ERP/app/`)

## How it works
| Piece | Location | Purpose |
|---|---|---|
| Built web app | `app/` (committed) | React build with **relative** asset paths, so it works under any sub-path |
| Entry redirect | `index.html`, `404.html` (repo root) | Pages serves root `index.html` in preference to README; both send visitors to `app/` |
| No Jekyll | `.nojekyll` (repo root) | Files are served exactly as committed |
| Build script | `scripts/build-pages.sh` | Builds `apps/web` → `app/` and assembles `_site/` |
| Automation | `.github/workflows/deploy-pages.yml` | On changes to the web app: rebuild, commit `app/`, and deploy `_site/` |

This works with **either** Pages source setting:
- *Deploy from a branch → main / (root)* (current): GitHub publishes the repo root, so the committed `app/` is served.
- *GitHub Actions*: the workflow's deploy job publishes `_site/`, which has the same layout.

## Root cause of the original fault (2026-10-28)
With "Deploy from a branch", GitHub runs Jekyll over the raw repository. There was no `index.html`, so Jekyll rendered README.md as the home page. The React app needs an `npm` + Vite build that Jekyll never runs. The first Actions fix built the app correctly, but Jekyll's branch build ran 4 seconds later on the same push and overwrote it. Committing the build plus a root `index.html` removes that race, because both pipelines now publish the same app.

## Server-side configuration (Supabase)
The API reads `AUTH_SECRET`, `STAGING_ACCESS_CODE` and `CORS_ORIGIN` from Edge Function secrets if set; otherwise from the locked `app_config` table (migration 003; RLS on, no access for public roles).
Change the staging access code:
```sql
UPDATE app_config SET value = 'NEW-CODE', updated_at = now() WHERE key = 'STAGING_ACCESS_CODE';
```
Takes effect on the function's next cold start (redeploy `pep-api` to apply immediately).

## Updating the app
Push changes under `apps/web/`; the workflow rebuilds `app/` and deploys. To build locally: `./scripts/build-pages.sh`, then commit `app/`.
