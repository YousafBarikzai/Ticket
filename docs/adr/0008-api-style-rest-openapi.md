# ADR-0008 · API style: REST + JSON, URL-versioned, OpenAPI generated from Zod contracts

**Status:** Accepted 2026-09-14 · **Date:** 2026-09 · **Specification reference:** ADR-08

## Context

Web, mobile, channel adapters, partners and the SDK all consume the same API; contracts must be typed end to end and breaking changes controlled.

## Decision

REST with JSON under `/api/v1`; routes declared once in `packages/contracts` with Zod schemas and metadata; Fastify validates requests and responses from the same schemas; OpenAPI 3.1 is generated at build time and diffed in CI; the TypeScript SDK and Postman collection are generated from it. Standards from specification Part 7 are binding (cursor pagination, filter grammar, `fields`/`expand`, idempotency keys, `If-Match`, RFC 9457 errors, per-tenant/token rate limits, bulk as jobs, signed webhooks). GraphQL is deferred to PH-5 for read-heavy experiences only. Realtime uses SSE (ADR-0015).

## Alternatives considered

- **GraphQL-first.** Rejected: mutation semantics, caching, rate limiting and partner tooling are simpler with REST; read-side GraphQL can be added later.
- **tRPC for internal apps.** Rejected: the specification forbids private back doors; one API for all clients.

## Consequences

- Contract-first workflow: a story starts with a contracts change.
- Some verbosity (composed endpoints for mobile) accepted in exchange for a single, documented surface.
