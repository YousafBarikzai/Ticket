# Architecture Decision Records

An ADR records one architecturally significant decision: the context, the decision, the alternatives considered and the consequences. ADRs are immutable once **Accepted**; a change is a new ADR that **Supersedes** the old one.

## Process

1. Propose: copy `template.md` to `NNNN-short-title.md` (next number), status *Proposed*, open a pull request that also updates the affected `docs/architecture` documents.
2. Review: the owning squad's tech lead plus one reviewer from each squad the decision affects; security champion for anything touching identity, data or tenancy.
3. Accept: the steering group (or tech lead for module-internal decisions) marks it *Accepted* with the date. ADR-0001…0020 were accepted on 2026-09-14 when Phase 1 was authorised.
4. Supersede: a later ADR sets the old one to *Superseded by ADR-NNNN*.

## Index

| ADR | Title | Status | Spec ref |
|---|---|---|---|
| [0001](0001-deployment-topology-modular-monolith.md) | Deployment topology: modular monolith with service-ready modules | Accepted | ADR-01 |
| [0002](0002-reliable-eventing-outbox-inbox.md) | Reliable eventing: transactional outbox and consumer inbox | Accepted | ADR-02 |
| [0003](0003-source-of-truth-postgresql.md) | Source of truth: PostgreSQL; projections are rebuildable | Accepted | ADR-03 |
| [0004](0004-tenancy-shared-schema-rls.md) | Tenancy: shared schema, RLS plus tenant-aware client | Accepted | ADR-04 |
| [0005](0005-design-system-shared-tokens.md) | One design system with shared tokens for web and native | Accepted | ADR-05 |
| [0006](0006-ai-governed-service.md) | AI as a governed capability service | Accepted | ADR-06 |
| [0007](0007-telemetry-opentelemetry.md) | Telemetry: OpenTelemetry end to end | Accepted | ADR-07 |
| [0008](0008-api-style-rest-openapi.md) | API style: REST, URL-versioned, OpenAPI from Zod | Accepted | ADR-08 |
| [0009](0009-workflow-execution-interpreted-json.md) | Workflow execution: interpreted JSON with persisted state | Accepted | ADR-09 |
| [0010](0010-mobile-react-native-expo.md) | Mobile: one Expo codebase, iOS first; PWAs from Next.js | Accepted | ADR-10 |
| [0011](0011-identity-broker-keycloak.md) | Identity broker: self-hosted Keycloak with Organizations per tenant | Accepted | OD-01 |
| [0012](0012-hosting-railway-cloudflare-residency.md) | Hosting: Railway + Cloudflare; residency stance | Accepted | §4.2 |
| [0013](0013-authorisation-rbac-scoped-assignments.md) | Authorisation: RBAC with scoped assignments, checks in the service layer | Accepted | §7, App. B |
| [0014](0014-audit-trail-hash-chain.md) | Audit trail: in-transaction, append-only, hash-chained per tenant | Accepted | MOD-15 |
| [0015](0015-realtime-server-sent-events.md) | Realtime: server-sent events over Redis pub/sub | Accepted | MOD-04 NFR |
| [0016](0016-attachments-presigned-object-storage.md) | Attachments: presigned uploads to object storage, scan before visibility | Accepted | §4.2 |
| [0017](0017-search-postgres-fts-then-meilisearch.md) | Search: PostgreSQL full-text first, Meilisearch from PH-3 | Accepted | §4.2 |
| [0018](0018-settings-flags-versioned-definitions.md) | Settings, flags and versioned definitions as one framework | Accepted | MOD-13 |
| [0019](0019-monorepo-pnpm-turborepo.md) | Monorepo: pnpm workspaces + Turborepo; modules as packages | Accepted | §4.3 |
| [0020](0020-identifiers-uuidv7-and-numbering.md) | Identifiers: UUID v7 ids and transactional per-type numbering | Accepted | §7 |
| [0021](0021-expression-language-strict-ordering.md) | Expression language: ordering across types raises, and is refused at publish | Accepted | MOD-06, MOD-02 |
| [0022](0022-email-providers-per-tenant.md) | Email: Postmark and Microsoft Graph, chosen per tenant | Accepted | MOD-03, OD-03 |
| [0023](0023-integration-gateway-single-egress.md) | The integration gateway is the only way out | Accepted | MOD-14-E3, MOD-06-E2 |
| [0024](0024-rotas-computed-not-stored.md) | Rotas, turns and shifts are computed from a definition, never stored as a cursor | Accepted | MOD-20 |

## Template

See [`template.md`](template.md).
