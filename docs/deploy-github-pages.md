# Deploying the web app to GitHub Pages

**Live URL:** https://frank-peprah.github.io/PEP_ERP/

The workflow `.github/workflows/deploy-pages.yml` builds `apps/web` with Vite and publishes `apps/web/dist`.
The API and database stay on Supabase; the app calls the API directly (`VITE_API_BASE`).

## One-time setup
1. GitHub → repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
   (With "Deploy from a branch", GitHub runs Jekyll on the raw repo and publishes the README. That was the original fault.)
2. **Actions → Deploy web app to GitHub Pages → Run workflow**, or push any change under `apps/web/`.

## Why the build settings matter
| Setting | Value | Without it |
|---|---|---|
| `VITE_BASE` | `/PEP_ERP/` | Project Pages live under a subpath; assets would load from `/assets/…` and 404, leaving a blank page |
| `VITE_API_BASE` | Supabase function URL | Pages is static; there is no `/api` proxy |
| `.nojekyll` | present | Jekyll could alter or drop files |
| `404.html` | copy of `index.html` | Refreshing a deep link would show GitHub's 404 |

## API-side requirements (Supabase → Edge Functions → Secrets)
- `AUTH_SECRET` (≥ 32 chars): **required**; without it sign-in returns 503 `AUTH_NOT_CONFIGURED`.
- `STAGING_ACCESS_CODE`: strongly recommended; the Pages URL is public.
- `CORS_ORIGIN`: optional allow-list. If set, include `https://frank-peprah.github.io` (comma-separate multiple origins).
