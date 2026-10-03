# `apps/site` — the public site

The fourth web service (SPEC v3 §6.1, ADR-0062): the address to share. It
holds the landing page, the sign-in chooser, the shareable role pages and the
legal pages, and it is how a prospect reaches the one-click demo.

It is **not an application**. No session, no BFF, no Redis, no Keycloak
client, no service worker, no cookie, no credential. Every link into the
product is a plain `<a>` to another origin; every visitor gets the same HTML
for a given minute. The guard tests in `src/__tests__/` hold it to that.

| | |
|---|---|
| Package | `@itsm/site` |
| Port | 3400 (`pnpm dev:site`) |
| Railway service | `site` (phase 4, one replica, `www.` subdomain) |
| Health | `GET /api/health` → `{ "status": "ok", "app": "site" }` |
| Budget | 150,000 B first-load JavaScript per route, growth enforced (`infra/bundle-budgets.json`) |

## Configuration

Read per request by `src/server/config.ts`, never at build time — CI builds the
image before Railway names the hosts.

| Variable | Set by | Used for |
|---|---|---|
| `SITE_ORIGIN`, `PORTAL_ORIGIN`, `WORKBENCH_ORIGIN`, `ADMIN_ORIGIN` | the deploy (`WEB_ORIGINS`) | every link out; whether the site may be indexed |
| `API_BASE_URL` | the deploy | the server-side read of the demo's public status |
| `DEMO_MODE` | `infra/railway/services.json` (`on`) | the demo strip, role buttons and `/try` |
| `OTEL_SERVICE_NAME` | `services.json` | kept uniform with the other services |

Outside production the origins default to the `pnpm dev:*` addresses
(`http://localhost:3200`, `3100`, `3300`, `3400`) and the API to
`http://localhost:3000`. In production an unset origin is left unset, and the
page says that part is unavailable instead of linking to it.

## Indexing

Indexed only when `SITE_ORIGIN` is `https:` and not a Railway-generated
`*.up.railway.app` host, so moving to the owner's domain switches indexing on
with no code change and leaves no duplicate behind. `robots.txt` disallows
`/demo` and `/api/` and never `/try/`, so a shared role link still unfurls.

## Building

```sh
pnpm --filter @itsm/site build      # next build --webpack, standalone output
pnpm tsx infra/scripts/check-bundles.ts --app site
```

Operations, deployment and the first deploy: `docs/runbooks/public-site.md`.
