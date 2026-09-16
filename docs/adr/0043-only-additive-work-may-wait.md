# ADR-0043 · Only additive work may wait

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-16, MOD-02, MOD-17, doc 14 §5

## Context

Doc 14 §5 asks for a background sync queue "for a closed set of actions
(create ticket, add comment, decide approval)". The set is closed in the
document; the interesting question is *why those three*, because the answer
decides what happens when somebody asks for a fourth.

A service desk portal is opened by people whose connection is already the
problem — on a train, in a basement plant room, on a guest network they cannot
authenticate to. The work they do there has to survive. But "queue everything
that failed" is a trap with a specific shape: a request replayed forty minutes
later is a request made against a world that has moved, and the person who
made it is no longer watching. A transition to `resolved` replayed after
somebody else resolved it is refused; a catalogue submission replayed after the
item was retired is refused; and in both cases the refusal arrives with nobody
there to read it.

The second question is what a service worker may cache. A service worker is
the only code in this product that can keep serving a wrong answer after the
code that produced it has been replaced, and the user cannot tell a stale page
from a broken one.

## Decision

**Only additive work may wait.** An action is queueable if it does not depend
on the state of the thing it touches — so a delay changes *when* it happens and
not *whether it was right*. That is exactly the three §5 names:

| Action | Why it may wait |
|---|---|
| Report an issue | A new ticket is new whenever it arrives. |
| Add a comment | A message is still the thing they meant to say. |
| Decide an approval | The decision is theirs; only its timing moves. |

Everything else fails visibly, now, where the person can see it. The portal's
reopen button says "reopening needs a connection" rather than queuing a
transition somebody will never see refused.

**The idempotency key is minted when the person acts**, not when the queue
sends. That single choice is what makes the whole thing safe: a queue drained
twice — a background sync and an `online` event racing, or two tabs — raises
one ticket.

**An answer is classified, not counted.** A 409 on a *create* is the API saying
"you already sent this", which is success arriving by a different door. A 409
on a *decision* is somebody else having decided, which is news a person has to
see. 410, 422, 428 and a 404 on something that existed are the world having
moved: `conflict`, shown, not retried. 400 and 403 are wrong and will be wrong
again: `failed`. Anything else gets five attempts with exponential backoff
capped at ten minutes — capped because what is usually being waited for is
somebody walking out of a tunnel, and an hour-long backoff turns a
thirty-second outage into a ticket that arrives after they have phoned.

**`navigator.onLine` never decides whether something is sendable.** It reports
whether the machine has an interface, so a captive portal and a dropped VPN
both read as online. The queue tries, and a failure is what queues. `onLine`
decides only when it is worth trying *again*.

**Four caching rules, and the first one is about sessions.** Nothing under
`/api/session/` is ever cached, whatever the method: a cached sign-in response
is somebody else's session served to the next person on a shared machine. API
reads are network-first. Content-hashed build output is cache-first; other
static assets are stale-while-revalidate. Navigations are network with the
cached page, then a precached `/offline`, behind them.

**Hand-written, not Workbox** (§5 says `@serwist/next`). Workbox's value is its
build-time precache manifest, and nothing here precaches more than one page.
What is left is a hundred lines of runtime caching, which is worth being able
to read in one file — and the two decisions it makes, what to cache and what to
queue, are pure functions tested elsewhere.

## Consequences

**Good.** Somebody on a train can report an issue and it arrives. The promise
is visible: a count of what is waiting, and the things that need a person
listed with the API's own words for why. The queue cannot duplicate, cannot
replay a state change, and cannot retry for ever. The service worker's caches
are named after a hash of its own bundle, so a deploy that does not change the
worker does not throw away a good cache, and one that does deletes every older
`itsm-` cache on activate.

**Costs.** The queue is another place a request shape exists, so the online and
offline paths could drift; they are kept together by `queueable` in
`packages/sdk`, which both use. A service worker is genuinely dangerous — it
outlives the page — and the mitigation is that `sw.js` is served `no-store` so
a browser cannot hold a stale copy of the rules. An action somebody wants
queued and is not on the list is a support conversation rather than a setting,
which is the right trade and will still be argued about.

**What this does not settle.** There is no push: the Push API is not wired, and
notifications remain the in-app inbox. Background sync only exists on Chromium
— everywhere else the queue drains on `online`, which loses the case where the
tab has been closed, and the honest description is "it sends when you come
back to the page". §5 asks for Lighthouse PWA and accessibility thresholds in
CI from PH-3; there is no Lighthouse run at all, and adding one is a separate
piece of work with its own flakiness to manage.
