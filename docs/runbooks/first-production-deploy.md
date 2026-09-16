# Standing production up for the first time

Everything here is a thing only an account owner can do: it creates a
credential, buys something, or names a domain. The pipeline does all the rest
on every deploy, and `docs/runbooks/deploy-and-rollback.md` covers the routine
case once this has been done once.

Work top to bottom. Each step says what it is for and what goes wrong without
it, because the failures in this list are mostly silent or misleading — the one
that sent us here reported "Railpack failed to prepare the build" for a
repository that never asked Railway to build anything.

---

## 0. Remove the service that builds from GitHub

If the Railway project has a service connected to this repository — ours was
called **Ticket** — delete it.

It will never build. Railway's builder tries to detect a single application and
this repository is a pnpm workspace holding three Next.js apps, an API and a
worker; there is deliberately no root `Dockerfile`, `railway.json` or
`nixpacks.toml` for it to find, because the images are built, scanned and pushed
by GitHub Actions and Railway's job is to **run** them.

While it exists, every push to `main` produces a red deployment that has nothing
to do with the real pipeline, and the noise makes a genuine failure harder to
see.

---

## 1. A project in the right region

Railway fixes a project's region when it is created, and the managed Postgres
volume cannot be moved afterwards. Decision D-01 option A and the residency
commitment in `docs/architecture/19` put production in **EU West (Amsterdam)**.

If the existing project is anywhere else and holds nothing worth keeping,
create a new one in EU West rather than trying to migrate it. Note its project
id — it becomes `RAILWAY_PROJECT_ID`.

The service *instances* also carry a region, and the deploy sets that from
`region` in `infra/railway/services.json`. The project region is the one you
have to get right by hand.

**Environments:** create `staging` and `production` in the project. The names
must match exactly — the deploy looks an environment up by name and refuses one
it cannot find.

---

## 2. The managed services

From Railway's own catalogue, in this project:

| Add | Why |
|---|---|
| **Postgres** | the platform database |
| **Redis** | queues, sessions, rate limits |
| **Postgres** (a second one) | Keycloak's own store — name it `postgres-keycloak` |
| **Keycloak** | sign-in. Point it at `postgres-keycloak` |
| **Meilisearch** *(optional)* | leave `MEILISEARCH_URL` unset and search runs off the Postgres projection, which is written in the same transaction as the change it describes and is therefore never stale |

Two Postgres instances rather than one is deliberate: Keycloak's schema is
Keycloak's, and a shared database makes its upgrades our problem.

---

## 3. Let Railway pull the images

The GHCR packages are **private** — I checked, an anonymous pull is refused. One
of:

- **Make the packages public.** GitHub → your profile → Packages → each of
  `ticket/api`, `ticket/worker`, `ticket/migrate`, `ticket/portal`,
  `ticket/workbench`, `ticket/admin` → Package settings → Change visibility.
- **Or give Railway a credential.** A GitHub personal access token (classic)
  with `read:packages`, added to each service as its image registry credential.

Without this every service fails on the image pull, with an authentication
error that names neither the cause nor the fix.

---

## 4. The database roles

Four roles, not one. `app_user` is subject to row-level security, `app_owner`
owns the tables, `app_platform` crosses tenants deliberately, `app_readonly` is
for reporting. Sharing a credential between them would make the tenant
isolation in `docs/architecture/10` decorative.

Against the production Postgres, once:

```
ENVIRONMENT=production \
DATABASES=itsm \
APP_OWNER_PASSWORD=… \
APP_USER_PASSWORD=… \
APP_PLATFORM_PASSWORD=… \
APP_READONLY_PASSWORD=… \
PGHOST=… PGPORT=… PGUSER=… PGPASSWORD=… \
./infra/scripts/prepare-database.sh
```

Four different passwords. The script refuses to run against anything but
`local` while any of them is still `devpass`.

Repeat for `staging` with its own passwords and its own database.

---

## 5. Variables on the Railway services

The deploy sets the image, replicas, region, health check, `WORKER_QUEUES`,
`OTEL_SERVICE_NAME`, the origin variables and the public domains. It sets **no
credential**, by design and by test — so these are yours, once per environment.

Set on **every** application and worker service:

| Variable | Value |
|---|---|
| `DATABASE_URL_APP` | Postgres URL as `app_user` |
| `DATABASE_URL_PLATFORM` | Postgres URL as `app_platform` |
| `REDIS_URL` | the Redis URL |
| `OIDC_ISSUER` | `https://auth.<your-domain>/realms/itsm` |
| `NODE_ENV` | `production` |

Set on **`migrate`** only:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Postgres URL as `app_owner` — it creates tables |

Set on **`worker-comms`** only, when you want real email:

| Variable | Value |
|---|---|
| `EMAIL_TRANSPORT` | `smtp` |
| `SMTP_URL` | your relay |
| `EMAIL_FROM` | e.g. `Service Desk <servicedesk@your-domain>` |

Leave `EMAIL_TRANSPORT` unset and notifications are written to the log instead
of sent, which is a fine way to demo and a bad way to run a desk.

Optional, if you added Meilisearch: `MEILISEARCH_URL` and `MEILISEARCH_API_KEY`
on the API and on `worker-data`.

Railway's variable references (`${{Postgres.DATABASE_URL}}`) are the tidy way to
do the database and Redis ones.

---

## 6. GitHub settings

**Repository variables** (Settings → Secrets and variables → Actions →
Variables):

| Name | Value |
|---|---|
| `DEPLOY_DOMAIN` | your domain, e.g. `example.com`. Every hostname is derived from it |
| `KEYCLOAK_URL` | `https://auth.<your-domain>` |

**Repository secrets:**

| Name | Value |
|---|---|
| `RAILWAY_TOKEN` | a Railway account or team token |
| `RAILWAY_PROJECT_ID` | from step 1 |
| `KEYCLOAK_ADMIN_CLIENT_ID` | a Keycloak service account that can manage the realm |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | its secret |

**A required reviewer on the `production` environment** (Settings →
Environments → production → Required reviewers). This is what makes the
production approval real: a step in a workflow can be edited by the pull
request that wants to deploy; an environment rule cannot.

Until `DEPLOY_DOMAIN` and `RAILWAY_TOKEN` are both set, every deploy job prints
the plan it would have run and exits green. That is why the pipeline has been
passing while nothing was deployed.

---

## 7. DNS

CNAMEs at your DNS provider, pointed at the Railway domains the deploy creates:

| Host | Service |
|---|---|
| `help.<domain>` | portal |
| `desk.<domain>` | workbench |
| `admin.<domain>` | admin |
| `api.<domain>` | api |
| `auth.<domain>` | keycloak |

Staging is the same with `.staging` inserted: `help.staging.<domain>`.

---

## 8. The first deploy

Check the plan first — no token needed, nothing is touched:

```
DEPLOY_DOMAIN=<your-domain> pnpm exec tsx infra/scripts/railway-deploy.ts \
  --environment production --tag sha-<commit> --dry-run
```

It prints every service, the image it will run, the domain it will claim and
every variable it will set. Read it. It is the only preview you get.

Then, for the first run only, add `--ensure-services` so the ten services are
created rather than hand-made:

```
DEPLOY_DOMAIN=… RAILWAY_TOKEN=… RAILWAY_PROJECT_ID=… \
pnpm exec tsx infra/scripts/railway-deploy.ts \
  --environment production --tag sha-<commit> --ensure-services
```

After that, deploys are automatic:

- **merge to `main`** → staging
- **publish a release** → production, behind the approval from step 6
- **open a pull request** → a preview environment, torn down when it closes

Migrations run as phase 0 *inside* the environment, so no runner ever needs a
public database URL.

---

## 9. Check it actually works

```
pnpm exec tsx infra/scripts/walking-skeleton.ts
```
with `API_BASE_URL=https://api.<your-domain>`. It drives a real ticket through
the real API.

Then the render pass, which is what found eleven broken admin screens:

```
PORTAL_ORIGIN=https://help.<domain> \
WORKBENCH_ORIGIN=https://desk.<domain> \
ADMIN_ORIGIN=https://admin.<domain> \
./infra/scripts/render-pass.sh
```

Note it signs in through the development sign-in, which a production build
refuses to serve — so against production it will report a sign-in failure. That
is the guard working. Run it against a preview environment instead.

---

## Known sharp edges

- **The Railway mutations have never run against a live account.** Setting
  variables, creating a domain and creating a service were written against
  Railway's published API and are covered by tests over the *plan*, not by a
  round trip. They throw rather than continue, so the first real deploy will
  say plainly if a field name is wrong — but nobody should treat them as
  proven until they have run once.
- **No rollback script.** Railway keeps the previous deployment; rolling back an
  application is redeploying the previous image by hand. Migrations are
  expand-only so the old image still runs against the new schema.
- **No alert rules or dashboards.** `docs/architecture/16 §4` says CI applies
  them. Nothing in this repository defines them yet.
- **No browser suite.** The walking skeleton and the render pass are what exist.
  Playwright, Lighthouse and a full-page axe audit are named as intent.
