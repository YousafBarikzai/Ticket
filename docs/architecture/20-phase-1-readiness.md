# 20 · Phase 1 readiness and delivery record

## 1. What PH-1 builds (walking skeleton)

PH-1 ends with the specification's walking skeleton: **create tenant → SSO login → create ticket via API and a minimal form → comment → audit event visible → email and in-app notification delivered → trace visible**, plus the isolation suite, the pipeline and the design system. The architecture fixes the following for PH-1 so that squads can work in parallel from PH-2.

> **Status: built and verified.** The walking skeleton runs green end to end
> (`pnpm skeleton`, 24 assertions) and the full suite is 286 tests across unit,
> integration, isolation and permission projects. Section 6 records what was
> delivered, what it cost and what remains.

| Area | Delivered in PH-1 | Architecture reference |
|---|---|---|
| Monorepo and toolchain (MOD-00-E1) | pnpm + Turborepo workspace; `apps/*`, `modules/*`, `packages/*`, `infra/*`; module generator; lint rules for boundaries; docker-compose; seed script | 04 §3, 16 §6, ADR-0019 |
| CI/CD (MOD-00-E2) | Seven-stage pipeline; preview environments; Railway environments; rollback demonstrated | 16 §3–4 |
| Tenant model (MOD-21-E1) | `tenant`, `organisation`, RLS roles and policies, tenant-aware client, context middleware, provisioning job, platform CLI, `region` | 06 §3–4, 10 |
| Authentication and sessions (MOD-01-E1) | Keycloak realm + Organizations, clients, mappers, JIT provisioning, session table and revocation, MFA policy check, break-glass | 09 §1 |
| Organisation structure and RBAC (MOD-01-E2) | Organisations, teams, locations, roles, permissions from manifests, scoped assignments, permission checker with cache, Appendix B seed | 05 §3, 09 §2 |
| Ticket schema and core API (MOD-04-E1) | Tables, counters, state machine, CRUD, transitions, comments, attachments via presigned upload, tasks, links, optimistic locking, audit and outbox in transaction. The malware-scan step (ClamAV, `scan` queue) is pulled forward from MOD-15-E2 because attachments are part of the PH-1 API; the scanning policy UI stays in PH-2 | 06, 08, ADR-0016 |
| Audit and security baseline (MOD-15-E1) | Audit writer and hash chain, insert-only role, secrets handling, security headers, scanning in CI; the classification *registry* (labels applied by serialisers, loggers and audit redaction) is pulled forward from MOD-15-E2 because the AI hooks and audit redaction depend on it (13 §7); classification administration UI stays in PH-2 | 05 §6, 09 §4–7 |
| Event bus and outbox (MOD-14-E1) | Outbox, publisher, fan-out, inbox, envelope, reconciler, replay CLI | 07 §1–2 |
| Notification engine (MOD-11-E1) | Rules from events, templates, in-app inbox, email channel via `EmailTransport`, delivery attempts and retries, user-preference skeleton | 07 §6, 04 (MOD-11) |
| Search infrastructure (MOD-09-E1) | `search_document`, indexer, permission-filtered query API | 06 §7 |
| Design system and shells (MOD-16-E1) | Tokens, 20 components, Storybook, a11y tests; Next.js shells with BFF auth and navigation | 14 |
| Basic admin console (MOD-13-E1) | Settings framework with versions and scopes, flags, module enable/disable from manifests, users/roles/orgs/teams screens | 05 §7, 10 §5 |
| Telemetry foundations (MOD-12-E1) | OpenTelemetry, structured logs, metrics, dashboards, product-analytics events | 15 |
| API foundations (MOD-14-E2) | OpenAPI from contracts, problem details, pagination, idempotency, rate limits, API keys, SDK, docs site | 08 |
| SLA timer engine (MOD-07-E0) | `business-time` package, timer rows, partitioned scheduler, pause/resume semantics, DST tests (policies and UI follow in PH-2). Note: the specification's PH-1 epic table omits this epic, but its module-by-phase matrix (MOD-07 PH-1 = "timer engine") and the MOD-07 epics table (E0 = PH-1) include it; treated as in scope and raised in 19 §4 | 12 |

## 2. Recommended build sequence (indicative, 10–12 weeks)

| Weeks | Focus | Exit check |
|---|---|---|
| 1–2 | OD-06 (domains); accounts (Railway, Cloudflare, GitHub, Grafana Cloud, Sentry, object storage, Postmark sandbox, test IdP); monorepo, toolchain, docker-compose, CI stages 1–3; Keycloak Organizations and data-layer/RLS spikes (AR-02, AR-04). D-01 closed as option A before the phase started | `pnpm dev` runs; CI green on an empty module; spike reports |
| 3–4 | Tenant model, RLS, tenant-aware client, provisioning CLI; Keycloak realm as code; auth plugin, sessions, JIT; platform primitives (context, audit, settings, flags, telemetry) | Isolation suite skeleton passes; login works in preview |
| 5–6 | Ticket core schema and API; outbox/inbox and publisher; API foundations (contracts, OpenAPI, SDK); design tokens and first components | Create/read/update/list tickets via SDK with audit and outbox rows; OpenAPI published |
| 7–8 | Notification engine with email; search projection and indexer; timer engine and business-time; admin console basics; web shells with auth | Skeleton journey works in staging end to end |
| 9–10 | Load test (200 users, p95 < 300 ms); security baseline review; backup/restore rehearsal; runbooks; pipeline to production with rollback; ADR acceptance | PH-1 release gate checklist complete |
| 11–12 | Buffer: hardening, documentation, PH-2 manifests and contracts drafted (definition of ready for PH-2 stories) | Steering-group go/no-go |

## 3. Entry criteria checklist (from the specification, with status)

| Criterion | Status | Action |
|---|---|---|
| Stack decisions ADR-01 to ADR-10 accepted | ADR-0001…0012 accepted by the product owner on 2026-09-14 when Phase 1 was authorised; ADR-0013…0020 accepted with them | Done |
| Hosting accounts available | Railway, Cloudflare, GitHub, Grafana Cloud, Sentry, object storage, email sandbox | Product owner / SRE to provision (after D-01) |
| Identity-provider test tenant available | Needed for OIDC and SAML spikes (Entra ID test tenant and/or Okta developer org) | Product owner |
| Domain names available | Depends on OD-06 | Product owner |
| This document approved | Architecture v1.0 in this pull request | Steering group |

## 4. What the platform squad needs on day one

- Accepted decisions: D-01 (option A, closed), ADR-0001…0020. Still needed: OD-06 (or a placeholder domain).
- Access: GitHub organisation with branch protection and CODEOWNERS; Railway project with three environments; Cloudflare zone; observability accounts; a test identity provider tenant; an Apple Developer account request started (needed by PH-2).
- People: tech lead, 3–4 full-stack engineers, 1 DevOps/SRE, 1 designer, 1 PM; QA from week 4.

## 5. Readiness statement

The architecture is complete for its purpose: every PH-1 epic has a defined mechanism, every foundation the later phases rely on (tenancy, identity, eventing, audit, configuration model, expression language, engines, AI hooks, experience stack, operations, extraction path) is specified, and the specification's non-functional requirements are traced to mechanisms and tests. The only inputs still required before building are the D-01 residency choice and the accounts and identity-provider test tenant listed above; none of them changes the design.


## 6. Delivery record

Written at the end of the Phase 1 build, from the state of the repository rather than from the plan.

### 6.1 What was built

| Area | Delivered | Where |
|---|---|---|
| Monorepo and toolchain (MOD-00-E1) | pnpm workspaces, Turborepo, TypeScript strict, Vitest projects, Docker images, compose stack, seed, platform console | `package.json`, `infra/` |
| CI/CD (MOD-00-E2) | Stages 1–3: schema-drift check, module-contract check, typecheck, unit tests, secret scan, image build and scan, integration/isolation/permission suites against real PostgreSQL and Redis | `.github/workflows/ci.yml` |
| Tenant model (MOD-21-E1) | Tenant, organisation tree with materialised paths, four database roles, forced row-level security applied by a function that cannot skip a table, tenant-aware client, provisioning with resumable steps, region on every tenant | `modules/tenancy`, `prisma/migrations` |
| Authentication and sessions (MOD-01-E1) | Token verification against Keycloak's JWKS with a development signer, just-in-time provisioning, session records and revocation denylist, API keys | `apps/api/src/auth`, `modules/identity` |
| Organisations and RBAC (MOD-01-E2) | Permission registry from manifests, roles as (key, scope) pairs, scoped assignments, per-aggregate scope resolvers, cached resolution invalidated by events, Appendix B seeded as system roles | `packages/platform/src/authz.ts`, `modules/identity/src/seed/roles.ts` |
| Ticket schema and core API (MOD-04-E1) | Canonical state machine, per-tenant per-type numbering with no gaps, CRUD, transitions, comments, tasks, links, watchers, attachments by presigned upload, optimistic locking | `modules/ticket`, `apps/api/src/routes/tickets.ts` |
| Audit and security baseline (MOD-15-E1) | Audit written in the change's transaction, hash-chained per tenant, append-only by grant and by trigger, nightly verifier, classification registry, attachment scanning | `packages/platform/src/audit.ts`, `modules/security` |
| Event bus and outbox (MOD-14-E1) | Transactional outbox, leader-elected publisher, inbox claims, reconciler, replay, webhooks with signing and backoff | `modules/integrations` |
| Notification engine (MOD-11-E1) | Rules from events, audience resolution, template rendering, in-app inbox, email transport behind an interface, delivery attempts | `modules/notifications` |
| Search infrastructure (MOD-09-E1) | Projection with generated tsvector, indexer fed by events, retrieval filtered by permission before ranking | `modules/search` |
| Design system and shells (MOD-16-E1) | Tokens single-sourced to CSS and a React Native theme, 24 accessible components, focus trap and roving tabindex, form renderer sharing the server's expression language, contrast audit over 192 pairings | `packages/ui` |
| Basic admin console (MOD-13-E1) | Settings framework with versions, scopes and rollback; feature flags; module enable/disable; admin activity log | `modules/admin` |
| Telemetry foundations (MOD-12-E1) | Structured logs with redaction, metrics with Prometheus exposition, OpenTelemetry when an endpoint is configured, correlation and tenant on every line | `packages/platform/src/telemetry.ts` |
| API foundations (MOD-14-E2) | Problem details, cursor pagination, idempotency keys, rate limits, `If-Match` concurrency, health and metrics endpoints, server-sent events | `apps/api` |
| SLA timer engine (MOD-07-E0) | Business-time library with daylight-saving and holiday handling, timer rows, partitioned minute scheduler, pause and resume, warnings and breaches | `packages/business-time`, `modules/sla` |

### 6.2 Verification

| Check | Result |
|---|---|
| Unit tests | 152 passing (expression language, business time, platform primitives, state machine, design system) |
| Integration, isolation and permission suites | 134 passing against real PostgreSQL and Redis |
| Walking skeleton | 24 assertions passing end to end against a live API and worker |
| Module contract | No violations; the checker is itself verified against a deliberate breach |
| Schema drift | The committed Prisma schema matches its module fragments |
| Row-level security | Forced on 55 tables; a query without tenant context returns nothing, a cross-tenant write is refused, the application role can neither disable it nor amend the audit trail |

### 6.3 Defects the build found

Each was fixed rather than worked around, and each has a test that would catch it again.

| Defect | Why it mattered |
|---|---|
| Tenant provisioning wrote a tenant-scoped table with no tenant context | Row-level security refused it, correctly; provisioning now runs inside the new tenant's context |
| The transaction proxy wrapped Prisma's internals as though they were model delegates | Broke the client in ways that surfaced far from the cause |
| The data client did not wrap operations in a tenant transaction | A read outside an explicit transaction silently returned nothing, which reads as missing data rather than a missing tenant |
| The outbox publisher read across tenants | Row-level security refused it, so no event was ever published; it now works tenant by tenant |
| BullMQ rejects a job id containing a colon | Every idempotency key was rejected, so the SLA tick never ran |
| A newly raised ticket with no group was invisible to every agent | Nobody could triage it; unrouted tickets now sit in their organisation's triage pool |
| Team scope let an agent read another team's tickets in the same organisation | Over-broad by default; now narrowed to the triage pool |
| PostgreSQL resets a transaction-local setting to an empty string, not null | The policy raised an invalid-uuid error instead of matching no rows: failing closed, but as an incident rather than a refusal |
| Listing users honoured the permission but not its scope | A requester could enumerate every person in the tenant |

### 6.4 Deviations from the architecture, and what remains

| Item | Status |
|---|---|
| Declarative monthly partitioning of `audit_event` and `outbox_event` | **Deferred.** Prisma cannot express partitioned tables, and hand-writing them would have split the schema's source of truth. The indexes carry current volumes; partitioning is a PH-2 migration with no application change. |
| ESLint with custom boundary rules | **Replaced.** The module contract is enforced by `pnpm lint:boundaries`, a dependency-free checker that runs in under a second and is itself tested against a deliberate violation. Formatting and style rules remain to add. |
| OpenAPI generation and the published SDK | **Partly done.** Route contracts and the `defineRoute` declaration exist; generating the document and the client from them is the remaining piece of MOD-14-E2. |
| Keycloak realm as code | **Interface done, realm pending.** Token verification against a JWKS is implemented and the development signer stands in; the realm export and the identity-provider spike need the test tenant named in the entry criteria. |
| Storybook stories and axe-core tests per component | **Deferred.** The contrast audit and keyboard tests cover the accessibility ground that matters most; Storybook is a PH-2 addition. |
| React Native component set | **Deferred to PH-2** with the iOS app. The shared theme is delivered. |
| Preview, staging and production deploys (pipeline stages 4–6) | **Pending accounts.** The stages are specified in `16 §3`; they need the Railway, Cloudflare and observability accounts from the entry criteria. |
