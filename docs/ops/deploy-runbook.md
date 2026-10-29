# Deploy runbook — staging (`pep-erp-staging`, ref `ppyancjjjsaogyjpkxcr`)

**Who deploys:** Claude, as build administrator, through the authorised Supabase integration. No GitHub token is
needed. `.github/workflows/deploy-staging.yml` stays dormant unless a `SUPABASE_ACCESS_TOKEN` secret is added later.

## Order of operations (every release)
1. **CI green** on the branch: tests, browser journeys, licence/secret/vulnerability gates.
2. **Database migrations** (`supabase/migrations/<version>_<name>.sql`):
   - Apply each new file with the Supabase *apply migration* operation, using the file's name without the version.
   - Rename the local file to the version that staging recorded (`list_migrations`), so repo and staging history
     are identical. Never edit a migration after it has been applied; write a new one.
   - Re-run the Supabase security advisor; it must report **0 findings**.
3. **API** (`supabase/functions/pep-api`): run `node scripts/build-edge.mjs`, commit, then deploy the function pinned to that
   commit's bundle. Each deploy records the commit SHA in the function's entry file.
4. **Smoke test from inside the database** (pg_net), with secrets read inside SQL and never printed:
   - `GET /api/health` returns 200 and the expected version;
   - a forged token returns 401;
   - a demo sign-in issues a token;
   - one read per changed module returns 200.
5. **Web**: fast-forward `main`; the Pages workflow rebuilds `app/`. Confirm the CSP and entry chunk on the live site.
6. **Roll back** if any smoke test fails: redeploy the previous function version (its SHA is in the prior deploy's entry
   file). Then fix forward with a new commit. Migrations are forward-only.

## Incident log
| Date | What happened | Duration | Fix |
|---|---|---|---|
| 29 Oct 2026 | API v8 crashed at boot (wrote reserved `SUPABASE_URL`) | ~15 min | Rolled back to v7; fixed in 5890620; v10 |

## Supabase Auth settings (staging), set 29 Oct 2026
- Site URL: `https://frank-peprah.github.io/PEP_ERP/app/`
- Redirect allow-list: `https://frank-peprah.github.io/PEP_ERP/app/**`
- Public sign-ups: **off** (invitation only). TOTP MFA: **on**. E-mail confirmation: on.
