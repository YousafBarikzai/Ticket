# ADR-0015 · Realtime updates via server-sent events backed by Redis pub/sub

**Status:** Proposed · **Date:** 2026-09 · **Specification reference:** MOD-02-E1-S2, MOD-04 NFR (timeline updates within 2 s)

## Context

Workbench and portal need live timeline and queue updates; mobile needs updates when foregrounded. Traffic is one-directional (server → client); payloads must respect permissions.

## Decision

`GET /api/v1/events/stream` provides an SSE stream per client with topic subscriptions (ticket, inbox, saved view). API instances relay notices from Redis pub/sub channels scoped by tenant; services publish small "changed" notices after commit; clients refetch via the REST API so no permission-sensitive payload travels over the stream. Heartbeats, `Last-Event-ID` resume from a short Redis ring buffer, and per-user connection limits are included. The `realtime.publish` interface allows a later WebSocket or dedicated realtime service.

## Alternatives considered

- **WebSockets.** Not needed for one-directional updates; more infrastructure concerns (sticky sessions, proxies).
- **Polling.** Rejected: 2 s target with many open tabs would load the API unnecessarily.
- **Third-party realtime service.** Rejected for tenancy and cost reasons at this stage.

## Consequences

- Simple to operate behind Cloudflare (SSE is plain HTTP); works with multiple API replicas.
- Redis pub/sub is fire-and-forget; the resume buffer covers short disconnects and clients refetch on reconnect.
