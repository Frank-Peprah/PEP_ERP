# ADR-002: Enforce accounting invariants in the database as well as the application
**Status:** Accepted · 2026-10-27
**Decision:** Balance, immutability of posted records, valid status transitions, period lock, account validity and audit append-only are enforced by PostgreSQL triggers/constraints, in addition to the domain service.
**Why:** auditors and regulators need assurance that records cannot be altered outside the workflow — including by scripts, future modules or bugs. Tests in `tests/security` attempt direct SQL tampering and prove it fails.
**Consequences:** some rules exist twice (by design). Migrations must update both. Superuser bypass is mitigated by a non-superuser app role + RLS (SECURITY.md blocker 2).
