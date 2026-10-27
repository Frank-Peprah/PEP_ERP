# ADR-001: Technology stack
**Status:** Accepted · 2026-10-27
**Decision:** TypeScript end to end — Fastify API, React/Vite web, PostgreSQL 16, decimal.js, Vitest. Modular monolith (no microservices).
**Why:** one language across domain, API and UI; Postgres gives exact NUMERIC, exclusion constraints, triggers and RLS — all used for accounting controls; a monolith keeps posting transactions local and auditable.
**Consequences:** domain package stays framework-free so it can be reused by import jobs and workers. Revisit service extraction only on demonstrated load.
