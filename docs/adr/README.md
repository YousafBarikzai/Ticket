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
| [0025](0025-major-incident-closed-by-its-review.md) | A major incident is closed by its review, not by a status change | Accepted | MOD-08-E1 |
| [0026](0026-change-control-enforced-or-honest.md) | Change control is enforced where it can be and honest where it cannot | Accepted | MOD-08-E3 |
| [0027](0027-two-registers-and-a-bounded-graph.md) | Two registers, and a graph that is bounded, typed and never guessed | Accepted | MOD-10-E1 |
| [0028](0028-discovery-proposes-a-person-confirms.md) | Discovery proposes; a person confirms | Accepted | MOD-10-E2 |
| [0029](0029-request-signing-belongs-in-the-gateway.md) | Request signing belongs in the gateway, and both halves of a credential travel together | Accepted | MOD-14-E3, MOD-10-E2 |
| [0030](0030-chat-identity-has-a-middle-state.md) | Chat identity has a middle state, and it buys exactly one thing | Accepted | MOD-03 |
| [0031](0031-reporting-projects-events-and-is-rebuilt.md) | Reporting is a projection of events, and it is rebuilt rather than trusted | Accepted | MOD-12 |
| [0032](0032-a-metric-is-a-structured-query.md) | A metric is a structured query, not an expression | Accepted | MOD-12 |
| [0033](0033-a-survey-is-a-form-with-a-score.md) | A survey is a form with a score, asked once, where the person already is | Accepted | MOD-18 |
| [0034](0034-three-kinds-of-time-and-one-of-them-is-free.md) | Three kinds of time, and one of them is free | Accepted | MOD-19 |
| [0035](0035-the-status-page-is-a-statement-not-a-view.md) | The status page is a statement, not a view | Accepted | MOD-23 |
| [0036](0036-an-import-is-not-a-creation.md) | An import is not a creation | Accepted | MOD-24 |
| [0037](0037-the-provider-owns-the-people-the-tenant-owns-the-access.md) | The provider owns the people; the tenant owns the access | Accepted | MOD-01 |
| [0038](0038-a-limit-is-a-cached-verdict-never-a-count.md) | A limit is a cached verdict, never a count | Accepted | MOD-21 |
| [0039](0039-a-pack-is-a-copy-not-a-connection.md) | A pack is a copy, not a connection | Accepted | MOD-22 |
| [0040](0040-the-provider-is-a-socket-and-the-governance-is-the-product.md) | The provider is a socket, and the governance is the product | Accepted | MOD-09, OD-04 |
| [0041](0041-the-browser-holds-a-cookie-and-nothing-else.md) | The browser holds a cookie and nothing else | Accepted | MOD-16, MOD-04 |
| [0042](0042-a-model-with-no-price-is-not-called.md) | A model with no price is not called | Accepted | MOD-09, OD-04 |
| [0043](0043-only-additive-work-may-wait.md) | Only additive work may wait | Accepted | MOD-16, doc 14 §5 |
| [0044](0044-a-revocation-that-is-not-written-is-not-a-revocation.md) | A revocation that is not written is not a revocation | Accepted | MOD-01, doc 08 §9, doc 09 §2 |
| [0045](0045-a-notice-is-a-nudge-and-a-topic-is-a-permission.md) | A notice is a nudge, and a topic is a permission | Accepted | MOD-16, MOD-04, doc 08 §6, ADR-0015 |
| [0046](0046-a-second-reader-that-has-memorised-wcag.md) | A second reader that has memorised WCAG | Accepted | MOD-16-E1, doc 14 §4, doc 18 |
| [0047](0047-four-decisions-and-the-shape-they-leave.md) | Four decisions, and the shape they leave | Accepted | MOD-21, MOD-19, MOD-09, doc 19 |
| [0048](0048-a-custom-field-is-a-contract-not-a-bag.md) | A custom field is a contract, not a bag | Accepted | MOD-04, MOD-02, MOD-13 |
| [0049](0049-one-console-two-audiences-and-the-gate-between-them.md) | One console, two audiences, and the gate between them | Accepted | MOD-13, MOD-01, MOD-04 |
| [0050](0050-a-pipeline-that-runs-before-it-can-deploy.md) | A pipeline that runs before it can deploy | Accepted | OD-06, doc 16 |

## Template

See [`template.md`](template.md).
