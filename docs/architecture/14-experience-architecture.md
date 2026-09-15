# 14 · Experience architecture (web, PWA, mobile)

## 1. Applications

| App | Framework | Purpose | PWA | Notes |
|---|---|---|---|---|
| `apps/portal` | Next.js App Router, React 19, Tailwind, `packages/ui` | Requester portal: home, search, report issue, request service, my tickets, timeline, approvals inbox, knowledge, profile | Yes (user PWA) | Server components for first paint; client components for forms and timeline; tenant subdomain and custom domains |
| `apps/workbench` | Next.js | Agent workbench: queues, three-pane ticket workspace, knowledge authoring, major incident room, workload views | Yes (admin/agent PWA) | Keyboard-first; SSE-driven; heavy client state |
| `apps/admin` | Next.js | Admin console and platform console: builders (fields, forms, categories, priorities, queues, calendars, templates, rules, workflows, SLAs, approvals), settings, flags, modules, packages, audit search, tenancy | Yes (admin PWA) | Guided builders with preview/validate/publish/rollback |
| `apps/status` | Next.js static export | Public status pages | n/a | Built by a worker job; hosted on Cloudflare |
| `apps/mobile` | Expo SDK (React Native), Expo Router | Requesters and agents: SSO, push, my tickets, create with camera, comments, approvals, offline drafts; agent triage *(PH-4)* | n/a | iOS PH-2, Android PH-5; EAS Build and Update |

All web apps share: `packages/ui` (design system), `packages/sdk` (API client), `packages/contracts` (types, expression language, form schema), `packages/i18n`, an auth/session module (BFF token handler), analytics and error reporting (Sentry), feature-flag hooks, deep-link conventions.

## 2. Design system (ADR-0005)

```
packages/ui/
  tokens/         # colour, type, spacing, radius, elevation, motion → CSS variables (web) + RN theme (native)
  web/            # React components (shadcn/ui-style on Radix primitives + Tailwind)
  native/         # React Native components with the same props and a11y behaviour
  icons/
  a11y/           # focus management, live regions, keyboard helpers
  forms/          # FormRenderer: renders a FormVersion (JSON Schema + UI schema) on web and native
  ai/             # AiSuggestionCard, EvidenceList (PH-4)
  stories/        # Storybook (web + native via react-native-web)
```

- Tokens defined once; light, dark and high-contrast themes; RTL supported by logical CSS properties.
- The 20 core components from MOD-16-E1 each ship with a story, an axe-core test and a keyboard-interaction test; the package is versioned and published to the workspace.
- `FormRenderer` is the single implementation that renders catalogue forms in the portal, the Slack/Teams modal builders (server-side transformation to Block Kit / Adaptive Cards), mobile and the admin preview, using the expression language for conditions so behaviour is identical everywhere.

## 3. Authentication and session on the client

- Web: the Next.js app never sees the access token in the browser. Route handlers under `/api/session/*` perform the code exchange with Keycloak, keep tokens in a Redis-backed session keyed by the `__Host-session` cookie, refresh transparently, and proxy API calls (`/api/proxy/*` → `api`) adding `Authorization` and `X-Correlation-Id`. Client code calls the SDK configured with the proxy base URL.
- Mobile: PKCE with `expo-auth-session`; tokens in `expo-secure-store`; SDK adds bearer tokens; refresh on 401; biometric gate *(PH-4)*.
- Session state (`/me`: user, permissions, organisations, preferences, flags) is fetched once and cached; permission-aware UI hides actions the user cannot perform, but the API remains the enforcer.

## 4. Data fetching and state

- Server components fetch initial data for first paint via the SDK (server-side, with the session token).
- Client state uses TanStack Query keyed by the SDK's route signatures; mutations use optimistic updates only where the server response cannot differ materially (e.g. adding a watcher), otherwise "optimistic but honest" pending states.
- **Realtime:** one SSE connection per tab (`useRealtime(topics)`); notices invalidate the relevant queries; timeline updates appear within 2 s.
- **Conflicts:** `409` responses surface the other user's change with a merge dialog (ticket workspace) or a reload prompt (admin builders).
- **Drafts:** portal forms autosave to `/drafts/{formKey}` every 5 s (server-side, so drafts follow the user across devices) and to local storage as a fallback.

## 5. PWA and offline

- Each Next.js app ships a manifest and a service worker (Workbox via `@serwist/next`): app-shell precache, stale-while-revalidate for static assets, network-first for API calls, background sync queue for a closed set of actions (create ticket, add comment, decide approval) with idempotency keys generated client-side.
- Offline queue items are stored in IndexedDB with status (`pending`, `sent`, `failed`) and shown in the UI; conflicts (ticket resolved meanwhile) are presented with choices.
- Web Push through the Push API where supported (`DeviceRegistration` with platform `web`), falling back to the in-app inbox.
- Lighthouse PWA and accessibility scores ≥ 90 are CI thresholds from PH-3.

## 6. Mobile specifics

- Expo Router with typed routes mirroring web deep links (`/tickets/INC-000123`); universal links and app links configured per tenant domain.
- Push via `expo-notifications` (APNs/FCM) with notification actions for approvals; deep links to the ticket.
- Offline drafts and media encrypted at rest (secure store for tokens, encrypted file storage for media); sync status visible; camera capture with client-side resize before presigned upload.
- OTA updates (EAS Update) for JS-only changes; native changes go through store review with the mobile release checklist.
- Maestro e2e flows on EAS builds; crash-free sessions ≥ 99.5 % tracked in Sentry.

## 7. Localisation and accessibility

- All strings externalised (ICU) in `packages/i18n`; pseudo-localisation build and missing-key check in CI; tenant default locale with user override; RTL mirrored via logical properties and verified by Storybook visual tests.
- WCAG 2.2 AA: axe-core in component and e2e tests; keyboard completion of every core journey; focus management for dialogs and toasts; reduced-motion respect; 200 % zoom and 400 px width layouts.
- Content localisation (knowledge, catalogue, templates) is data with per-locale versions, resolved by the same settings order.

## 8. Performance budgets

| Surface | Budget | Mechanism |
|---|---|---|
| Portal | LCP < 2.0 s on mid-range mobile over 4G; initial JS < 250 kB gzipped | Server components, route-level code splitting, image optimisation, edge caching of static assets |
| Workbench | Initial JS < 500 kB gzipped; queue interaction < 100 ms | Virtualised lists, prefetching on hover, SSE instead of polling |
| Mobile | Cold start < 2 s on iPhone 12-class | Hermes, lazy routes, minimal native modules |
| All | Usable on 3G; images lazy-loaded | Lighthouse throttled runs in CI |

## 9. Telemetry from the client

- Product-analytics events for the Appendix C journeys live in their own `ux.` namespace so they are never confused with domain events (`ux.ticket.create.started`, `ux.ticket.create.completed`, `ux.search.performed`, `ux.deflection.recorded`, `ux.approval.decided`); they are sent to `POST /api/v1/analytics/events` in batches; no third-party analytics script by default.
- Errors to Sentry (EU region) with release tagging and the correlation ID of the failing request.

## 10. What is built, and where this document is ahead of it

Sections 1 to 9 describe the intended shape of the experience tier. This
section records what exists, because a document that describes four
applications while one exists is a plan, and a reader cannot tell which
sentences are which.

### 10.1 Built

| Piece | State |
|---|---|
| `packages/ui` | Tokens, a11y primitives, 26 web components, `FormRenderer`, and the two workbench components (`AiSuggestionCard`, `SlaClock`). Every component file carries `'use client'` (ADR-0041); the tokens and `uiStylesheet()` do not, so an application can emit the stylesheet during server rendering. |
| `packages/sdk` | The typed API client: problem-details errors, idempotency keys on creates, `If-Match` on conditional updates, cursor paging, and the workbench's resource surface. |
| `apps/workbench` | Next.js App Router. The BFF (`/api/session/*`, `/api/proxy/*`), the queue, and the three-pane ticket workspace with timeline, composer, transitions, assignment, SLA clocks, time totals and the AI suggestion surface. |
| The development sign-in | `POST /api/v1/auth/dev-session`, registered only outside production and only with no `OIDC_ISSUER` (ADR-0041). |

### 10.2 Deviations from sections 1 to 9

These are decisions, not omissions, and each is one somebody may reasonably
reverse later:

- **No Tailwind and no Radix** (§2). `packages/ui` is built on one generated
  stylesheet driven by the token variables, and on hand-written ARIA patterns
  with keyboard tests. What §2 describes is a reasonable stack; what exists has
  no build-time CSS step and no third-party component semantics to keep in step
  with the product's own.
- **No TanStack Query** (§4). Server components fetch for first paint and
  `router.refresh()` re-reads after a mutation. A cache layer is worth adding
  when there is a screen that needs one; the queue and the ticket page do not.
- **No Storybook, no `packages/i18n`, no `packages/ui/native`, no
  `packages/ui/icons`** (§2, §6, §7). None of these has been built. The
  accessibility tests §2 promises exist as keyboard and ARIA tests in
  `packages/ui/src/**/__tests__`; there is no axe-core run.
- **No service worker, no offline queue, no push** (§5). The workbench is
  online-only today.
- **Polling, not SSE, for an AI job** (§4). `GET /events/stream` exists in the
  API (ADR-0015) and the proxy does not carry it. A job the person just started
  is polled with a ceiling; a queue that updates by itself needs the stream.
- **`apps/portal`, `apps/admin`, `apps/status` and `apps/mobile` do not
  exist.** MOD-23's status page is served by the API, not by a Next app.

### 10.3 What building the first application found in the API

Recorded here rather than in a module's document, because each was invisible
until something tried to use the API the way an application does:

- **`POST /tickets/:id/assign` reads no `If-Match`.** Every other mutation on a
  ticket is conditional. Two agents taking the same ticket at the same moment
  is therefore last-write-wins, silently. The SDK deliberately does not send a
  version on that call rather than implying a guarantee the API does not make.
- **The list grammar is `filter[...]`, and a wrong parameter is ignored rather
  than refused.** A client that sent `?status=open` got every ticket back and
  no error. The SDK now spells the grammar in one tested function; the wider
  point is that an API which ignores unknown query parameters makes a whole
  class of client bug invisible.
- **A comment's visibility is `public`/`internal` and defaults to `public`.** A
  client sending anything else — `isInternal: true`, say — has its internal
  note delivered to the requester. This one is worth a schema that refuses
  unknown keys rather than a convention.
- **There is still no JIT provisioning and no `POST /auth/session`.** Doc 09 §2
  describes both; `userService.provisionFromToken` exists and has no caller. A
  person who authenticates against Keycloak but has no row in `user` cannot use
  the workbench.
