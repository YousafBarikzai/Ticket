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
- **"Yes, it's fixed" closes the ticket.** A resolved ticket asks *Is it
  fixed?* rather than announcing a status. **Yes, it's fixed** closes it — the
  requester's own `resolved → closed`, sent with `If-Match` (ADR-0052) — rather
  than leaving it in the desk's resolved list for a week of auto-close. **No,
  still broken** asks what is still happening, reopens first and sends the
  message second, so a message never lands on a ticket that stayed resolved.
  Where the API does not allow the transition, the portal falls back to a
  public "Confirmed fixed" comment and says the ticket will close by itself.
- **Approvals are never in the primary navigation.** Most people who use the
  portal never approve anything, and a permanent tab for them is a tab that is
  empty. So approvals appear where somebody is waiting: a pinned row on Home
  ("Approval waiting · Review"), a count on *Me* and on the avatar, and an
  *Approvals* row in both menus that is always there for whoever holds
  `approval.read`. Without that permission the layout does not even ask.

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

Two more are optional, and the deploy sets both (`infra/scripts/railway-deploy.ts`):

- `WORKBENCH_ORIGIN` and `ADMIN_ORIGIN` — the other two applications, for the
  app switcher a member of staff sees. Only this app's own origin is used for
  sign-in and the origin check; unset, the switcher simply leaves them out.
- `PORTAL_CHANNELS` — a comma list such as `email,teams,slack`: the channels
  the Home page's *Good to know* card says a requester can also reach the desk
  through. A requester cannot read the tenant's channel accounts, so this is
  configuration. Unset, the line is not shown.

## Tests

`pnpm --filter @itsm/portal test`, or as part of `pnpm check` at the root. The
requester vocabulary and the catalogue grouping are pure functions tested
directly; the approval decision has a jsdom test for the rule worth
protecting.
