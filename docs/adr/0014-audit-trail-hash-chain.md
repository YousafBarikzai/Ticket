# ADR-0014 · Audit trail: written in the change's transaction, append-only, hash-chained per tenant

**Status:** Proposed · **Date:** 2026-09 · **Specification reference:** MOD-15-E1-S1, module contract rules

## Context

Auditors must be able to prove what happened; the audit trail must be complete (every material change), tamper-evident and cheap enough to write on every transaction.

## Decision

`audit.record(tx, ctx, …)` inserts an `audit_event` row in the **same transaction** as the change and the outbox event. Rows store actor (type, id, on-behalf-of), action, target, redacted before/after, correlation ID, IP and user agent, plus `hash` and `prev_hash` computed per tenant under a short advisory lock. The application role has no UPDATE/DELETE on the table; the table is partitioned monthly; a nightly job verifies each tenant's chain and raises a security alert on a break; exports carry a signed manifest. Audit events are not logs and are never exported to telemetry.

## Alternatives considered

- **Audit from the event stream asynchronously.** Rejected: a gap between change and audit; audit must be transactional.
- **Database triggers.** Rejected: cannot capture actor, reason and correlation reliably; harder to redact by classification.
- **External immutable ledger.** Unnecessary; hash chain plus signed exports meet the requirement.

## Consequences

- < 5 ms per transaction (single insert); the per-tenant lock serialises audit inserts briefly, acceptable at target volumes.
- Every mutating service method must call the writer; verified by an integration-test convention.
