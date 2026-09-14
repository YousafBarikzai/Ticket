# Architecture Decision Records

An ADR records one architecturally significant decision: the context, the decision, the alternatives considered and the consequences. ADRs are immutable once **Accepted**; a change is a new ADR that **Supersedes** the old one.

## Process

1. Propose: copy `template.md` to `NNNN-short-title.md` (next number), status *Proposed*, open a pull request that also updates the affected `docs/architecture` documents.
2. Review: the owning squad's tech lead plus one reviewer from each squad the decision affects; security champion for anything touching identity, data or tenancy.
3. Accept: the steering group (or tech lead for module-internal decisions) marks it *Accepted* with the date. PH-1 exit criteria require ADR-0001…0012 to be accepted.
4. Supersede: a later ADR sets the old one to *Superseded by ADR-NNNN*.

## Index

| ADR | Title | Status | Spec ref |
|---|---|---|---|
| [0001](0001-deployment-topology-modular-monolith.md) | Deployment topology: modular monolith with service-ready modules | Proposed | ADR-01 |
| [0002](0002-reliable-eventing-outbox-inbox.md) | Reliable eventing: transactional outbox and consumer inbox | Proposed | ADR-02 |
| [0003](0003-source-of-truth-postgresql.md) | Source of truth: PostgreSQL; projections are rebuildable | Proposed | ADR-03 |
| [0004](0004-tenancy-shared-schema-rls.md) | Tenancy: shared schema, RLS plus tenant-aware client | Proposed | ADR-04 |
| [0005](0005-design-system-shared-tokens.md) | One design system with shared tokens for web and native | Proposed | ADR-05 |
| [0006](0006-ai-governed-service.md) | AI as a governed capability service | Proposed | ADR-06 |
| [0007](0007-telemetry-opentelemetry.md) | Telemetry: OpenTelemetry end to end | Proposed | ADR-07 |
| [0008](0008-api-style-rest-openapi.md) | API style: REST, URL-versioned, OpenAPI from Zod | Proposed | ADR-08 |
| [0009](0009-workflow-execution-interpreted-json.md) | Workflow execution: interpreted JSON with persisted state | Proposed | ADR-09 |
| [0010](0010-mobile-react-native-expo.md) | Mobile: one Expo codebase, iOS first; PWAs from Next.js | Proposed | ADR-10 |
| [0011](0011-identity-broker-keycloak.md) | Identity broker: self-hosted Keycloak with Organizations per tenant | Proposed (OD-01 closed) | OD-01 |
| [0012](0012-hosting-railway-cloudflare-residency.md) | Hosting: Railway + Cloudflare; residency stance | Proposed (D-01 open) | §4.2 |
| [0013](0013-authorisation-rbac-scoped-assignments.md) | Authorisation: RBAC with scoped assignments, checks in the service layer | Proposed | §7, App. B |
| [0014](0014-audit-trail-hash-chain.md) | Audit trail: in-transaction, append-only, hash-chained per tenant | Proposed | MOD-15 |
| [0015](0015-realtime-server-sent-events.md) | Realtime: server-sent events over Redis pub/sub | Proposed | MOD-04 NFR |
| [0016](0016-attachments-presigned-object-storage.md) | Attachments: presigned uploads to object storage, scan before visibility | Proposed | §4.2 |
| [0017](0017-search-postgres-fts-then-meilisearch.md) | Search: PostgreSQL full-text first, Meilisearch from PH-3 | Proposed (OD-02) | §4.2 |
| [0018](0018-settings-flags-versioned-definitions.md) | Settings, flags and versioned definitions as one framework | Proposed | MOD-13 |
| [0019](0019-monorepo-pnpm-turborepo.md) | Monorepo: pnpm workspaces + Turborepo; modules as packages | Proposed | §4.3 |
| [0020](0020-identifiers-uuidv7-and-numbering.md) | Identifiers: UUID v7 ids and transactional per-type numbering | Proposed | §7 |

## Template

See [`template.md`](template.md).
