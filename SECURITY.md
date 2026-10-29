# Security

## Implemented
- Server-side RBAC per entity (`roles`, `role_permissions`, `user_entity_roles`); system admin has no financial authority.
- Entity isolation on every route; unknown or unauthorised entity ⇒ 404.
- HMAC-SHA256 signed session tokens (8 h), constant-time verification.
- Parameterised SQL throughout; database errors mapped to stable codes; 500s never leak internals.
- Tax ID stored only as `tin_encrypted` (bytea) and masked in API responses.
- Audit log append-only (UPDATE/DELETE/TRUNCATE blocked by trigger) and SHA-256 hash-chained; `verify_audit_chain()` detects tampering.
- Migration runner refuses `--reset` in production and detects edited migrations.
- Statement runs (R2): pack frozen at generation and hashed by the database; final/superseded/rejected runs immutable,
  no deletes; final requires an approver and finaliser other than the preparer (DB check + service SoD); stale-run
  detection via a fingerprint of ledger, mappings, template, materiality and comparative run; every step audit-logged.

## Production blockers (must close before any live financial data)
| # | Item | Owner | Target |
|---|---|---|---|
| 1 | Replace dev login with an identity provider (OIDC) + MFA for preparer/approver/controller/admin | Engineering lead | **Built (Phase 0, ADR-006):** Supabase Auth + mandatory TOTP; demo login refused in production. Open: invitation flow, staging users |
| 2 | Non-superuser application DB role; revoke DDL; enable PostgreSQL RLS by `entity_id` | Engineering lead | **Built (Phase 0, ADR-007):** `pep_app` role, RLS read policies by entity + permission + MFA. Open: dedicated LOGIN role in production (Phase 4) |
| 3 | TIN encryption with managed keys (KMS) and rotation | Engineering lead | Before first real entity |
| 4 | Rate limiting, security headers, CORS allow-list | Engineering lead | CORS allow-list and CSP done; HSTS/frame headers on SiteGround. Open: rate limiting (Phase 0 remainder) |
| 5 | Backups, PITR, restore test; define RPO/RTO | Ops | Before production |
| 6 | Audit-chain anchoring (periodic hash published off-database) | Engineering lead | Before production |
| 7 | External penetration test | CEO sign-off | Before production |

## Staging posture
- Holds DEMO data only. Login is gated by `STAGING_ACCESS_CODE` (constant-time compare) and issues the same signed tokens.
- Supabase `anon`/`authenticated` roles have no privileges on PEP tables; RLS is enabled with no policies.
- `X-Robots-Tag: noindex` and frame-deny headers on Netlify/SiteGround. GitHub Pages cannot set custom headers, and its URL is public, so `STAGING_ACCESS_CODE` must be set.
- Staging secrets live in `app_config` (RLS on, no grants to `anon`/`authenticated`); `AUTH_SECRET` was generated inside the database and has never been displayed.
- The GitHub Pages site and the repository's committed files are publicly readable. They contain no secrets: the API URL is public by design, and access is controlled by the access code and tokens.
- Blocker 1 (real identity + MFA) must close before any real Trulander data is loaded into staging.

## Known limitation
A database superuser can disable triggers. Triggers protect against application bugs and ordinary SQL; protection against privileged insiders comes from blockers 2 and 6.
