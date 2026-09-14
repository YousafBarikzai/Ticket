# ADR-0020 · Identifiers: application-generated UUID v7 primary keys and transactional per-type human numbers

**Status:** Proposed · **Date:** 2026-09 · **Specification reference:** §5 (UUID v7), §7 Identifiers, MOD-04-E1-S1

## Context

Records need globally unique, non-guessable, index-friendly identifiers, plus human-readable numbers (`INC-000123`) that are unique per tenant and type with no gaps or duplicates under load.

## Decision

- `id` is a UUID v7 generated in the application (`ids.new()`), giving time ordering and B-tree locality without exposing sequence counts.
- Human numbers come from a `ticket_counter (tenant_id, type, next)` row incremented with `UPDATE … RETURNING` **inside the creating transaction**, so rollbacks leave no gaps and concurrency serialises briefly per tenant and type. Other numbered aggregates (changes, problems, knowledge articles) reuse the same primitive.
- Routes accept `id` or `number` where unambiguous; imported records keep their original numbers in `external_ref`.

## Alternatives considered

- **Database-generated UUID v4.** Rejected: random keys fragment indexes at volume.
- **PostgreSQL sequences per type.** Rejected: sequences are non-transactional and leave gaps on rollback; per-tenant sequences would be operationally awkward.
- **Integer primary keys with tenant scoping.** Rejected: enumerable across tenants; merge/import complications.

## Consequences

- Slight write contention on the counter row per tenant/type, acceptable at target volumes (validated by the 1 000-ticket load test).
- UUID v7 requires Node 22's `crypto` or a small library; the contracts package exposes a validator.
