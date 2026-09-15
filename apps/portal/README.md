# `apps/portal` — the requester portal

What somebody opens when something has gone wrong, or when they need
something. Report an issue, request from the catalogue, see where a ticket got
to, decide an approval, search the help articles.

```bash
pnpm dev:portal        # http://localhost:3200
```

## The one thing this app does differently

It uses different words for the same ticket than the workbench does, on
purpose. `pending_requester` reads to an agent as "waiting on requester" — a
queue they can ignore. To the person who raised it, it is the single most
important sentence on the screen: *you* have to do something, or this stops.
`src/tickets/presentation.ts` holds that vocabulary and has a test asserting it
covers every canonical state MOD-04 defines.

The same instinct runs through the rest:

- **Priority is never shown.** P1..P4 is an internal scheduling decision made
  from impact and urgency. Showing it invites an argument with somebody who
  cannot change it. The requester chooses the urgency, in their own words, and
  that is what they are told back.
- **Impact is never asked.** A requester cannot know how many other people are
  affected. A form that asks produces a number nobody should act on.
- **Events are not in the timeline.** `status.changed` and `sla.timer.paused`
  are the desk's record of its own work; to a requester they bury the two
  replies that matter.
- **A rejection needs a reason.** An approval without a note costs nobody
  anything; a rejection without one is a request that stops dead with no way
  forward.

## How it is put together

```
src/
  app/                  routes — pages under (portal), the BFF under api/
  server/               the session and the SDK, for server components  (server-only)
  client/               the SDK, for client components                  (proxy-bound)
  components/           the client components
  tickets/ · catalogue/ the pure presentation logic, and its tests
```

Everything about sessions, sign-in and the proxy is in `@itsm/bff`; the route
handlers here are three lines each and `src/bff.ts` supplies the four facts
that make this app itself. ADR-0041 has the reasoning.

## Configuration

Same as the workbench, except the origin variable: `PORTAL_ORIGIN` (default
`http://localhost:3200`). `API_BASE_URL`, `REDIS_URL`,
`BFF_SESSION_TTL_SECONDS`, `OIDC_ISSUER`, `OIDC_CLIENT_ID` and
`OIDC_CLIENT_SECRET` behave identically. Sessions are namespaced
`bff:portal:` so a session minted here never resolves in the workbench.

## Tests

`pnpm --filter @itsm/portal test`, or as part of `pnpm check` at the root. The
requester vocabulary and the catalogue grouping are pure functions tested
directly; the approval decision has a jsdom test for the rule worth
protecting.
