# ADR-0002 · Reliable eventing: transactional outbox and consumer inbox

**Status:** Accepted 2026-09-14 · **Date:** 2026-09 · **Specification reference:** ADR-02

## Context

Every material state change must publish a domain event that other modules, projections, notifications and webhooks consume, without losing events or processing them twice, and events must survive queue (Redis) loss.

## Decision

- Events are written to an `outbox_event` table **in the same transaction** as the domain change and its audit event.
- A leader-elected publisher worker moves events from the outbox to BullMQ, one job per subscribed consumer, deduplicated by `jobId = consumer:eventId`.
- Every consumer claims the event in an `inbox_event (consumer, event_id)` table inside its own transaction before doing work; duplicates are no-ops.
- A reconciler re-enqueues published events not acknowledged by required consumers, making Redis loss survivable; a replay CLI re-delivers events by type, range and consumer for rebuilds.
- Handlers are order-tolerant; strict per-aggregate ordering is achieved with short per-aggregate locks where required.

## Alternatives considered

- **Publish directly to Redis/queue after commit.** Rejected: dual-write loses events on crash between commit and publish.
- **Change data capture (Debezium) from PostgreSQL WAL.** Rejected for PH-1: extra infrastructure; the outbox gives the same guarantee with SQL only. Possible later when NATS/Kafka is introduced.
- **Event sourcing as the primary model.** Rejected: the specification keeps the ticket record relational and authoritative; event-sourced timeline is a PH-5 differentiator built on the same outbox.

## Consequences

- Exactly-once *effects* (not deliveries) with modest code in `packages/platform`.
- Outbox and inbox tables grow quickly; partitioned monthly and archived.
- The publisher is a single point of throughput; measured by the outbox-lag SLI and scaled by batching and NOTIFY wake-ups.
