# Software architecture

**Status:** Proposed for steering-group approval · **Version:** 1.0 · **Date:** September 2026
**Source requirements:** Modular IT Ticketing Platform — Build Specification v2.0

This folder defines the complete software architecture for the browser-first, omnichannel IT service-management platform. It is written so that the platform squad can start Phase 1 (PH-1 Foundation) from it without a further design phase, and so that later phases add modules without changing the foundations.

## Reading guide

| # | Document | Read this if you need to know… | Primary audience |
|---|---|---|---|
| 01 | [Overview](01-overview.md) | The goals, constraints, principles and the architecture on one page. | Everyone |
| 02 | [System context](02-system-context.md) | Who uses the platform and which external systems it talks to (C4 level 1). | Product, engineering |
| 03 | [Runtime topology](03-runtime-topology.md) | The deployable units, hosting layout, request and event paths, scaling model (C4 level 2). | Engineering, SRE |
| 04 | [Module architecture](04-module-architecture.md) | The 24 domain modules, their boundaries, manifests and dependency rules (C4 level 3). | Engineering |
| 05 | [Platform primitives](05-platform-primitives.md) | The shared building blocks every module uses: tenant context, permissions, event bus, jobs, audit, settings, telemetry. | Engineering |
| 06 | [Data architecture](06-data-architecture.md) | PostgreSQL design, row-level security, Prisma conventions, analytics, search, vectors, object storage, Redis, migrations, retention. | Engineering, data |
| 07 | [Eventing and integration](07-eventing-and-integration.md) | Outbox/inbox eventing, fan-out, replay, webhooks, the integration gateway and the channel-adapter pattern. | Engineering, integrations |
| 08 | [API architecture](08-api-architecture.md) | Edge, request lifecycle, contracts, OpenAPI, versioning, idempotency, errors, realtime, SDK. | Engineering, partners |
| 09 | [Identity and security](09-identity-and-security.md) | Keycloak topology, authentication flows, authorisation model, isolation layers, audit chain, privacy, threat model. | Engineering, security |
| 10 | [Tenancy](10-tenancy.md) | Tenant hierarchy, resolution, configuration inheritance, provisioning, deletion, region pinning, plans and flags. | Engineering, platform ops |
| 11 | [Workflow and rules engine](11-workflow-and-rules-engine.md) | The shared expression language, business rules, and the durable workflow interpreter. | Engineering |
| 12 | [SLA timer engine](12-sla-timer-engine.md) | Business-time arithmetic, timer rows, the partitioned minute scheduler, pause/resume, escalation. | Engineering |
| 13 | [AI architecture](13-ai-architecture.md) | The governed AI service: provider gateway, prompt registry, permission-aware RAG, evaluation, budgets, kill switch, actions. | Engineering, AI, security |
| 14 | [Experience architecture](14-experience-architecture.md) | Next.js apps, design system, PWA, Expo mobile, offline, realtime, localisation, accessibility. | Front-end, mobile, design |
| 15 | [Observability and operations](15-observability-and-operations.md) | Telemetry, SLIs/SLOs, alerting, runbooks, backups, disaster recovery, cost attribution. | SRE, engineering |
| 16 | [Deployment and delivery](16-deployment-and-delivery.md) | Railway and Cloudflare layout, environments, CI/CD, migrations in deployment, release and rollback, portability. | SRE, engineering |
| 17 | [Evolution and extraction](17-evolution-and-extraction.md) | How the modular monolith becomes services when measurement justifies it; multi-region; partner platform readiness. | Tech leads |
| 18 | [Quality attributes](18-quality-attributes.md) | Every non-functional requirement mapped to the mechanism that meets it and the test that proves it. | QA, engineering |
| 19 | [Risks and decisions](19-risks-and-decisions.md) | Architecture risks, the specification's open decisions with recommendations, and assumptions. | Steering group |
| 20 | [Phase 1 readiness and delivery record](20-phase-1-readiness.md) | What PH-1 builds, in what order, the entry-criteria checklist and the readiness statement. | Steering group, platform squad |
| 21 | [Phase 2 readiness and delivery record](21-phase-2-readiness.md) | What PH-2 has built and verified, what remains, the traps it found, and the one decision it leaves open. | Steering group, platform squad |

Decisions are recorded in [`../adr`](../adr/README.md). Where a document says "see ADR-nnnn" the ADR is authoritative.

## Conventions used in these documents

- Identifiers from the specification are used unchanged: modules `MOD-nn`, epics `MOD-nn-Ex`, phases `PH-n`, open decisions `OD-nn`. The specification's early decisions `ADR-01…ADR-10` are recorded here as `ADR-0001…ADR-0010`.
- Diagrams are Mermaid and render on GitHub. Each diagram is followed by the text it depicts, so the documents are usable without rendering.
- "Must" marks a rule enforced by lint, test or the release gate. "Should" marks the default that a reviewer may waive with a recorded reason.
- Phase markers such as *(PH-3)* show when a mechanism is first needed. Everything without a marker is part of PH-1.
