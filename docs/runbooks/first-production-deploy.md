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

## 1. The right region

Decision D-01 option A and the residency commitment in
`docs/architecture/19` put production in **EU West (Amsterdam)**, whose Railway
identifier is **`ams`**.

A region belongs to a **service**, not to a project — so an existing project in
the wrong region does not need replacing. Keep it, and note its project id: it
becomes `RAILWAY_PROJECT_ID`.

What you set by hand is the region of each **managed** service, because those
are the ones with volumes:

- Changing a service's region is a redeploy and nothing more — **unless it has
  a volume attached**, in which case the change *replaces* the volume. An empty
  database loses nothing; a populated one loses everything.
- So set the region on Postgres, `postgres-keycloak` and Redis **when you
  create them, before they hold anything**. Each service's own Settings has
  the region.

Use `ams`, not `europe-west4`. Both name Amsterdam, but `europe-west4` is
Railway's legacy spelling and its tooling treats it as a different region —
which on a service with a volume means a destructive move.

The ten pipeline services carry no volumes, and the deploy sets their region
for you from `region` in `infra/railway/services.json`.

**Environments:** `production` is the one the pipeline deploys to, and Railway
creates it with the project. There is deliberately no `staging` — an
environment carries its own Postgres, Redis and Keycloak, so a second one is
three more managed services billed by the hour (`infra/railway/README.md`, "One
environment, for now"). The name must match exactly: the deploy looks an
environment up by name, and now lists the ones the project has when it cannot
find the one it was asked for.

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

Set each one's region to **`ams`** as you create it — see step 1 for why doing
it afterwards is not the same thing.

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

One environment, so once. If a `staging` environment is added later it needs
its own database with its own four passwords — sharing them would put the
rehearsal and the real thing on one set of credentials, which is the reason
there are four roles in the first place.

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
| `DEPLOY_DOMAIN` | **optional.** Your domain, e.g. `example.com`. Set it and every hostname is derived from it and claimed as a custom domain. Leave it unset and Railway names each public service itself |
| `KEYCLOAK_URL` | Keycloak's public URL. With a domain, `https://auth.<your-domain>`; without one, whatever Railway generated for the Keycloak service — read it off its Networking settings |

**Repository secrets:**

| Name | Value |
|---|---|
| `RAILWAY_TOKEN` | a Railway account or team token. **This is the gate** — until it exists, every deploy job prints its plan and exits green |
| `RAILWAY_PROJECT_ID` | from step 1, and see below |
| `KEYCLOAK_ADMIN_CLIENT_ID` | a Keycloak service account that can manage the realm |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | its secret |

**Two ways to get `RAILWAY_PROJECT_ID` wrong**, both of which the first real
deploy of this pipeline found:

- **The value.** It is the id alone — `railway.com/project/`**`<id>`** — with
  nothing after it. Click into an environment first and Railway appends
  `?environmentId=…`; select the address bar and you copy that too. The deploy
  now refuses a value that is not a bare id, and says which of those it looks
  like, before it opens a connection.
- **The token's reach.** A token created under Account Settings → Tokens
  belongs to the workspace picked beside its name and reaches only the projects
  in that workspace. A project in another one is, to that token, a project that
  does not exist.

Railway answers both with the same four words — `Project not found` — so the
deploy now prints both possibilities whenever it sees them.

**A required reviewer on the `production` environment** (Settings →
Environments → production → Required reviewers). This is what makes the
production approval real: a step in a workflow can be edited by the pull
request that wants to deploy; an environment rule cannot.

Until `RAILWAY_TOKEN` is set, every deploy job prints the plan it would have
run and exits green. That is why the pipeline has been passing while nothing
was deployed.

---

## 7. DNS — only if you set `DEPLOY_DOMAIN`

**Skip this entirely if you are using Railway's own hostnames.** Railway issues
and renews the certificate; there is nothing to point anywhere.

With a domain, add CNAMEs at your DNS provider pointed at the Railway domains
the deploy creates:

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

You do not have to run the real thing yourself. The workflow passes
`--ensure-services`, so the ten services are created with the names the
catalogue gives them — you never open a create-service screen, which is where
every wrong service in this project has come from.

Deploys are automatic:

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

## Turning sign-in on

The deploy applies the Keycloak realm — the clients, the redirect URIs and the
three claims the API refuses a token without — but only once it has an admin
client to do it with. Without one it deploys everything, says in the log that
it skipped the realm, and carries on. That is deliberate: the applications
running and nobody able to sign in is a better first deploy than a red one.

To turn it on:

1. Open Keycloak's admin console at its own hostname and sign in with the
   bootstrap admin you set when you created the service.
2. In the **master** realm, create a client — `itsm-pipeline` will do. Turn
   **Client authentication** on, turn every flow off except **Service accounts
   roles**, and save.
3. On that client, **Service accounts roles** → assign `realm-admin` from
   `realm-management`. It has to be able to create a realm and import clients.
4. **Credentials** tab → copy the client secret.
5. In GitHub: `KEYCLOAK_ADMIN_CLIENT_ID` = `itsm-pipeline` and
   `KEYCLOAK_ADMIN_CLIENT_SECRET` = that secret, both as **secrets**; and
   `KEYCLOAK_URL` = Keycloak's public URL as a **variable**.

The next deploy applies the realm and sign-in starts working. Nothing else has
to change, and no application is redeployed for it.

## Without a domain of your own

Everything works; two things differ.

**Hostnames are Railway's.** They look like
`itsm-portal-production-91bc.up.railway.app` and nobody chooses them. The
deploy asks Railway to name each public service, reads back what it was given,
and sets `PORTAL_ORIGIN`, `WORKBENCH_ORIGIN`, `ADMIN_ORIGIN`, `PUBLIC_BASE_URL`
and `API_BASE_URL` from that. It reuses an existing hostname rather than asking
for a fresh one, because a name that changed under a running environment would
break the origin check and every redirect URI registered against the old one.

**Keycloak is not deployed by this pipeline**, so the deploy cannot discover its
hostname the way it discovers the others. Generate a domain for the Keycloak
service in Railway, then set, by hand:

- `KEYCLOAK_URL` — the GitHub repository variable, to that hostname
- `KC_HOSTNAME` on the Keycloak service — the same value, scheme included
- `OIDC_ISSUER` on the API and the three web applications —
  `https://<keycloak-host>/realms/itsm`

The realm's redirect URIs are *not* on that list: the deploy applies those
after it knows the application hostnames, which is why the realm step runs
after the deploy rather than before it.

You can move to a real domain later without redeploying anything — set
`DEPLOY_DOMAIN`, add the DNS records, and the next deploy claims the custom
domains and rewrites the origins.

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
- **No browser suite.** The render pass and the walking skeleton are what
  exist, and both run against a local stack. What the deploy itself checks is
  narrower: `post-deploy-check.ts` confirms every public service answers its
  health path and that the API reports which of its dependencies it has.
  Playwright, Lighthouse and a full-page axe audit are named as intent.
