# ADR-0004 · Tenancy: shared database, shared schema, row-level security plus a tenant-aware client

**Status:** Accepted 2026-09-14 · **Date:** 2026-09 · **Specification reference:** ADR-04

## Context

The same codebase must serve single organisations, groups with subsidiaries and MSPs. Cross-tenant leakage is the critical risk (R-02). Operating a database per tenant does not fit a small team or self-service provisioning.

## Decision

- One database, one schema; `tenant_id NOT NULL` on every tenant-scoped table.
- PostgreSQL row-level security **enabled and forced** on every tenant-scoped table with policies on `current_setting('app.tenant_id')`, set per transaction with `SET LOCAL` by the data client. The application role cannot bypass or disable RLS.
- A Prisma client extension injects `tenant_id` into every query and refuses to run without a `TenantContext`.
- Redis keys, object-storage paths, search indexes and job IDs are prefixed with the tenant ID.
- Organisation-level visibility is enforced by permission scopes in application code, not RLS, so cross-organisation roles work.
- MSP cross-tenant access uses an explicit, audited `tenant_grant` checked in the permission layer; never an RLS bypass.
- A tenant-isolation test suite (Appendix D) runs on every pull request and is release-blocking.

## Alternatives considered

- **Schema per tenant.** Rejected: migrations and connection management scale poorly; harder to run cross-tenant platform jobs.
- **Database per tenant.** Rejected: cost and operations at MSP scale; provisioning time.
- **Application scoping only.** Rejected: a single missed predicate is a data breach; RLS is the second layer.

## Consequences

- Two independent layers must both fail for leakage to occur; tests prove each.
- Requires `SET LOCAL` discipline (transaction-mode pooling only) and a small overhead per transaction.
- Very large tenants can be moved to their own cell later (multi-region design) without changing the schema.
