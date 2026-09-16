# 08 · API architecture

## 1. Surfaces

| Surface | Base path | Audience | Auth |
|---|---|---|---|
| Tenant API | `/api/v1/…` | Web apps, mobile, channel adapters, partners | Bearer JWT (user), OAuth 2.0 client credentials (integration), API key (server-to-server) |
| Platform API | `/api/platform/v1/…` | Platform console, CLI | Bearer JWT with `platform_operator` realm role; separate database role |
| SCIM *(PH-4)* | `/scim/v2/…` | Identity providers | Per-tenant SCIM bearer token |
| Channel webhooks | `/api/v1/channels/<kind>/…` | Providers | Provider signature (HMAC or public key) |
| Public | `/status/{slug}…`, `/api/v1/surveys/respond/{token}`, `/api/v1/approvals/decide/{token}` | Anonymous | Signed one-time tokens; no session |
| Realtime | `GET /api/v1/events/stream` | Web apps, mobile | Bearer JWT; SSE |
| Docs | `/api/docs`, `/api/openapi.json` | Developers | Public (tenant-agnostic) |
| OAuth *(PH-5)* | `/oauth/authorize`, `/oauth/token` | Partner apps | Delegated to Keycloak clients with consent screens |
| GraphQL *(PH-5)* | `/api/graphql` | Read-heavy experiences | Bearer JWT; read-only |

Everything is served by the one Fastify process in the monolith phase. The base paths are chosen so that a later gateway can route each prefix to an extracted service.

## 2. Edge and gateway responsibilities

There is **no separate API gateway product** in PH-1; the responsibilities are split between Cloudflare and Fastify plugins:

| Responsibility | Where | Notes |
|---|---|---|
| TLS, DNS, WAF, bot rules, DDoS | Cloudflare | Origin accepts only Cloudflare (authenticated origin pulls) |
| Coarse rate limiting (per IP, per path family) | Cloudflare rules | Protects login and webhook endpoints |
| Correlation ID | Fastify `correlationPlugin` | Honour inbound `X-Correlation-Id` from trusted callers; otherwise generate |
| Tenant resolution | Fastify `tenantPlugin` | From the verified token's `tenant_id` claim; for public endpoints from slug/token; host header used only for pre-auth branding and login initiation and must match the token tenant |
| Authentication | Fastify `authPlugin` | JWT verify (JWKS cached), session denylist, API-key lookup (hashed), OAuth client token introspection |
| Fine rate limiting | Fastify `rateLimitPlugin` (Redis) | Per tenant and per token; limits per plan (PH-3); `429` with `Retry-After` |
| Validation | Fastify + Zod (`fastify-type-provider-zod`) | Request and response validated against `packages/contracts`; response validation on in non-production |
| Authorisation | Service layer | Never in routes (specification §7) |
| Idempotency | Fastify `idempotencyPlugin` | `Idempotency-Key` on creating `POST`s |
| Problem details | Error handler | RFC 9457, never a stack trace |

If modules are extracted (PH-5) a thin routing layer (Cloudflare Worker or a lightweight gateway) forwards by prefix; the plugins above move with each service because they live in `packages/platform`.

## 3. Request lifecycle inside Fastify

```
onRequest   correlation → telemetry span → tenant (pre-auth: host/slug)
preParsing  body size limits per route family
preHandler  auth → tenant (verified) → context (TenantContext into async local storage) → rate limit → idempotency lookup
handler     route: parse (Zod) → service call → map result to contract
onSend      ETag/version, X-Correlation-Id, cache headers, response validation (non-prod)
onError     map domain errors → problem details; log with redaction; count metric
```

Domain errors are typed (`NotFoundError`, `ForbiddenError`, `ConflictError`, `ValidationError` with field errors, `StateTransitionError`, `RateLimitedError`, `DependencyUnavailableError`) and mapped centrally to status codes and problem `type` URIs (`https://docs.<domain>/problems/{code}`).

## 4. Contracts package and OpenAPI pipeline

```
packages/contracts/
  api/<module>/*.ts     # Zod request/response schemas + route metadata (method, path, permission, tags)
  events/*.ts           # event payload schemas (re-exported from modules)
  models/*.ts           # shared value types (Actor, Money, Duration, Locale, ProblemDetails)
  expr/                 # expression-language schema
  index.ts
```

- Routes are declared with `defineRoute({ method, path, summary, tags, permission, params, query, body, response, errors })`; the module's Fastify plugin registers them, and the OpenAPI 3.1 document is generated at build time from the same declarations (`pnpm openapi:build`). The `permission` field is **documentation metadata** (rendered in the API docs and used to generate the permission-matrix tests); enforcement happens only in the service layer, per specification §7.
- The generated document is committed (`packages/contracts/openapi.json`); CI runs an OpenAPI diff and fails on breaking changes unless the touched paths are under a new version prefix.
- `packages/sdk` is generated from the document (TypeScript client with typed errors, pagination helpers, idempotency-key helper, SSE helper) and consumed by the web apps, mobile and partners; a Postman collection is generated in the same step.
- **N+1 avoidance for mobile**: `?expand=` is implemented server-side per resource with allow-listed relations, and `?fields=` prunes the response; both are declared in the route metadata so the SDK types them.

## 5. Standards (binding)

The specification's Part 7 standards apply verbatim. Implementation notes:

| Topic | Implementation |
|---|---|
| Versioning | `/api/v1`; new major only for breaking changes; both served for one phase; `Deprecation` and `Sunset` headers on the old version. |
| Identifiers | UUID v7 `id`; human `number` (`INC-000123`) per tenant per type from the counter row. Routes accept either `id` or `number` where unambiguous (`/tickets/INC-000123`). |
| Pagination | Cursor only: opaque base64url of `(sortValues, id)`; `limit` ≤ 200 (default 50); `nextCursor` in the body; `Link` header for convenience. |
| Filtering and sorting | `filter[field]=v1,v2`, `filter[field][op]=…` for `gt/lt/contains/isNull`, `sort=-createdAt,priority`; compiled to the expression language then to Prisma; only fields declared filterable in the route metadata are accepted. Saved views serialise to this grammar. |
| Field selection and expansion | `fields=` and `expand=` as above. |
| Idempotency | Required for creating `POST`s from integrations (enforced for API keys and OAuth clients; optional for user tokens); 24 h; body-hash mismatch → `422`. |
| Concurrency | `If-Match: "<version>"` is required on `PATCH`/`PUT` (missing → `428 Precondition Required`); a stale version → `409 Conflict` whose body includes the current representation for the merge UI. `POST /tickets/:id/assign` reads it when it is offered and does not require it, because a queue screen claims from a list it read a minute ago (ADR-0044). |
| Unknown request fields | Refused, not stripped: every body parsed by a route under `/api/v1` is `.strict()`, so an unrecognised key is a `422` naming the key rather than a `201` for a resource missing the field the client believed it sent (ADR-0044). The module-level schemas stay permissive — an internal caller with an extra key is a build-time type error, not a production failure. |
| Errors | RFC 9457 with `errors[]` (`{ field, code, message }`) and `correlationId`. |
| Rate limiting | Token bucket per tenant and per token in Redis; defaults 600 req/min per user token, 1 200 per integration; bulk and search endpoints have separate buckets. |
| Bulk | `POST /tickets:bulk` up to 200 operations; ≤ 50 executed inline with per-item results, > 50 returns `202` with a job URL (`/jobs/{id}`). |
| Webhooks | See [07 §3](07-eventing-and-integration.md#3-webhooks-mod-14-e2b-ph-2). |
| Documentation | `/api/docs` (Scalar or Redoc UI) and `/api/openapi.json`; changelog generated from the OpenAPI diff. |
| Observability | `X-Correlation-Id` on every response; `Server-Timing` with database and queue timings in non-production. |

## 6. Realtime: server-sent events (ADR-0015)

- `GET /api/v1/events/stream?topics=ticket:{id},inbox,queue:{viewId}` opens an SSE stream (`text/event-stream`), authenticated by bearer token (query-string token exchange for browsers that cannot set headers on `EventSource`; the exchanged token is single-use and short-lived).
- The API instance subscribes to Redis pub/sub channels for the requested topics scoped to the tenant; publishers (handlers, services after commit) publish small notices `{ type, entity, id, version }`. Clients refetch through the REST API, so SSE carries no payload that needs permission filtering beyond topic authorisation at subscription time.
- Heartbeats every 25 s; `Last-Event-ID` resume for 5 minutes via a small Redis ring buffer per topic; mobile falls back to polling when backgrounded.
- WebSockets are not needed for the current requirements (one-directional server push); the abstraction (`realtime.publish(ctx, topic, notice)`) allows a swap.

## 7. Authentication mechanics per caller

| Caller | Token | How obtained | Lifetime | Revocation |
|---|---|---|---|---|
| Browser (web apps) | Keycloak access token held server-side in the Next.js session; cookie `__Host-session` (httpOnly, Secure, SameSite=Lax) | Authorization Code + PKCE via Keycloak; BFF stores refresh token in Redis-backed session, then calls `POST /api/v1/auth/session` so the platform has a session to list and revoke | Access 10 min, refresh sliding up to the tenant's idle/absolute timeouts | Session denylist (`sid`), written by `revokeSession` and `deactivateUser` inside the transaction that revokes the row (ADR-0044); Keycloak logout; platform `DELETE /me/sessions` |
| Mobile | Access + refresh tokens in `expo-secure-store` | Authorization Code + PKCE (`expo-auth-session`) | Same | Same |
| Integration (OAuth client credentials) | Access token from Keycloak client | Client credentials; client bound to one tenant via attribute | 60 min | Client disable |
| Server-to-server (API key) | `Authorization: ApiKey <key>` | Created in admin console; stored hashed (argon2id); scopes | Configurable expiry | Delete key |
| Provider webhooks | Signature | Provider secret | n/a | Rotate secret |
| Public tokens (surveys, email approvals) | Signed, single-purpose JWT/opaque token | Generated by MOD-18/MOD-17 | Short | Single use |

Token claims required by the API: `sub`, `sid`, `tenant_id`, `org_id` (primary), `amr`/`acr` (MFA evidence), `email`, `azp`; roles are **not** taken from the token (they come from the platform's role assignments) except the realm role `platform_operator`.

## 8. Composed endpoints

A small number of endpoints compose data across modules to keep mobile and portal round trips low: `GET /portal/home`, `GET /tickets/{id}/timeline`, `GET /tickets/{id}/context` (requester, assets, SLA, related, suggestions), `GET /me` (user, permissions, organisations, preferences, flags). They live in the module that owns the primary entity and call other modules' services; they are declared in the contracts like any route.

## 9. SDK usage rules for our own apps

- The web apps and mobile use `packages/sdk` exclusively; no hand-written fetch calls.
- The BFF route handlers in Next.js do exactly two things: exchange the session for a bearer token and proxy the request unchanged (adding correlation and tenant headers). They never transform payloads or apply business rules, so the API remains the product.
