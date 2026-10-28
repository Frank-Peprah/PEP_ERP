# ADR-004 — Statement packs are frozen, hashed runs

**Status:** accepted (Release 2) · **Date:** 2026-10-28

## Decision
Financial statements are generated into `financial_statement_runs` rows that hold the complete rendered pack (JSON),
its exceptions and a fingerprint of the inputs. The database computes `content_hash = sha256(pack)` on insert and
refuses any later change to the pack. Workflow moves only the status: draft → under_review → approved → final.

## Why
- Reproducibility: an approved set of accounts must read the same next year, even after account mappings or the
  template change. Comparatives therefore come from the prior year's *final* pack, not a recomputation.
- Evidence: reviewers sign off a specific hash; the audit log records it at each step.
- Staleness is detected, not silently absorbed: approving or finalising checks the input fingerprint and returns
  `STATEMENT_STALE` if posted lines, mappings, materiality, template or the comparative run changed.

## Consequences
- Storage grows with each run (packs are tens of kB); acceptable.
- Templates are append-only; a wording or structure change is a new version.
- Year-end close remains presentational (P&L to date shown within retained earnings) until a closing-journal
  feature is decided.
