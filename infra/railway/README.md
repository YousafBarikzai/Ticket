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

That paragraph was the only place the region existed for a release, and a
paragraph is not a setting: the first project stood up under this pipeline came
up in **US West**, because nothing in the deploy ever mentioned a region to
Railway. It is now `region` in `services.json`, applied to every service
instance, and asserted by a test.

Two things about Railway's regions that decide how much this costs to get
wrong:

- **A region belongs to a service, not to a project.** Moving a service is a
  redeploy and nothing else — *unless it has a volume attached*, in which case
  changing the region **replaces the volume**. None of the ten services here
  carries one; the managed Postgres and Redis do, which is why theirs is worth
  setting before they hold anything.
- **Amsterdam is `ams`.** `europe-west4` names the same place and is Railway's
  legacy spelling, but Railway's own tooling reads the legacy name as a
  *different* region and plans a destructive volume move to reach it. Use
  `ams`.

## Before the first deploy

The pipeline does everything that happens on every deploy. These are the things
that happen once per environment, and they are deliberately not automated: each
one either creates a credential or names a domain, and a workflow that could do
them is a workflow that could do them to the wrong environment.

1. **The GitHub settings the pipeline is gated on.** Secrets `RAILWAY_TOKEN`,
   `RAILWAY_PROJECT_ID`, `KEYCLOAK_ADMIN_CLIENT_ID` and
   `KEYCLOAK_ADMIN_CLIENT_SECRET`, and a `KEYCLOAK_URL` variable. Until
   `RAILWAY_TOKEN` is set, every deploy job prints the plan it would have run
   and exits green.

   `DEPLOY_DOMAIN` is **optional**. Set it and every hostname is derived from
   it — `help.`, `desk.`, `admin.`, `api.`, `auth.`, and
   `<subdomain>.<environment>.<domain>` outside production — and claimed as a
   custom domain. Leave it unset and Railway names each public service itself;
   the deploy asks for the name, reads back what it was given, and builds the
   origin variables from that. It reuses a hostname that already exists rather
   than asking for a fresh one, because a name that changed under a running
   environment would break the origin check and every redirect URI registered
   against the old one.
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
4. **The Railway services**, named exactly as `services.json` names them —
   or `--ensure-services` on the first deploy, which creates the ones the
   catalogue names and the project lacks. Without that flag the deploy refuses
   a service it cannot find rather than skipping it, because a deploy that
   silently did less than it said is how a worker family stays on last month's
   code for a fortnight. Creating them is doing what was asked; skipping one is
   doing less, and the flag only ever does the first.

   Each must be created **from an image, not from this GitHub repository**. A
   Railway service pointed at the repo tries to build it with Railpack, which
   cannot pick one application out of a pnpm workspace holding three Next.js
   apps, an API and a worker — and should not have to, because CI has already
   built, scanned and pushed the images. There is deliberately no root
   `Dockerfile`, `railway.json` or `nixpacks.toml` for it to find.

5. **A registry credential**, because the GHCR packages are private by default.
   Railway needs a GitHub personal access token with `read:packages`, or the
   packages need making public. Without it every deploy fails on the pull with
   an authentication error that names neither the cause nor the fix.
6. **DNS and Cloudflare** for the subdomains in the table (doc 16 §2). The
   deploy creates the custom domain on the Railway side; the CNAME is yours.

## One environment, for now

`main` deploys to the Railway environment named **`production`**, and there is
no `staging`. That is a decision about cost rather than about pipelines: a
Railway environment carries its own Postgres, Redis and Keycloak, so a second
one is three more managed services billed by the hour to protect a product
with no users yet.

What it costs is the rehearsal — a merge reaches the environment people use,
with no earlier one to be wrong in first. Restore it the moment anybody
depends on this: create a Railway environment named `staging`, point stage 5
back at it, and stage 6 becomes the promotion it was written to be rather than
a redeploy of the same place at a tagged version.

Preview environments are off for the same reason, and are opt-in rather than
removed: set a repository **variable** `RAILWAY_PREVIEWS` to `true` and every
pull request gets its own environment again. Without it the preview job prints
the plan, which is the part worth reading in a review anyway.

After that, deploys are: merge to `main` to deploy, publish a release to
redeploy at a tagged version behind the approval. Migrations run as phase 0 inside
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

## What the deploy applies, and what it will not touch

`railway-deploy.ts` sets the image, the replica count, the region, the health
check path, the start command for the two jobs that share an image, each
service's own variables (`WORKER_QUEUES`, `OTEL_SERVICE_NAME`), the origin
variables derived from `DEPLOY_DOMAIN`, the public domain of each public
service, and `PORT`.

**`PORT` is not redundant with the `port` in the catalogue**, which is the
mistake it was added to fix. Each service listens on a fixed port of its own —
the API on 3000, the workbench on 3100 — because they also run under `docker
compose` and on a laptop, where fixed ports are what make the addresses
memorable. Railway reads none of that: it routes the public domain and runs
the health check against `PORT`.

The first deployment where everything else was right is what this cost. The
API's own log read `api listening port: 3000`, 27 modules registered and the
database connected, while Railway failed a health check for 4:53 and destroyed
the container. Nothing was wrong with the application, and neither log said the
word `port` twice. `PORT` now comes from the same catalogue field the domain's
target port does, so the two cannot disagree.

It will not set a credential, and that is enforced by a test. `DATABASE_URL`,
`DATABASE_URL_APP`, `DATABASE_URL_PLATFORM`, `REDIS_URL`, `OIDC_ISSUER`,
`SMTP_URL`, `MEILISEARCH_API_KEY` and the AI keys are set once per environment
by a person. The variable upsert is `replace: false` for the same reason: an
upsert that replaced would delete every variable it did not name, which is a
deploy that can empty an environment on a typo.

Run it with `--dry-run` to see the whole plan — every service, image, domain
and variable — without a token.

## What is not automated, and is not pretending to be

- **Alert rules and dashboards.** Doc 16 §4 says CI applies them. It does not;
  nothing in this repository defines them yet.
- **The Railway mutations have never run against a real account.** The calls
  that set variables, create a domain and create a service were written against
  Railway's published API and are exercised only by the dry run and by tests
  over the plan. They throw on an error rather than continuing, so the first
  real deploy will say plainly if a field name is wrong — but nobody should
  read this section as a claim that they have worked once.
- **Anything end to end against a deployed environment.** This paragraph used
  to say stage 4 ran the walking skeleton against the deployed preview, "a real
  ticket through a real API". It did not and could not: the walking skeleton
  calls `bootstrapModules` and boots the platform in the runner's own process
  against the runner's own database, so handed a deployed API's URL it stops at
  `DATABASE_URL_APP: Required` without opening a connection to the deployment.
  Nothing noticed, because until `RAILWAY_TOKEN` existed the step was skipped on
  every run.

  What runs there now is `post-deploy-check.ts`: every public service answers
  its health path, and the API reports which of its own dependencies it has. A
  real ticket through a deployed API needs a tenant, a credential and a way to
  clean up after itself, and none of those exist yet. The walking skeleton is
  unchanged and still worth running — `pnpm skeleton`, against a local stack,
  where booting the platform is the point rather than the bug.
- **The browser suite.** Playwright, Lighthouse and a full-page axe audit are
  named in doc 16 §3 as intent and do not exist.
- **Rollback.** Railway keeps the previous deployment, so rolling back an
  application is redeploying the previous image by hand. Migrations are
  expand-only for exactly this reason: the old image must still run against the
  new schema. There is no script for it, and inventing one that has never been
  run would be worse than the sentence you are reading.
- **`apps/status`.** Doc 16 §2 gives it a subdomain and static hosting; MOD-23
  serves the status page from the API instead, and the separate application was
  never built.
