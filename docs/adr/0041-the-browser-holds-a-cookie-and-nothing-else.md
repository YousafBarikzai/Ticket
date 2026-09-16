# ADR-0041 · The browser holds a cookie and nothing else

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-16, MOD-04, doc 03 §1, doc 08 §9, doc 09 §2, doc 14 §3

## Context

Four phases produced 27 modules, 183 tables and 366 endpoints, and no
interface. Doc 14 has described `apps/workbench` since Phase 1; doc 23 §8
recorded it as the largest outstanding piece of work. Everything the platform
does was reachable only by somebody holding a bearer token and a terminal.

Building the first application forces three decisions that the documents
state but that no code had yet had to honour, and each of them has an easy
wrong answer that is hard to reverse once a second application copies it.

**Where the access token lives.** The obvious shape — fetch a token in the
browser, keep it in memory or in storage, send it from components — is what
most tutorials show and what most single-page applications do. It puts a
bearer token for a multi-tenant platform inside a document that also runs
third-party fonts, analytics and whatever a future dependency pulls in. Doc
08 §9 and doc 14 §3 already say the token stays server-side; the question was
whether that survives contact with a real screen, or gets relaxed the first
time a component needs to call something.

**What the proxy is allowed to do.** A backend-for-frontend that forwards
browser requests to an API is a small piece of code with an unusually large
blast radius: it is the browser's whole route to the platform. The tempting
thing is to give it knowledge — "agents may transition, requesters may not",
"strip this field for the portal". Every such rule is a second authorisation
model in front of the one the API already enforces, and the second one is the
one that drifts.

**How anybody signs in without an identity provider.** Production
authentication is Keycloak. With no Keycloak running there was no way for a
browser to obtain a token at all, so the walking skeleton minted its own with
a helper buried in `infra/scripts`. That is fine for a script and useless for
an application: the first thing a new application needs is a way to log in,
and copying token-minting into each one puts the development affordance in
three places at once.

## Decision

**The browser holds an opaque session identifier and nothing else.** The
access token, the refresh token and the tenant live in Redis, keyed by a
`__Host-session` cookie that is `httpOnly`, `Secure`, `SameSite=Lax`,
`Path=/` and carries no `Domain`. Server components call the API directly
with the session's token; client components call `/api/proxy/*`, which is the
only route the browser has. There is deliberately no configuration that
points a browser-side client anywhere else — a `NEXT_PUBLIC_API_URL` would be
the escape hatch that undoes this the first time somebody is in a hurry.

**All of it lives in `packages/bff`, once.** The handlers speak `Request` and
`Response` rather than a framework's own types, so a route handler in any
application is three lines and the whole sign-in round trip can be tested
without standing a server up. An application supplies four facts — its name,
the environment variable holding its origin, where a sign-in lands, and its
two pages that are reachable without one — and nothing else. The alternative,
discovered the moment a second application needed it, is that the `__Host-`
attributes, the proxy's allow-lists and the single-use pending login all exist
twice and drift apart quietly.

Sessions are namespaced per application (`bff:<app>:sess:`). Two applications
may share a Redis, and an identifier minted for one must not resolve in the
other: they have different audiences, and an agent's session appearing in the
portal would be a privilege boundary crossed by a cookie name.

**The proxy is a pipe with a bouncer on it, and knows nothing about the
domain.** Its rules are four allow-lists and no business logic:

- the path is rebuilt from validated segments and must begin `/api/v1/`, so
  `/metrics`, `/scim/v2`, `/api/platform/v1` and a `..` that arrived encoded
  are all unreachable;
- request headers are an allow-list, so the browser's `cookie` never reaches
  the API and a client-supplied `authorization` never survives;
- response headers are an allow-list, so the API can never `set-cookie` on
  the application's origin;
- an unsafe method must carry `sec-fetch-site: same-origin` or a matching
  `Origin`, because `SameSite=Lax` does not cover a cross-site form post.

Each rule is a pure function with a test naming the request it refuses.

**The development sign-in is one endpoint on the API, guarded twice.**
`POST /api/v1/auth/dev-session` exchanges a tenant slug and an email address
for the same HS256 development token the API already accepts, and is
registered only when `NODE_ENV` is not production *and* no `OIDC_ISSUER` is
configured. The BFF calls it exactly as it would call Keycloak's token
endpoint, so the code path a developer exercises daily is the code path that
runs in production, minus the provider.

Two consequences of building the first Next applications are recorded here
because they are repository-wide and the next one inherits them:

- **`@itsm/ui` is a client library.** Every component file carries
  `'use client'`, including the ones that use no hook today, because the
  alternative is a rule nobody can see — adding `useState` to `Badge` would
  become a build error in three applications, reported against their layout.
  The tokens and `uiStylesheet()` stay free of it, so an application can emit
  the stylesheet during server rendering and avoid a flash of unstyled
  content.
- **The workbench builds with webpack, not Turbopack.** Every module in this
  repository imports its neighbours with an explicit `.js` extension, which
  `tsc`, `tsx` and Vitest all resolve back to the `.ts` on disk. webpack has
  `resolve.extensionAlias` for exactly this; Turbopack has no equivalent
  today. The alternative was to drop the extensions across `@itsm/ui` and
  `@itsm/sdk` and with them the ability to run any of it under Node's own
  resolver.

## Consequences

**Good.** A cross-site scripting bug in a component cannot read a bearer
token, because there is not one to read. A stolen cookie dies the moment the
session record is deleted, which is what makes `DELETE /me/sessions` and a
Keycloak sign-out actually take effect. The API stays the product: every rule
about who may do what is enforced in one place, and the proxy has no opinion
to drift from it. A developer can run the workbench against a seeded database
with no Keycloak, through the same sign-in shape that production uses.

**Costs.** Every browser call takes one extra hop, and the workbench is now
on the critical path for its own availability rather than only for its own
rendering. The session store is a new dependency for the application tier:
Redis down means nobody can sign in, where a token in the browser would have
kept working until it expired. Server components and client components reach
the API by different routes — direct and proxied — which is one more thing to
know when reading the code, and is written down at the top of
`src/server/session.ts` for that reason.

**What this does not settle.** The two applications use different vocabulary
for the same ticket on purpose — `pending_requester` is "waiting on requester"
to an agent and "Waiting for you" to a requester. Each table has a test
asserting it covers every canonical state MOD-04 defines, so a new state
fails in both places rather than falling through to something bland; what
neither can check is whether the *words* are still the right ones. The proxy
does not yet carry server-sent events, so the workbench polls a job it started rather than being told
(ADR-0015 exists and the stream is built; wiring it through the BFF is
Phase 5 work). There is no service worker and no offline queue, which doc 14
§5 requires of the PWA. And the API's assign endpoint reads no `If-Match`, so
two agents taking the same ticket is last-write-wins where a transition or an
edit is refused — recorded in doc 23's open list rather than papered over in
the client.
