# ADR-0052 · The redesign's primitives, and the frame they sit in

**Status:** Accepted 2026-09-29 · **Date:** 2026-09 · **Specification reference:** MOD-16, MOD-16-E1, MOD-04, doc 14 §2, §4, §8 · **Amends:** ADR-0005 (web components on hand-written ARIA only), doc 14 §10.2 ("no Radix", "no TanStack Query") · **Related:** ADR-0041, ADR-0043, ADR-0045, ADR-0049

## Context

The three web applications are being redesigned together, in one release: a
new visual language (four audited themes, a system font with a self-hosted
fallback, scarce glass), a new frame for each application (a sidebar console,
a three-pane agent inbox, a search-first portal), and a component catalogue
roughly three times the size of the one `packages/ui` has today. The redesign
specification is the working document; this records the decisions in it that
outlive the release and that somebody might otherwise reverse without knowing
why they were made.

Four forces shaped them.

**The hand-built overlays have reached their limit.** `Dialog`, `Tooltip` and
the command palette are written and tested here, and they are good. What the
redesign needs next is not more of the same: menus with submenus and
typeahead, context menus that mirror a visible button, popovers that flip at a
viewport edge, dismissal that knows which of three stacked layers an Escape
belongs to, and scroll lock that does not jump the page. Each is a solved
problem with a long tail of browser behaviour, and a design system that owns
all of it owns every regression in it.

**The budgets are real and already spent.** The portal promises less than
250 kB of first-load JavaScript, gzipped (doc 14 §8). Next 16 and React 19 cost
about 131 kB of that before a line of ours runs, and the portal home measured
about 185 kB before the redesign began. Every library chosen here is chosen
against what is left, and nothing checked the number until now.

**The workbench outgrew server components alone.** Doc 14 §10.2 recorded "no
TanStack Query" because the queue and the ticket page did not need a cache.
The inbox does: `j`/`k` must move between tickets without a server round trip,
the next and previous tickets are prefetched, a live notice must refresh the
row it names and not the page, and an optimistic write must roll back when the
API says no.

**The Content-Security-Policy is fixed.** `font-src 'self'`, `connect-src
'self'`, `img-src 'self' data: blob:`, no `unsafe-eval`. A library that loads
a font from a CDN, opens its own connection or evaluates strings is not a
candidate, however good it is.

## Decision

### Libraries, and the one way each is reached

| Library | Installed in | Reached through | Why it beats building it |
|---|---|---|---|
| `lucide` (vanilla data, deep imports) | `packages/ui` | `@itsm/ui/icons` | Maintained icon data; rendered by a server-safe `<Icon>`, so an icon costs no client JavaScript |
| `@radix-ui/react-{dialog,dropdown-menu,context-menu,popover,tooltip,slot}` | `packages/ui` | `@itsm/ui/overlays` | Layered dismissal, focus scope and return, `aria-hidden` outside, scroll lock, collision handling, submenus and typeahead |
| `@tanstack/react-table` (pinned exactly: a young major) | `packages/ui` | `@itsm/ui/data` | Sort, filter, selection and column state with a clear boundary between what the client does and what the server does |
| `@tanstack/react-virtual` | `packages/ui` | `@itsm/ui/data` | Windowing for lists over 200 rows |
| `sonner`, run `unstyled` | `packages/ui` | `@itsm/ui/overlays` (`Toaster`), root `notify()` | Stacking, swipe, pause on hover and focus, a region hotkey |
| `@tanstack/react-query` | `apps/workbench` | the workbench's own `src/client/**` | Per-view and per-ticket cache, prefetch, deduplication, optimistic rollback, invalidation by a live notice |
| Inter Variable (files copied, not a dependency) | `packages/ui/fonts/` | `next/font/local` | The nearest open match to the system font on Apple platforms, served from our own origin |

**Applications never import these libraries directly.** They reach them through
`@itsm/ui` subpaths, so the design system is the one place a version changes
and the one place its behaviour is tested. The workbench's query cache is the
single exception, because a cache is application state rather than a
component.

**Weight is isolated by subpath.** The root entry, `@itsm/ui`, is free of
Radix, TanStack and sonner; overlays live under `@itsm/ui/overlays`, tables
under `@itsm/ui/data`, charts under `@itsm/ui/charts` and the frame under
`@itsm/ui/shell`. Both `@itsm/ui` and `@itsm/contracts` declare
`"sideEffects": false`, the root entry no longer re-exports `@itsm/contracts`,
and the form renderer reaches the form logic through `@itsm/contracts/forms`
so that the ticket models do not follow it into the portal. A root component
that needs an overlay loads it on intent (`pointerenter`, `focus`,
`pointerdown`) with `React.lazy`.

`sideEffects: false` is not enough on its own, because server components
import from the root entry and Next collects the client references of a route
from its import graph before anything is shaken out: every `'use client'`
module the root entry re-exports — the form renderer, and zod behind it — was
in every route's first load. So each application also names `@itsm/ui` in
`experimental.optimizePackageImports`, which rewrites `import { Badge } from
'@itsm/ui'` to the module that defines `Badge`. That took about 30 kB off every
portal route and left zod only where the form renderer is used. The root
layouts import the stylesheet from `@itsm/ui/styles` directly, so the one
import every page shares does not depend on the rewrite.

**The budgets are checked, not described.** CI builds all three applications
with `next build --webpack` and runs `infra/scripts/check-bundles.ts`, which
reads each route's client reference manifest and sums the root files and every
chunk the route can ask for, gzipped. A portal route over 250 kB or a workbench
route over 500 kB fails the build; so does a route more than 10 kB over its
recorded baseline in `infra/bundle-budgets.json`, unless the same change
records the new baseline. The admin console is measured and reported, not
budgeted.

### Where the design system may run

- **`@itsm/ui` never imports `next`.** The application hands `ItsmProvider` its
  `Link`, its router methods and its hook references; the design system calls
  them. A component that imported `next/navigation` itself would tie the
  package to one framework version and fail every test that renders it outside
  Next.
- **Server-safe components stay server-safe.** A component file without
  `'use client'` — `Icon`, `Table`, the skeletons, `StatusPill` and the others
  the specification lists — may not call a hook, create a context, or declare or
  pass an event handler, unless the exception is written down with its reason.
  `packages/ui/src/__tests__/guards.test.ts` enforces both rules by parsing the
  source; both faults otherwise pass the type-checker and every render test and
  fail only in a server-rendered route.

### Third-party CSS, and what a nonce policy will need

sonner runs `unstyled` and is styled through class names alone. Radix (through
`react-remove-scroll`) and sonner inject unlayered `<style>` elements of their
own, which would beat every rule in our cascade layers; so any override of a
third-party selector — `[data-sonner-toast]`, `body[data-scroll-locked]` — goes
in one **unlayered** block, `styles/vendor.styles.ts`, and nowhere else.

The policy today allows `'unsafe-inline'` for scripts and styles. The day it
moves to nonces (a recorded follow-up, not part of this release), three things
need a nonce that are easy to miss: the blocking pre-paint theme script in each
root layout, `<Toaster nonce>`, and a `get-nonce` setup for
`react-remove-scroll`. Without the last, the scroll lock's style element is
refused and a dialog lets the page scroll behind it — silently.

### The workbench: a cache, three handlers, one stream

- **TanStack Query holds the inbox.** The server render seeds the view and, with
  `?t=`, the open ticket; the client takes over from there. Hover intent and the
  neighbours of the open ticket are prefetched.
- **Three same-origin aggregation handlers** — `GET /api/desk/list`,
  `GET /api/desk/tickets/[id]` and `GET /api/desk/counts` — each about thirty
  lines over the session's SDK. They exist so that one screen is one request:
  a ticket pane is the ticket, its timeline, its SLA clocks and the people named
  in them, and assembling that in the browser would be four round trips through
  the proxy on every `j`. They answer 401 as JSON when the session has ended, so
  the client can say so rather than render a sign-in page into a pane. The
  service worker treats them as API reads: network first, never served stale
  without saying so.
- **One server-sent-events connection per tab**, opened by `@itsm/pwa/live` and
  shared by everything on the page that listens (topics merged, at most 20).
  A second `EventSource` per component would multiply connections by panes and
  exhaust the browser's per-origin limit on HTTP/1.1. A notice invalidates the
  query for the row it names; it never refreshes the page. The admin console
  uses the same provider for its badges — without a service worker (ADR-0049).

### A requester may close a resolved ticket

`resolved → closed` is now a requester transition as well as an agent's: the
"Yes, it's fixed" answer on the portal closes the ticket, with `If-Match`,
rather than posting a comment and leaving the ticket in the desk's resolved
list until auto-close finishes a week later. The resolution was offered to the
requester, so confirming it is as much their answer as rejecting it, which
they could already do by reopening. Closing from any other state remains an
agent's decision.

**Product sign-off:** decided as a must-ship item of the redesign (specification
§7.3 PA1, Appendix A X-§12.4), by the design lead under the product owner's
delegation for the decisions the UX critique asked for. The portal keeps the
old path — a public "Confirmed fixed" comment and auto-close — behind feature
detection, so an API without the transition still gets an honest answer.

## Alternatives considered

**Keep building overlays by hand.** The existing `Dialog` and palette show it
can be done well. Rejected for menus, popovers and layered dismissal because
the remaining work is the long tail — collision, pointer grace, typeahead,
nested dismissal — where a maintained primitive has already met the bugs we
would meet one at a time in production. The palette stays in-house: thirteen
pinned assertions describe it, and it is ours to extend.

**`lucide-react`.** Its `Icon` is a client component, so every icon on a server
page hydrates. The vanilla package gives the same drawings as data, rendered on
the server for nothing.

**`cmdk`** for the palette would break the palette's pinned behaviour and
accessibility contract for no gain the in-house one lacks. **`recharts`** is
117 kB and client-only; the charts are static SVG with a small client hover
layer. **`@dnd-kit`** is unmaintained, and WCAG 2.5.7 needs a non-drag path
anyway — reordering is Move up, Move down and `Alt+↑/↓`. **`framer-motion`** or
any animation library: the motion here is CSS transitions on `transform` and
`opacity`, and a spring curve is a token. **Date libraries:** `Intl` does the
formatting; `formatDuration` is written here because Node 22 has no
`Intl.DurationFormat`. **`clsx`:** `cx()` is three lines. **Tailwind:** the
stylesheet is generated from the tokens, in cascade layers, and a second
styling system would be a second place for a colour to live.

**SWR, or no cache at all, in the workbench.** SWR covers reads well and leaves
optimistic rollback, prefetch and query invalidation to be built around it;
no cache means `router.refresh()` on every `j`, which is the thing the inbox
exists to stop. TanStack Query is 13 kB inside a 500 kB budget.

**The browser calling the proxy per resource instead of aggregation
handlers.** Fewer files, and four round trips per ticket pane on a keyboard
shortcut that should feel instant. The handlers are small, same-origin, and
behind the same session as everything else.

**A theme cookie** so the server could render the right theme. Rejected for a
blocking inline script that reads `localStorage` before first paint: no flash,
no hydration mismatch, and no cookie on every request for a preference the
server never needs.

## Consequences

**Three new failure modes are now caught before a person meets them:** a route
over budget (the bundle check), a design-system file importing `next` or a
server-safe component growing a hook (the guards test), and the SDK calling a
route with the wrong method (`tests/integration/sdk-routes.test.ts`, which now
asks the router for the exact method; its previous version passed for every
path, because an unauthenticated request is refused at the door whether or not
a route exists).

**The budget check measures an upper bound.** It counts every chunk a route's
server components *can* ask for, which is what the browser may load, not only
what one render does load. A route that shares a client boundary with a heavier
one pays for it in the report — which is the report doing its job, since that
is also what the browser pays.

**Radix brings its own ARIA and its own quirks**, and they are now ours to keep
in step with. The overlays' tests assert behaviour (focus order, dismissal,
return), not Radix's markup, so an upgrade that changes the markup and keeps
the behaviour passes, and one that changes the behaviour fails.

**Doc 14 §10.2's "no Radix" and "no TanStack Query" are reversed** for the
reasons above; its "no Tailwind" stands.

**The nonce policy is follow-up work with a known checklist**, written above so
that it is not rediscovered one refused `<style>` at a time.
