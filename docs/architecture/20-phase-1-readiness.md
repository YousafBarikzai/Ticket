# 20 · Phase 1 readiness

## 1. What PH-1 builds (walking skeleton)

PH-1 ends with the specification's walking skeleton: **create tenant → SSO login → create ticket via API and a minimal form → comment → audit event visible → email and in-app notification delivered → trace visible**, plus the isolation suite, the pipeline and the design system. The architecture fixes the following for PH-1 so that squads can work in parallel from PH-2.

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
