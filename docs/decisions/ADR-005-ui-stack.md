# ADR-005 — Interface stack and design system

**Status:** accepted (UI Phase 0) · **Date:** 2026-10-29 · **Decided by:** Frank Adu-Peprah (Option A)

## Decision
React 19 + Vite 8, Tailwind CSS 4 with a token layer, Radix UI primitives styled in-house (shadcn/ui pattern: the
component code lives in this repository), React Router 8, TanStack Query, cmdk, Sonner, Lucide. Glide Data Grid for
spreadsheet entry and TanStack Table for report tables arrive in Phase 1. Charts are drawn as plain SVG.

## Why
- Owned component code: the navy/gold brand and Emil Kowalski's motion rules are applied once, in `src/design`.
- MIT/ISC licences throughout; no runtime dependency on a vendor.
- Measured: Recharts added 105 KB compressed to the dashboard; the SVG chart is under 3 KB, so it was dropped.

## Consequences
- Release 1–2 screens run through a bridge (`shell/Legacy.tsx`) until Phase 1 rebuilds them.
- Budgets (shell 180 KB, module 80 KB compressed) are checked on every Pages build.
