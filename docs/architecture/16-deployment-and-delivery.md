# 16 · Deployment and delivery

## 1. Railway layout (ADR-0012)

```
Railway project: itsm-platform
├── environment: production   (region: EU West / Amsterdam; see D-01 for UK-at-rest options)
│   ├── api (public)            ├── portal (public)     ├── workbench (public)   ├── admin (public)
│   ├── keycloak (public)       ├── worker-events       ├── worker-engine        ├── worker-comms
│   ├── worker-data             ├── clamav              ├── otel-collector
│   ├── postgres (managed)      ├── postgres-keycloak (managed)                  ├── redis (managed)
├── environment: staging       (same graph, smaller sizes, test IdPs, sandbox channel accounts)
└── environment: preview-<pr>  (ephemeral: api, worker (all queues), portal, workbench, admin, keycloak-dev, postgres, redis, minio)
```

- Every service is a Docker image built by CI (multi-stage, Node 22 slim base, non-root, SBOM attached, Trivy-scanned before it is pushed). Nine images come from one `infra/docker/Dockerfile` by target: `api`, `worker`, `migrate`, `portal`, `workbench`, `admin`.
- Start commands, health checks, replicas and the deployment order live in **`infra/railway/services.json`**, applied through the Railway API by `infra/scripts/railway-deploy.ts`. Not a `railway.json` per app: Railway reads its own config-as-code when Railway builds from the repository, and these services run images CI built, so a `railway.json` here would be a file nothing opens.
- Public services use Railway custom domains fronted by Cloudflare with authenticated origin pulls; private services have no public networking.
- Environment variables and secrets are managed in Railway per environment and referenced by the typed config schema; shared variables (database URLs) use Railway variable references.
- Object storage: Cloudflare R2 bucket with EU jurisdiction per environment (D-01 option A, chosen); CORS allows presigned PUTs from the app origins only.

## 2. Cloudflare configuration

- DNS: `help`, `desk`, `admin`, `api`, `auth`, `status` records plus wildcard `*.help.<domain>` for tenant subdomains; custom customer domains via Cloudflare for SaaS (fallback origin = portal) *(PH-3)*.
- TLS full-strict; HSTS preload; TLS 1.2 minimum.
- WAF managed rules; rate-limit rules for `/api/v1/auth/*`, `/api/v1/channels/*`, `/status/*/subscribe`; bot fight mode for public pages.
- Cache rules: static assets (`/_next/static/*`, fonts, images) cached at the edge; API and app HTML bypass the cache.
- Cloudflare Access protects the Keycloak admin console and the platform console paths for operators.
- Static hosting for `apps/status` builds and the design-system documentation site.

## 3. CI/CD pipeline (GitHub Actions + Turborepo)

| Stage | Trigger | Steps | Gate |
|---|---|---|---|
| 1 Validate | Every push | `pnpm install` (cached), lint (incl. module-boundary rules), typecheck, unit tests, contract snapshot, OpenAPI diff, pseudo-localisation, `gitleaks`, `pnpm audit`, Semgrep | All green |
| 2 Build | Every push | `turbo build` (affected), Docker images tagged `sha-<commit>`, SBOM (Syft), Trivy scan, push to GHCR | No critical vulnerabilities |
| 3 Integration | Every push | Testcontainers (PostgreSQL 16 with extensions, Redis, Keycloak dev, MinIO): integration suites, **tenant isolation suite**, **permission-matrix suite**, handler idempotency tests | All green |
| 4 Preview | PR open/update | Railway preview environment from the images; migrations and seed run **inside** the environment as phases 0 and 1 of the deploy; walking skeleton against the preview API; the environment is deleted when the PR closes | Walking skeleton green |
| 5 Staging | Merge to `main` | Realm applied; deploy images in phase order, migrations (expand) first; walking skeleton as the smoke test | Smoke green |
| 6 Release | Tag `vX.Y.Z` | Production deploy behind the `production` GitHub environment's **manual approval**; realm applied; migrations (expand) as phase 0, before any service takes traffic; post-deploy smoke; contract migrations scheduled for a later release | Approval; smoke green; rollback plan attached |
| 7 Mobile | Tag `mobile-vX.Y.Z` | EAS build; Maestro e2e; TestFlight / Play internal; staged rollout; OTA for JS-only | Mobile checklist |

Turborepo remote cache (Vercel or self-hosted on Railway) keeps stage 1–2 fast; only affected packages rebuild and retest.

**What stage 4 does not yet run, and this says so rather than implying it.** Playwright core journeys, axe against a whole page, Lighthouse, a k6 run, a ZAP baseline and an EAS mobile build are all in the table above as intent; none exists in this repository. The preview runs `infra/scripts/walking-skeleton.ts`, which drives a real ticket through the deployed API and is the strongest thing that does exist (doc 18 §3). `packages/ui` runs axe against every component in jsdom (ADR-0046); a full-page audit needs a browser and belongs with the browser suite when there is one.

**Every deploy job is gated.** `vars.DEPLOY_DOMAIN` and `secrets.RAILWAY_TOKEN` must both be set; until they are, `deploy.yml` builds, scans and pushes the images on every push and then prints the deploy plan it would have run instead of failing for the want of a credential.

## 4. Deployment mechanics

- **Order:** `migrate` (`prisma migrate deploy` as `app_owner`) → `seed`, in previews only → `worker-*` → `api` → the three web apps. Workers first so new consumers exist before new events appear; the API's readiness check confirms the migration version. This is the `phase` field in `infra/railway/services.json`, and it is asserted by a test rather than only described here — every worker before the API, the API before every application.
- **Rolling deploys** with health checks; Railway keeps the previous deployment for instant rollback (application rollback = redeploy previous image; migrations are forward-only, hence expand/contract).
- **Feature flags** hide unfinished work; trunk-based development with squash merges; no release branches.
- **Configuration and realm** changes are code: `infra/keycloak/realm.json` is resolved for the environment and applied by `infra/scripts/keycloak-realm.ts --apply` on every deploy, as a partial import with `ifResourceExists: OVERWRITE` so the second deploy of an environment changes what the first one set. Its redirect URIs are derived from the same service catalogue the deploy reads, so the URI Keycloak accepts and the origin the application is served on cannot drift apart. Alert rules and dashboards are not yet applied by CI.
- **Database changes**: reviewed for lock impact; `CREATE INDEX CONCURRENTLY` via raw migrations; backfills as jobs off-peak.

## 5. Environments and data

| Environment | Data | Identity | Channels | Access |
|---|---|---|---|---|
| Local (`docker-compose`) | Seed script | Keycloak dev realm with local users; mock OIDC provider | Mailpit; provider stubs | Developer |
| Preview | Seed script (two tenants) | Keycloak dev realm | Stubs; recorded payload tests | Team via PR links |
| Staging | Seed + anonymised sandbox export | Test tenants in Entra ID/Okta; test Keycloak organisations | Sandbox Slack/Teams/WhatsApp/Twilio accounts *(PH-4)*; Postmark sandbox | Team, pilot admins |
| Production | Real | Production IdPs | Real | Operators (break-glass), on-call |

## 6. Local developer experience

- `pnpm dev` starts `docker-compose` (PostgreSQL, Redis, Keycloak dev, MinIO, Mailpit, otel-collector to a local Grafana) and the apps with hot reload; `pnpm seed` loads the two-tenant data set; `pnpm gen:module <name>` scaffolds a module; `pnpm openapi:build && pnpm sdk:build` regenerate contracts.
- Git hooks run lint and typecheck on staged files; conventional commits enforced.

## 7. Portability

- No Railway-specific code: services are containers with environment variables; PostgreSQL, Redis and S3 are standard; Cloudflare features used (WAF, cache, static hosting, Access) have equivalents elsewhere.
- Moving to AWS or Azure (D-01 option C, or a later decision) means: ECS/Container Apps task definitions from the same images, RDS/Azure PostgreSQL with the same extensions, ElastiCache/Azure Cache, S3/Blob (S3-compatible adapter), and the same GitHub Actions with a different deploy step. Estimated effort is infrastructure-only (weeks, not a rewrite), which is the reason the specification chose containers everywhere.
