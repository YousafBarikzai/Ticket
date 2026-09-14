# 18 · Quality attributes and NFR traceability

Each non-functional requirement from the specification is mapped to the architectural mechanism that meets it and the verification that proves it. "Where" points to the document that describes the mechanism.

## 1. Performance

| Requirement (source) | Mechanism | Where | Verification |
|---|---|---|---|
| Ticket list p95 < 300 ms at 1 M tickets/tenant; read p95 < 150 ms (MOD-04) | Tenant-first composite indexes; cursor pagination; `fields`/`expand`; per-request context caching; read of one aggregate in one query | 06 §2.4, 08 §5 | k6 at phase gates on seeded 1 M data set |
| Search p95 < 200 ms; freshness < 5 s (MOD-09) | `search_document` projection with GIN; indexer consumer; Meilisearch from PH-3 | 06 §7 | k6 + freshness SLI |
| Permission check p99 < 5 ms from cache; invalidation < 5 s (MOD-01) | Redis PermissionSet cache; event-driven invalidation | 05 §3 | Unit benchmark; integration test measuring propagation |
| Login round trip < 2 s excluding IdP (MOD-01) | Keycloak with JWKS caching; JIT provisioning in one transaction | 09 §1 | Playwright timing in staging |
| Inbound message → ticket p95 < 10 s email, < 3 s chat (MOD-03) | Minimal synchronous webhook path; `channels:inbound` queue priority | 07 §5 | Load test: 1 000 emails, no duplicates |
| Workflow 500 steps/s per worker; scheduling latency p95 < 1 s (MOD-06) | One step per job; BullMQ; SERIALIZABLE claim | 11 §3 | Engine benchmark in CI (nightly) |
| Timer evaluation at 1 M active timers with < 60 s lateness (MOD-07) | 16 partitions, partial index on `(partition, due_at)`, tenant fan-out | 12 §4 | Synthetic timer load test at PH-3 gate |
| Event → email hand-off p95 < 30 s; push < 10 s; 50 notifications/s per worker (MOD-11) | Dedicated `worker-comms`; per-provider queues | 03 §4, 15 §2 | SLI dashboards; provider outage simulation |
| Dashboard load p95 < 1.5 s for one year (MOD-12) | Star schema on replica; pre-aggregated facts | 06 §6 | k6 |
| Outbox lag p95 < 5 s; webhook delivery p95 < 10 s (MOD-14) | Leader publisher with NOTIFY wake-up; separate webhook queue | 07 §2 | SLI alert; chaos test |
| Impact traversal < 1 s at 100 k CIs / 500 k relationships depth 3 (MOD-10) | Recursive CTE with depth bound and typed-edge indexes; cached per CI for 60 s *(PH-3)* | 06 §2.4 | Load test at PH-3 gate |
| Web bundles: portal < 250 kB, workbench < 500 kB gzipped; LCP < 2 s; mobile cold start < 2 s (MOD-16) | Server components, code splitting, Hermes | 14 §8 | Lighthouse CI; bundle-size check |
| Load test: 200 concurrent API users, p95 < 300 ms on list/create (PH-1 gate) | As above | 03, 06 | k6 in PH-1 gate |
| Attachment scan < 60 s for 25 MB (MOD-15) | ClamAV service on private network; `scan` queue | 03 §1 | Integration test with EICAR and large file |
| Audit write adds < 5 ms (MOD-15) | Single insert with advisory lock per tenant | 05 §6 | Micro-benchmark in integration suite |
| Tenant provisioning < 2 min (MOD-21) | Idempotent provisioning job | 10 §4 | Timed test in staging |

## 2. Reliability and resilience

| Requirement | Mechanism | Where | Verification |
|---|---|---|---|
| Zero data loss; durable before response (MOD-04) | Synchronous commit; outbox in transaction | 03 §3.1, 06 | Integration test asserting rows exist after 5xx injection |
| Exactly-once side effects across worker restarts (MOD-06, PH-3 gate) | Step markers + idempotency keys; inbox | 11 §3, 07 §2.3 | Chaos test: 100 kills |
| Redis restart survivable (MOD-06, MOD-14) | Outbox as source; reconciler; wait/timer rehydration | 07 §2.5, 05 §5 | Chaos test at PH-3 gate |
| API availability 99.9 % (MOD-14) | Stateless replicas; health checks; Cloudflare | 03, 15 §2 | SLO monitoring |
| RPO ≤ 15 min, RTO ≤ 4 h (MOD-15) | PITR; runbook; rehearsal | 15 §6 | Quarterly DR test from PH-4 |
| Graceful degradation (read-only mode) *(PH-4)* | Global flag; replica reads; banner | 03 §7 | Chaos test |
| Public status page available if API down (MOD-23) | Static build on Cloudflare | 03 §1 | Chaos test at PH-3 gate |
| Connector failures never corrupt tickets (Part 4) | Adapters write through services; inbox; error queues | 07 §4 | Contract tests with failure payloads |

## 3. Security and privacy

| Requirement | Mechanism | Where | Verification |
|---|---|---|---|
| Cross-tenant leakage impossible (ADR-04, R-02) | RLS + tenant-aware client + prefixes + grants | 06 §3, 09 §3 | Isolation suite (Appendix D) release-blocking |
| Permission checks per persona (Appendix B) | Registry, roles, scoped assignments, checker in services | 05 §3 | Generated permission-matrix tests |
| Internal notes never leave the platform; requester templates exclude them | Comment visibility; serializer; template contract tests | 09 §7 | Contract tests |
| Audit completeness and tamper evidence | Audit in transaction; hash chain; insert-only role | 05 §6, 09 §5 | "Every mutating endpoint emits audit" test; nightly verifier |
| Secrets not in repo; encryption at rest and in transit | Railway variables; envelope encryption; TLS | 09 §4 | gitleaks; config review |
| Attachment safety | Presigned upload; scan before visible | 06 §9, 09 §7 | EICAR test |
| Privacy requests, retention, legal hold (MOD-15-E2) | Jobs with dry run; pseudonymisation; hold checks | 06 §13 | Integration tests; evidence reports |
| Channel identity verified before disclosure (MOD-03) | ChannelIdentity verification flows | 07 §5 | Adapter tests |
| AI never sees more than the actor; kill switch ≤ 10 s (MOD-09) | Context assembler under actor; flags | 13 | AI evaluation suite; kill-switch test |
| OWASP ASVS L2 for auth; pen tests before PH-2 and PH-4 | Keycloak; controls table | 09 §7–9 | External pen test; ZAP |

## 4. Maintainability and evolvability

| Requirement | Mechanism | Where | Verification |
|---|---|---|---|
| Modules own data; no direct cross-module table access (Part 4) | Package boundaries; lint rules; Prisma schema per module | 04 §3 | Custom ESLint rule in CI |
| Breaking contract changes need a new version | OpenAPI diff; event `version` | 08 §4, 07 §1 | CI gate |
| Configuration without deployment (PH-2 gate) | Settings framework; versioned definitions; rollback | 05 §7–8 | Admin e2e: change form/SLA/template and roll back |
| Add a channel without touching ticket core (MOD-14 P3) | Adapter pattern; channel commands | 07 §5 | Email adapter as reference; PH-4 adapters |
| Extraction without rewrite (ADR-01) | Service-shaped modules; bus abstraction | 17 | PH-5 gate load and failure test |
| Feature flags expire | Owner and expiry in manifests; lint | 05 §7 | CI lint |

## 5. Usability, accessibility and localisation

| Requirement | Mechanism | Where | Verification |
|---|---|---|---|
| WCAG 2.2 AA on every surface; keyboard completion | Design system a11y primitives; axe in tests | 14 §2, §7 | axe-core; manual audit per phase |
| Localisation: ICU strings, locale formats, RTL, two languages by PH-2, five by PH-4 | `packages/i18n`; Intl; logical CSS | 14 §7 | Pseudo-localisation build; Storybook RTL tests |
| Works at 400 px and 200 % zoom; usable on 3G; offline drafts | Responsive layouts; PWA; drafts | 14 §4–5 | Lighthouse throttled; Playwright viewports |
| 12 core journeys automated (Appendix C) | Playwright against preview environments | 16 §3 | CI stage 4 |

## 6. Operability

| Requirement | Mechanism | Where | Verification |
|---|---|---|---|
| Correlation ID from gateway to job to notification (ADR-07) | Context propagation; envelope; job payload | 05 §1, 15 §1 | Trace assertion in integration tests |
| SLOs published; alerts link to runbooks | `infra/alerts`; runbooks folder | 15 §2–5 | Review at phase gate |
| Backup restore rehearsed every phase | Runbook and schedule | 15 §6 | Phase gate evidence |
| Per-tenant cost attribution *(PH-4)* | Usage meters | 15 §7 | Monthly report |
