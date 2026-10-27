# Deploying the web app to SiteGround

SiteGround hosts the **web app only** (static files on Apache). The API and database stay on
Supabase: SiteGround offers PHP/MySQL, and the ledger's integrity controls are PostgreSQL triggers.

## Build
```bash
VITE_API_BASE=https://ppyancjjjsaogyjpkxcr.supabase.co/functions/v1/pep-api npm run build:web
```
`apps/web/dist/` then contains `index.html`, `assets/`, `favicon.svg` and `.htaccess`
(SPA routing, HTTPS redirect, security headers, `noindex`).

## Upload (SiteGround Site Tools)
1. Domain → Subdomains → create e.g. `erp.<your-domain>` (document root `public_html/erp` or as SiteGround sets it).
2. Security → SSL Manager → install Let's Encrypt for the subdomain.
3. Site → File Manager → open the subdomain's folder → upload the zip → Extract. `index.html` must sit at the folder root.
   Show hidden files to confirm `.htaccess` is present.
4. Security → HTTPS Enforce: on.

## Lock the API to the subdomain
Add Supabase Edge Function secret `CORS_ORIGIN=https://erp.<your-domain>` so only that site can call the API from a browser.

## Updating
Rebuild and re-upload `dist/`. Hashed asset filenames prevent stale caches; `index.html` is served `no-cache`.
