# ADR-0017 · Search: PostgreSQL full-text projection first; Meilisearch from PH-3 behind the same interface

**Status:** Accepted 2026-09-14 (OD-02 recommendation; revisit at PH-3 start) · **Date:** 2026-09 · **Specification reference:** §4.2 Search, MOD-09-E1, OD-02

## Context

PH-1/PH-2 need permission-filtered global search across tickets, knowledge and catalogue with < 200 ms p95 and < 5 s freshness; PH-3 adds typo tolerance and facets. Running a search cluster in PH-1 is unnecessary operations.

## Decision

A `search_document` projection table (tsvector, ACL, facets) maintained by an indexer consumer serves search in PH-1/PH-2 through `SearchService`. In PH-3, add **Meilisearch** as a Railway service with one index per tenant and ACL fields as filterable attributes; only the adapter behind `SearchService` and the indexer's sink change. OpenSearch remains the alternative if PH-2 relevance feedback demands richer analytics or the tenant count makes per-tenant indexes impractical.

## Alternatives considered

- **OpenSearch from PH-1.** Rejected: operational weight; JVM sizing; PH-1 needs are met by PostgreSQL.
- **PostgreSQL only, forever.** Possible for small tenants but lacks typo tolerance and faceting ergonomics at scale.
- **Hosted search SaaS (Algolia).** Rejected: data residency and per-record pricing.

## Consequences

- Permission filtering at retrieval is designed once (ACL on the document) and reused by the PH-4 vector retriever.
- The PH-3 swap is a contained change with a rebuild from events.
