# 15 · Observability and operations

## 1. Telemetry pipeline (ADR-0007)

```
api / worker / keycloak / next.js  --OTLP-->  otel-collector  --->  Grafana Cloud (EU): Tempo (traces), Loki (logs), Mimir (metrics)
                                                  |-------------->  Sentry (EU): errors, releases, performance
                                                  |-------------->  (optional) Langfuse: AI traces (PH-4)
```

- OpenTelemetry SDK in every Node process with auto-instrumentation (HTTP, Fastify, Prisma, BullMQ, ioredis, undici) and manual spans for use cases, handlers, workflow steps and provider calls.
- Resource attributes: `service.name` (`api`, `worker-events`, …), `service.version` (git SHA), `deployment.environment`, `cloud.region`.
- Span and log attributes: `tenant.id`, `correlation.id`, `causation.id`, `actor.type`, `module.id`, `route`, `job.name`, `event.type`, `consumer`.
- The collector redacts attributes listed by the classification registry and drops request/response bodies; sampling: 100 % of errors and slow spans, 10 % of normal traffic in production (tail-based).
- Correlation ID propagation: HTTP header → async local storage → job payload → event envelope → outbound HTTP header → notification provider metadata, so one trace spans API → queue → worker → external call.
- Grafana Cloud EU and Sentry EU keep telemetry in the EEA; both are behind interfaces (OTLP exporters) and can be replaced by a self-hosted Grafana stack on Railway if required.

## 2. Service level indicators and objectives

| SLI | Measurement | SLO | Alert |
|---|---|---|---|
| API availability | Non-5xx responses / total at the edge and origin | 99.9 % monthly | Burn rate 2 h/6 h windows |
| API latency | p95 per route group (`tickets.list`, `tickets.create`, `search`, `dashboards`) | list < 300 ms, read < 150 ms, search < 200 ms, dashboard < 1.5 s | p95 over threshold 10 min |
| Outbox lag | `now − min(created_at)` unpublished | p95 < 5 s | > 30 s |
| Handler backlog | Oldest waiting job age per consumer queue | < 60 s | > 5 min |
| SLA timer lateness | `processed_at − due_at` for warnings/breaches | < 60 s | > 60 s for 5 min |
| Notification hand-off | Event `occurred_at` → provider accept | email p95 < 30 s, push < 10 s | > 2 min |
| Search freshness | Event `occurred_at` → index upsert | < 5 s | > 30 s |
| Webhook delivery success | Delivered / attempted (first 24 h) | > 99 % | < 95 % 1 h |
| Connector health *(PH-4)* | Health checks passing | 100 % | Any failing 15 min |
| AI latency and cost *(PH-4)* | Suggestion p95; spend vs budget | < 4 s; within budget | > 8 s; 80 % budget |
| Dead-letter growth | New DLQ items per hour | 0 | > 0 |
| Backup success | Daily base backup and WAL archive | 100 % | Any failure |
| Certificate expiry | Days remaining | > 14 | < 14 |

An error-budget policy is agreed with the steering group: when a phase's budget is exhausted, feature work pauses for reliability work.

## 3. Dashboards

- **Platform health** (SRE): golden signals per service, queue depths, database (connections, locks, replication lag, autovacuum), Redis memory, outbox lag, DLQ.
- **Domain SLIs** (engineering): timer lateness, notification hand-off, search freshness, webhook success, workflow step latency, AI latency/cost.
- **Per-tenant view** (support): request rate, error rate, latency, queue backlog and job failures filtered by `tenant.id`.
- **Product analytics** (PM, MOD-12): journey funnels and adoption from the analytics events.

## 4. Alerting and on-call

- Alerts route to the platform on-call schedule. MOD-20 holds the rotation definition from PH-4 and answers "who is on call at this instant?" for any instant; the paging itself stays with Grafana OnCall/PagerDuty, driven from the same definition.
- Every alert links to a runbook; alert definitions live in `infra/alerts/*.yaml` and are applied by CI.
- Severity model: **P1** (customer-facing outage or data risk: page immediately), **P2** (SLO burn, DLQ growth: page in hours), **P3** (capacity, expiry: next business day).

## 5. Runbooks (in `docs/runbooks/`, created in PH-1)

Deploy and rollback · database failover and point-in-time restore · queue replay and outbox reconciliation · dead-letter triage and redelivery · provider outage (email, Slack, Teams, WhatsApp, telephony, AI) · compromised credentials and secret rotation · break-glass access · tenant export and delete · AI kill switch *(PH-4)* · rate-limit tuning · certificate renewal · Keycloak realm restore · search and analytics rebuild · scaling a worker family · incident response for the platform itself (using the product's own major-incident mode once available).

## 6. Backups and disaster recovery

| Component | Backup | RPO | RTO | Test |
|---|---|---|---|---|
| PostgreSQL `platform` | Continuous WAL archiving + daily base backups; 30-day retention; PITR | ≤ 15 min | ≤ 4 h | Restore rehearsal every phase; DR test in PH-4 into a second region |
| PostgreSQL `keycloak` | Same | ≤ 15 min | ≤ 4 h | With the platform database |
| Redis | Not backed up (rebuildable) | n/a | Minutes | Reconciliation re-creates jobs |
| Object storage | Versioning; cross-region replication *(PH-4 option)* | ≤ 15 min | Hours | Restore a sample per phase |
| Configuration | Config packages exported nightly per tenant to object storage | 24 h | Minutes | Import test per phase |
| Realm | `realm.json` export nightly | 24 h | Minutes | Restore test per phase |

Recovery order: database → outbox reconciliation and replay → projections rebuild (search, analytics) if stale → delayed-job rehydration (timers, workflow waits) → smoke tests → status-page update. **Graceful degradation** *(PH-4)*: a global read-only flag switches the API to serve reads from the replica with a status banner when the primary is unavailable.

## 7. Capacity and cost

- Capacity assumptions for PH-2 pilot: 1 organisation, ≤ 200 agents, ≤ 5 000 tickets/month, ≤ 1 000 inbound emails/day, 20 000 timers active. PH-3 target: 5 organisations, 50 000 tickets/month, 1 M active timers across tenants (scheduler tested at this level).
- Per-tenant cost attribution from usage meters (MOD-21, PH-4): compute share by request and job counts, storage bytes, AI spend, notification counts; reported monthly.
- Load tests (k6) at phase gates use the seeded 1 M-ticket data set for list/create/search/dashboard and a synthetic timer set for the scheduler.

## 8. Logging standards

- JSON logs to stdout; Railway ships them to the collector; levels `error|warn|info|debug`; `debug` off in production.
- Never log tokens, secrets, request bodies or classified fields; the logger's redaction list is generated from the classification registry and a fixed pattern set (JWTs, API keys, emails when classified personal).
- Slow query logging (> 500 ms) with tenant and route; Prisma query events sampled in production.
- Audit events are not logs and never leave PostgreSQL except via signed exports.
