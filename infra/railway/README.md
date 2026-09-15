# Railway services

Deployment layout for `docs/architecture/16 §1`. Every service is built from
`infra/docker/Dockerfile` with a different target, and configuration is
environment variables only — nothing here is Railway-specific beyond the
service definitions, which is what keeps option B and option C of decision D-01
open (`docs/architecture/19`).

| Service | Target | Public | Replicas (production) | Notable variables |
|---|---|---|---|---|
| `api` | `api` | yes | 2+ | `API_PORT`, `DATABASE_URL_APP`, `DATABASE_URL_PLATFORM`, `REDIS_URL`, `OIDC_ISSUER` |
| `worker-events` | `worker` | no | 2 | `WORKER_QUEUES=events` |
| `worker-engine` | `worker` | no | 2 | `WORKER_QUEUES=engine` |
| `worker-comms` | `worker` | no | 2 | `WORKER_QUEUES=comms`, `EMAIL_TRANSPORT`, `SMTP_URL` |
| `worker-data` | `worker` | no | 1+ | `WORKER_QUEUES=data` |
| `keycloak` | upstream image | yes | 2 | own PostgreSQL |
| `meilisearch` | upstream image | no | 1 | `MEILI_MASTER_KEY`, persistent volume |
| `postgres`, `postgres-keycloak`, `redis` | managed | no | — | — |

The queue families are split across services on purpose: a burst of indexing or
AI work must not starve outbox publishing or the SLA timers
(`docs/architecture/03 §4`).

## Region

Production runs in **EU West (Amsterdam)** under decision D-01 option A, with
object storage in Cloudflare R2's EU jurisdiction. Tenants carry a `region`
column from Phase 1 so that moving a tenant, or adding a second cell, is a
routing change rather than a redesign.

## Before the first deploy

1. Create the four database roles and the database: `infra/scripts/prepare-database.sh`.
2. Set the variables above; the API refuses to start on an invalid configuration
   rather than failing later under load.
3. Run migrations as `app_owner` (`pnpm db:migrate`) before traffic switches.
4. Deploy workers first, then the API: new consumers should exist before new
   events do.

## Search

`meilisearch` is optional. Leave `MEILISEARCH_URL` unset and search is served
from the `search_document` projection, which is written in the same transaction
as the change it describes and is therefore never stale — a small deployment
does not need a search server.

Set it and the platform gains typo tolerance and true facet counts, and falls
back to the projection whenever the engine is unreachable. Every response says
which engine answered. Turning it on for a platform that has been running
without it needs one `search.reindex` job per tenant; the same job applies a
change to the index settings, because Meilisearch applies those at write time.
