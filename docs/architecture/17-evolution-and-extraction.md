# 17 · Evolution and extraction path

## 1. Why the monolith is already "service-shaped"

Every rule in [04 · Module architecture](04-module-architecture.md) exists so that extraction is a deployment change:

| Property of a module today | What it enables later |
|---|---|
| Owns its tables; no cross-module joins or foreign keys | Its tables can move to a separate database without breaking other modules |
| Communicates through service interfaces and events | A service interface can be re-implemented as an HTTP/gRPC client with the same signature; events already travel through a bus |
| Declares routes under a stable prefix | A gateway can route the prefix to a new host |
| Runs the same code in `api` and `worker` | The extracted service is `api` + `worker` for one module |
| Has a manifest | The registry knows which consumers now live elsewhere |

## 2. Extraction criteria (from the PH-5 release gate)

Extract a module only when **measured** evidence shows one of: sustained CPU/IO dominance by that module's routes or jobs (> 40 % of a worker family for a phase), a scaling profile different from the rest (e.g. AI or channel bursts), a team-ownership boundary that suffers from shared deploys, or a residency/isolation requirement (e.g. AI processing in a separate trust zone). The gate also requires a load and failure-mode test proving the bus handles the traffic with replay.

## 3. Candidates and order

| Order | Candidate | Why first | Shape after extraction |
|---|---|---|---|
| 1 | Channel adapters (MOD-03) | Provider-facing, bursty, stateless, already isolated behind webhooks and events | `channels-service`: webhook routes + `channels:*` queues; talks to core via SDK and events |
| 2 | Notification dispatch (MOD-11 delivery) | Provider rate limits and outages should not share a process with the engine | `notify-service`: consumes `notification.queued`, owns delivery attempts |
| 3 | AI workers (MOD-09 `modules/ai`) | Heavy, external, separate trust zone and cost profile | `ai-service`: `ai:*` queues, gateway, retriever (reads projections via SDK or its own read models) |
| 4 | Search indexer + engine (MOD-09 search) | Independent scaling; Meilisearch already separate | `search-service` |
| 5 | Analytics projections (MOD-12) | Read-heavy; can move to its own database | `analytics-service` with its own PostgreSQL |

Ticket core, identity, tenancy, SLA, workflow and approvals stay together longest: they share transactions and latency-sensitive paths.

## 4. Extraction procedure (per module)

1. **Bus transport first.** Switch the `EventBus` publisher to NATS JetStream (or Kafka) while all consumers still run in the monolith; verify lag and replay in staging with the outbox unchanged.
2. **Read-model independence.** Replace any synchronous cross-module reads in the candidate with SDK calls or event-fed read models; measure added latency.
3. **Deploy the module as its own service** (same image, `MODULES=channels` and `WORKER_QUEUES=channels:*`), still pointing at the shared database with RLS. Route its prefixes at the gateway. Run in shadow (both deployments mounted; gateway sends a percentage).
4. **Move data** when needed: create the service's database, dual-write via the module's repo, backfill, cut over, drop from the monolith schema (expand/contract at the schema level).
5. **Retire the module from the monolith image** (`MODULES` excludes it); manifests mark the consumer as remote.

Each step is reversible until step 4's cut-over; the runbook records the rollback for each.

## 5. Gateway introduction

When the first module is extracted, a routing layer is added in front of the origins: a Cloudflare Worker (or a lightweight gateway) that maps `/api/v1/channels/*` → `channels-service`, everything else → `api`. Authentication, tenant resolution, rate limiting and idempotency remain in `packages/platform` plugins inside each service; the gateway does routing and coarse limits only, so no policy is duplicated.

## 6. Multi-region cells *(PH-5)*

- A cell = one full deployment (compute, PostgreSQL, Redis, bucket) in one region. Tenants are pinned to a cell by `tenant.region` and routed at the edge by subdomain or a small tenant directory lookup.
- Keycloak: global by default (one realm, organisations per tenant) with per-cell option for strict residency.
- No cross-cell data access; platform operators see all cells through the platform API's cell-aware client.
- Backups and DR are per cell; the DR test in PH-4 (restore into a second region) is the rehearsal for this layout.

## 7. Partner platform readiness *(PH-5)*

- OAuth apps: Keycloak confidential clients with consent screens and scopes mapped to permission sets; app registration UI in the admin console; sandbox tenants from MOD-13 environments.
- GraphQL read API: a schema generated from the contracts, resolved through the same services with DataLoader batching; read-only; same authorisation.
- AI tool gateway: partner-declared tools go through MOD-09's tool gateway with the same permission and audit model.
- Marketplace: signed configuration packages (Ed25519), permission review from manifests, dependency checks, rollback; module code packages are versioned workspace packages loaded by the registry.

## 8. Things deliberately not built now

- A service mesh, an API gateway product, Kafka, a separate analytics warehouse, a dedicated search cluster, customer-managed keys, multi-region. Each has a defined insertion point above and none requires reworking module code.
