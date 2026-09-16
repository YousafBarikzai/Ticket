# Railway services

Deployment layout for `docs/architecture/16 §1`. Every service is built from
`infra/docker/Dockerfile` with a different target, and configuration is
environment variables only — nothing here is Railway-specific beyond the
service definitions, which is what keeps option B and option C of decision D-01
open (`docs/architecture/19`).

**`services.json` beside this file is the source of truth**, not this table:
which services exist, which image target each runs, how many replicas, which
health check, and the phase order a deploy goes in.
`infra/scripts/railway-deploy.ts` reads it and applies it through the Railway
API, and `infra/scripts/__tests__/railway-deploy.test.ts` asserts the ordering
that matters. The table below is a summary for a person and can be wrong; the
JSON cannot, because something reads it.

| Phase | Service | Target | Public | Replicas | Notable variables |
|---|---|---|---|---|---|
| 0 | `migrate` | `migrate` | no | — | `DATABASE_URL` as `app_owner` |
| 1 | `seed` | `migrate` | no | — | previews only; start command `pnpm seed` |
| 2 | `worker-events` | `worker` | no | 2 | `WORKER_QUEUES=events` |
| 2 | `worker-engine` | `worker` | no | 2 | `WORKER_QUEUES=engine` |
| 2 | `worker-comms` | `worker` | no | 2 | `WORKER_QUEUES=comms`, `EMAIL_TRANSPORT`, `SMTP_URL` |
| 2 | `worker-data` | `worker` | no | 1 | `WORKER_QUEUES=data` |
| 3 | `api` | `api` | `api.` | 2 | `API_PORT`, `DATABASE_URL_APP`, `DATABASE_URL_PLATFORM`, `REDIS_URL`, `OIDC_ISSUER` |
| 4 | `portal` | `portal` | `help.` | 2 | `PORTAL_ORIGIN`, `API_BASE_URL`, `REDIS_URL`, `OIDC_*` |
| 4 | `workbench` | `workbench` | `desk.` | 2 | `WORKBENCH_ORIGIN`, `API_BASE_URL`, `REDIS_URL`, `OIDC_*` |
| 4 | `admin` | `admin` | `admin.` | 1 | `ADMIN_ORIGIN`, `API_BASE_URL`, `REDIS_URL`, `OIDC_*` |
| — | `keycloak` | upstream image | `auth.` | 2 | own PostgreSQL |
| — | `meilisearch` | upstream image | no | 1 | `MEILI_MASTER_KEY`, persistent volume |
| — | `postgres`, `postgres-keycloak`, `redis` | managed | no | — | — |

The three web applications hold no build-time configuration at all: there is no
`NEXT_PUBLIC_` anything in `packages/bff` on purpose, so one image per commit
runs unchanged in a preview, in staging and in production, and the only thing
that differs is the environment it is given.

The queue families are split across services on purpose: a burst of indexing or
AI work must not starve outbox publishing or the SLA timers
(`docs/architecture/03 §4`).

## Region

Production runs in **EU West (Amsterdam)** under decision D-01 option A, with
object storage in Cloudflare R2's EU jurisdiction. Tenants carry a `region`
column from Phase 1 so that moving a tenant, or adding a second cell, is a
routing change rather than a redesign.

## Before the first deploy

The pipeline does everything that happens on every deploy. These are the things
that happen once per environment, and they are deliberately not automated: each
one either creates a credential or names a domain, and a workflow that could do
them is a workflow that could do them to the wrong environment.

1. **The GitHub settings the pipeline is gated on.** A repository variable
   `DEPLOY_DOMAIN` (every hostname is derived from it: `help.`, `desk.`,
   `admin.`, `api.`, `auth.`, and `<subdomain>.<environment>.<domain>` for
   anything that is not production) and a `KEYCLOAK_URL` variable; secrets
   `RAILWAY_TOKEN`, `RAILWAY_PROJECT_ID`, `KEYCLOAK_ADMIN_CLIENT_ID` and
   `KEYCLOAK_ADMIN_CLIENT_SECRET`. Until `DEPLOY_DOMAIN` and `RAILWAY_TOKEN`
   are both set, every deploy job prints the plan it would have run and exits
   green.
2. **A required reviewer on the `production` GitHub environment.** This is what
   makes stage 6's manual approval real: a step in the workflow could be edited
   by the pull request that wants to deploy, and an environment rule cannot.
3. **The database roles**, once per Railway environment:
   `ENVIRONMENT=production DATABASES=itsm APP_OWNER_PASSWORD=… APP_USER_PASSWORD=…
   APP_PLATFORM_PASSWORD=… APP_READONLY_PASSWORD=… ./infra/scripts/prepare-database.sh`.
   The script refuses to run against anything but `local` while a password is
   still `devpass`. Four roles rather than one is not ceremony: `app_user` is
   subject to row-level security and `app_owner` owns the tables, so sharing a
   credential would make the isolation in doc 10 decorative.
4. **The Railway services**, named exactly as `services.json` names them. The
   deploy refuses a service it cannot find rather than skipping it, because a
   deploy that silently did less than it said is how a worker family stays on
   last month's code for a fortnight.
5. **DNS and Cloudflare** for the subdomains in the table (doc 16 §2).

After that, deploys are: merge to `main` for staging, publish a release for
production, open a pull request for a preview. Migrations run as phase 0 inside
the environment, so no runner ever needs a public database URL.

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

## What is not automated, and is not pretending to be

- **Alert rules and dashboards.** Doc 16 §4 says CI applies them. It does not;
  nothing in this repository defines them yet.
- **The browser suite.** Stage 4 runs the walking skeleton against the deployed
  preview, which is a real ticket through a real API. Playwright, Lighthouse and
  a full-page axe audit are named in doc 16 §3 as intent and do not exist.
- **Rollback.** Railway keeps the previous deployment, so rolling back an
  application is redeploying the previous image by hand. Migrations are
  expand-only for exactly this reason: the old image must still run against the
  new schema. There is no script for it, and inventing one that has never been
  run would be worse than the sentence you are reading.
- **`apps/status`.** Doc 16 §2 gives it a subdomain and static hosting; MOD-23
  serves the status page from the API instead, and the separate application was
  never built.
