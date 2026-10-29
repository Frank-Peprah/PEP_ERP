# 07 — Security, controls & compliance

## 1. Control matrix

| # | Control | Implementation | Evidence / test | Phase |
|---|---|---|---|---|
| C1 | Strong identity | Supabase Auth; TOTP MFA mandatory for finance roles (AAL2 in RLS and API); 8 h session; idle timeout of 30 min; device/session list with revoke | pgTAP: an AAL1 token reads nothing financial; Playwright MFA flow | 0 |
| C2 | Least privilege | `pep_app` role (DML on its own tables only, no DDL, no `session_replication_role` change); PostgREST sees only `api` views; service-role key never in a client or repo | Privilege test: `pep_app` cannot `ALTER TABLE` or disable triggers | 0 |
| C3 | Entity isolation | API scope check + RLS + triggers (three layers) | Existing isolation tests, extended to PostgREST and Storage | 0 |
| C4 | Segregation of duties | Preparer ≠ approver ≠ poster (exists); vendor creator ≠ payment approver; payout-detail change maker-checker; role-conflict matrix checked when roles are assigned | Unit, API and DB tests per conflict | 0–3 |
| C5 | Immutability | Posted journals, lines, audit events and final statement packs are immutable (exists); documents linked to posted journals cannot be deleted (storage policy) | Existing tamper tests, plus storage tests | 1 |
| C6 | Audit trail | SHA-256 hash chain (exists); **daily anchoring** of the chain head to an external store (a signed commit to a private audit repo or object storage with object lock) | `verify_audit_chain()` nightly; anchor mismatch alert | 1 |
| C7 | Period control | Lock/reopen with reason and permission (exists); close checklist gate | Existing tests | — |
| C8 | Data protection (Act 843) | **DPC registration** (Trulander as controller; PEP/Pep Landbank as processor); PII inventory; TIN and Ghana Card encrypted (pgsodium/Vault keys) and masked; DPA template for group companies; privacy notice; subject access/export procedure | Data map in `docs/compliance/data-map.md`; registration certificate on file | 0 (paperwork) / 2 (encryption) |
| C9 | Secrets | Supabase Vault; GitHub Actions secrets per environment; quarterly rotation; gitleaks in CI | CI secret scan, rotation log | 0 |
| C10 | Transport and browser | HTTPS only; HSTS; CSP; frame-deny; strict CORS allow-list (exists); rate limiting per IP and user on auth and commands | ZAP baseline scan in CI | 0 |
| C11 | Backup and recovery | Pro + PITR; weekly encrypted `pg_dump` off-platform; **RPO 5 min / RTO 4 h**; quarterly restore drill | Restore log | 4 |
| C12 | Change management | Protected `main`; PR required; CI green; migrations reviewed; production deploy needs a tagged release + manual approval (GitHub environment); ADRs for behaviour changes | GitHub settings, deployment log | 0 |
| C13 | Vulnerability management | Dependabot; `npm audit` (fails on high); licence check; quarterly dependency review; **external pen test before go-live** | Reports in `docs/security/` | 0 / 4 |
| C14 | Monitoring | Sentry, uptime checks, business monitors (04 §7), alerting to the CEO and engineering on failure | Alert test | 1 |
| C15 | Access review | Quarterly user and role review report, signed off by the CEO | Signed report | after go-live |
| C16 | AI safety | Suggestions only; read-only reporting role; timeouts and row limits; prompt and model logging; PII minimisation; providers with no-training terms | AI activity log; benchmark tests | 6 |
| C17 | Retention | At least 6 years (Act 915); 5 years for real-estate records (Act 1047 s.50); archive, not delete; legal hold flag | Retention job tests | 1 |

## 2. Statutory compliance features

| Law / body | Requirement | Feature |
|---|---|---|
| Act 1047 (Real Estate Agency) | No cash; client account; no commingling; licensed agents only; quarterly reports; transaction certificate; 5-year records; auditor | M4 hard controls and REAC report; M3 licence register |
| Act 1151 (VAT 2025) + E-VAT | 20% combined structure; registration rules; VSDC clearance | M8 tax codes and E-VAT adapter |
| Income Tax Act / Act 1178 | WHT, PAYE (from 1 Sep 2026), CIT, GSL | M6 WHT, M11 PAYE, M8 CIT |
| Act 915 | Record keeping at least 6 years | C17 |
| Act 992 (Companies) | Accounting records, financial statements, annual returns | M2 statement packs; statutory calendar |
| Act 843 (Data Protection) | Registration, lawful processing, security safeguards | C8 |
| ICAG | Full IFRS or IFRS for SMEs | Report template per entity |

## 3. Open SECURITY.md blockers mapped to phases

| Blocker | Phase | Gate date |
|---|---|---|
| 1 Identity provider + MFA | 0 | Fri 13 Nov 2026 |
| 2 Non-superuser role + RLS | 0 | Fri 13 Nov 2026 |
| 3 TIN encryption with managed keys | 2 | Fri 11 Dec 2026 |
| 4 Rate limiting, headers, CORS | 0 | Fri 13 Nov 2026 |
| 5 Backups, PITR, restore test | 4 | Fri 5 Feb 2027 |
| 6 Audit-chain anchoring | 1 | Fri 27 Nov 2026 |
| 7 External pen test | 4 | Fri 5 Feb 2027 |
