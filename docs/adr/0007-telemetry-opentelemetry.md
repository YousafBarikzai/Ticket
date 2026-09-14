# ADR-0007 · Telemetry: OpenTelemetry end to end with correlation and tenant on everything

**Status:** Accepted 2026-09-14 · **Date:** 2026-09 · **Specification reference:** ADR-07

## Context

Journeys span edge → API → queue → worker → external provider. Support and SRE need to follow one request across all of them and per tenant.

## Decision

OpenTelemetry SDK in every Node process with auto-instrumentation and manual spans; an OpenTelemetry Collector that redacts and exports to Grafana Cloud (EU) and Sentry (EU); correlation ID and tenant ID propagated through async local storage, job payloads and event envelopes and stamped on every span and log; domain SLIs (outbox lag, timer lateness, notification hand-off, search freshness, AI latency/cost) as first-class metrics; product-analytics events for the core journeys sent through the API to MOD-12.

## Alternatives considered

- **Vendor SDK (Datadog, New Relic).** Rejected: lock-in; OTLP keeps the exporter swappable.
- **Self-hosted Grafana stack on Railway from PH-1.** Deferred: hosted EU stack reduces PH-1 operations; the exporter target is configuration.

## Consequences

- Telemetry cost controlled with tail-based sampling.
- Audit events stay in PostgreSQL and are never exported as logs.
