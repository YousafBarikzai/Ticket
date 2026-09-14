# ADR-0001 · Deployment topology: modular monolith with service-ready modules

**Status:** Proposed · **Date:** 2026-09 · **Specification reference:** ADR-01 · **Deciders:** tech lead, steering group

## Context

The platform has 24 functional modules, a small initial team (one platform squad in PH-1 growing to three or four squads by PH-4), and requirements for both fast delivery and enterprise scale. Micro-services from day one would multiply deployment, observability and consistency work before any user value; a conventional monolith would make later extraction a rewrite.

## Decision

Build a **modular monolith**: one API deployable (`apps/api`) and one worker deployable (`apps/worker`, run as four queue-family services) mounting the same `modules/*` packages, against one PostgreSQL database. Modules obey a strict contract (own tables, service interfaces, events, manifests; no cross-module table access) enforced by lint and tests, so that any module can later be deployed on its own with the same code. Extraction happens only when measured volume or team ownership justifies it (PH-5 gate), starting with channel adapters, notification dispatch and AI workers.

## Alternatives considered

- **Micro-services from PH-1.** Rejected: operational cost and distributed-transaction complexity too high for the team size; slows the walking skeleton.
- **Plain monolith without enforced boundaries.** Rejected: the specification requires extraction readiness and per-module ownership by squads.
- **Serverless functions.** Rejected: long-running workers (workflow, timers, scans), SSE and connection pooling fit poorly; cold starts affect p95 targets.

## Consequences

- One deploy, one database, simple local development; fast PH-1.
- Boundary discipline costs some convenience (no cross-module joins) and requires composed endpoints and read models.
- Worker families scale independently from PH-1, which captures most of the scaling benefit of services without the cost.
- Extraction procedure and gateway insertion point are documented in architecture document 17.
