# ADR-006 — Supabase Auth with mandatory two-step verification

**Status:** accepted (Blueprint Phase 0) · **Date:** 2026-10-29

## Decision
Identity moves to Supabase Auth. The API accepts Supabase access tokens (JWTs). It verifies them against the project's published keys (JWKS: ES256, RS256 or EdDSA), or against the legacy HS256 secret when that secret is configured. It checks audience `authenticated` and issuer `<SUPABASE_URL>/auth/v1`, then maps `sub` to `users.auth_user_id`. The key type fixes the accepted algorithm, which rules out algorithm-confusion attacks.

Every entity-scoped route requires a two-step-verified session (`aal2`); otherwise the API returns `MFA_REQUIRED` (403). `/api/me` stays reachable, so the app can prompt for the second step. `REQUIRE_MFA=false` exists for staging only.

The web app signs in with email and password, then enrols or challenges a TOTP authenticator. The auth client is loaded lazily, and the session lives in `sessionStorage`.

The demo HMAC login remains for local and staging use behind the access code. It is refused in production.

## Why
- SECURITY.md blocker 1. Blueprint control C1 requires MFA for finance roles.
- Supabase Auth is already part of the hosting platform, so there is no extra vendor. MFA (TOTP) is built in.
- JWKS verification means no shared secret in the API. Key rotation is handled by Supabase.

## Consequences
- **Linking users:** a PEP user must be linked to an Auth user (`users.auth_user_id`). Until the invitation flow ships, the link is set by an administrator.
- **Two token types:** while staging keeps demo users, the API accepts both token types. Production accepts Supabase tokens only.
- **Tests:** 8 tests in `tests/security/supabase-auth.test.ts` cover both signing modes and every rejection path.
