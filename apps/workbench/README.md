# `apps/workbench` — the agent workbench

The first application, and the first interface to any of the platform. Queues
and a three-pane ticket workspace: timeline, composer, transitions,
assignment, SLA clocks, time totals and the AI suggestion surface.

```bash
pnpm dev:workbench     # http://localhost:3100
```

## How it is put together

```
src/
  app/                  routes — pages under (desk), the BFF under api/
  server/               the session and the SDK, for server components  (server-only)
  client/               the SDK, for client components                  (proxy-bound)
  components/           the client components
  queue/ · ai/          the pure presentation logic, and its tests
```

The browser holds an opaque `__Host-session` cookie and never an access token.
Server components call the API directly with the session's token; client
components call `/api/proxy/*`, which adds the token and forwards the request
unchanged. All of that is in `@itsm/bff` — the route handlers here are three
lines each, and `src/bff.ts` supplies the four facts that make this app itself.
The rules that make it safe (the path allow-list, the two header allow-lists,
the same-origin check on writes) are pure functions in `packages/bff` with a
test naming each request they refuse. ADR-0041 has the reasoning.

## Configuration

| Variable | Default | What it is |
|---|---|---|
| `API_BASE_URL` | `http://127.0.0.1:3000` | The API, on the private network. Never reached from a browser. |
| `WORKBENCH_ORIGIN` | `http://localhost:3100` | This app's own public origin. The OIDC redirect URI and the same-origin check are both derived from it, so it is configuration rather than a request header. |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Where sessions live. Keys are namespaced `bff:workbench:`, so a session minted here never resolves in the portal. |
| `BFF_SESSION_TTL_SECONDS` | `43200` | How long a session survives. |
| `OIDC_ISSUER` | — | Keycloak's realm URL. **Required in production**: the app refuses to start without it, because no issuer enables the development sign-in. |
| `OIDC_CLIENT_ID` | — | Required with an issuer. |
| `OIDC_CLIENT_SECRET` | — | Required with an issuer. Never leaves the server. |

With no issuer and outside production, `/sign-in` offers a form that takes a
tenant slug and an email address and calls `POST /api/v1/auth/dev-session` on
the API. There is no password, because a seeded development database is not a
secret — and the endpoint does not exist in a deployment.

## Building

`next build --webpack`, not Turbopack. Every module in this repository imports
its neighbours with an explicit `.js` extension; webpack resolves that back to
the `.ts` on disk through `resolve.extensionAlias`, and Turbopack has no
equivalent today. `next.config.ts` says so at the point it matters.

The build emits a standalone server directory, so the app can run from an
image that carries no `node_modules`.

## Tests

`pnpm --filter @itsm/workbench test`, or as part of `pnpm check` at the root.
The queue's URL parsing and the suggestion rendering are pure functions tested
directly; the composer has a jsdom test for the one property worth protecting
— that an internal note cannot be sent without the person having said so, and
that the screen says which it is three ways over. The BFF's own rules are
tested in `packages/bff`.

`src/queue/transitions.ts` is a copy of MOD-04's state machine, because this
app cannot import a module package without importing Prisma with it. The test
beside it imports the real one and asserts the two agree, so the copy fails
loudly rather than drifting.
