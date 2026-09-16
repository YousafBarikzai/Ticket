# `@itsm/pwa` — offline, for the applications

A service worker and an outbox. Doc 14 §5 asks for both; ADR-0043 records why
the outbox holds three actions and not any.

```
src/
  outbox.ts   the rules — what may be queued, what an HTTP answer means, when
              to retry and when to stop. Pure, and where the tests are.
  routing.ts  which caching strategy a request gets. Pure.
  store.ts    IndexedDB, with an in-memory fallback that is not only for tests
  sync.ts     draining, one item at a time, oldest first
  client.ts   registration, `submitOrQueue`, and `useOutbox` for the screen
  sw.ts       the worker, bundled into each app's public/sw.js
```

## The one rule worth knowing

**Only additive work may wait.** Report an issue, add a comment, decide an
approval — three actions, and they are the three whose meaning does not depend
on the state of the thing they touch. A delay changes *when* they happen, not
*whether they were right*.

A transition is not queueable. Replayed forty minutes later against a ticket
somebody else has moved, the API refuses it — correctly — with nobody watching.
The portal says "reopening needs a connection" rather than offering that.

The idempotency key is minted **when the person acts**, not when the queue
sends. Two drains racing raise one ticket.

## Building the worker

`pnpm --filter @itsm/workbench sw` (or `portal`) runs
`infra/scripts/build-service-worker.ts`, which bundles `src/sw.ts` with esbuild
into both apps' `public/sw.js`. It runs before `dev` and `build`, and the
output is generated rather than committed.

The version the caches are named after is a hash of the bundle. A deploy that
does not change the worker keeps its caches; one that does deletes every older
`itsm-` cache on activate. `sw.js` itself is served `no-store`, because a
browser holding a stale copy of the caching rules is the one service-worker bug
nobody can clear by refreshing.

## Testing it

`pnpm --filter @itsm/pwa test`. Every rule is a pure function, so the tests
need no browser, no network and no waiting: an answer's meaning, the backoff
curve, giving up after five attempts, two drains overlapping, and what the
worker will and will not cache.

What the tests cannot cover is the worker actually installing, which needs a
browser. Doc 14 §10.3 says so.
