# ADR-0003 · Source of truth: PostgreSQL; everything else is a rebuildable projection

**Status:** Proposed · **Date:** 2026-09 · **Specification reference:** ADR-03

## Context

The platform needs full-text search, vector retrieval, analytics dashboards, status pages and notification state. Keeping several authoritative stores in sync is the usual source of data drift in service-management products.

## Decision

The ticket record and all module aggregates are transactional and authoritative in PostgreSQL 16 (`public` schema). Search documents, embeddings, analytics facts, status-page builds and caches are **read models** rebuilt from the outbox event stream; each has a documented rebuild procedure and a drift check where practical (analytics reconciliation nightly).

## Alternatives considered

- **Search engine or warehouse as a co-authoritative store.** Rejected: drift and dual-write risk; reporting must reconcile with tickets within 1 %.
- **Separate analytics database from PH-1.** Deferred: the `analytics` schema on a read replica meets PH-2/PH-3 needs; extraction to its own database is an evolution step.

## Consequences

- Any projection can be dropped and regenerated (runbook exists).
- Some read paths are eventually consistent (seconds); the UI shows freshness where it matters (dashboards) and uses SSE to refresh.
- PostgreSQL carries FTS and vectors initially, which keeps PH-1 simple and defers the search-engine decision (ADR-0017).
