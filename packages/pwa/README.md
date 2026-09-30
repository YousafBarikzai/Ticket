# `@itsm/pwa` — offline and live, for the applications

A service worker, an outbox and one live connection per tab. Doc 14 §5 asks
for the first two; ADR-0043 records why the outbox holds three actions and not
any; ADR-0015 is the stream the live layer listens to.

```
src/
  outbox.ts   the rules — what may be queued, what an HTTP answer means, when
              to retry and when to stop. Pure, and where the tests are.
  routing.ts  which caching strategy a request gets. Pure.
  store.ts    IndexedDB, with an in-memory fallback that is not only for tests
  sync.ts     draining, one item at a time, oldest first
  client.ts   registration, `submitOrQueue`, and `useOutbox` for the screen
  update.ts   "A new version is ready · Reload": watching for, and applying,
              a waiting worker
  clear.ts    `clearLocalData()`: what signing out forgets
  offline-pages.ts  `cachedPages()`: the pages `/offline` can offer
  messages.ts the names the page and the worker send each other
  sw.ts       the worker, bundled into each app's public/sw.js
  live/       `@itsm/pwa/live`: one server-sent-events stream per tab
    hub.ts          the engine: topics, fan-out, backoff, state. No React.
    LiveProvider    one per app frame; `useLive`, `useLiveState`
    useChangeStream the workbench's original hook, now a listener on the hub
```

## The live layer

`@itsm/pwa/live` is a subpath of its own because the admin console uses it
without the rest of this package: admin never registers a service worker
(ADR-0049), and importing the live layer registers nothing.

- **One `EventSource` per provider.** The frame mounts `<LiveProvider
  topics={…}>` once (the person's `group:` topics in the workbench, nothing in
  the portal — the API always adds the person's own `user:` topic). Anything
  beneath it calls `useLive({ entity, id?, topics?, onNotice, onReconnect })`.
  Topics are merged, deduplicated and capped at twenty, which is what the API
  subscribes; a change to the set reopens the stream once it has been stable
  for a second.
- **A visible state.** `useLiveState()` gives `live | reconnecting | offline |
  ended` and a `retry()`, for `ConnectionStatus`. A drop is retried with
  backoff (1, 2, 5, 10, then every 30 seconds, jittered); a stream the browser
  closed is diagnosed with one plain request, and a 401 there is `ended`,
  which stops the retrying. A blip shorter than two seconds shows nothing.
- **A gap is a gap.** After any drop every listener's `onReconnect` fires, so
  the screen refetches rather than trusting a stream that cannot say what it
  missed.
- `useChangeStream` keeps its contract. Under a provider it joins the one
  stream; without one it opens its own, with the same rules.

## Updates and sign-out

A new worker **waits**. It no longer calls `skipWaiting()` on install; the
page's `useServiceWorkerUpdate()` reports `ready`, the app shows "A new version
is ready · Reload", and `apply()` posts `SKIP_WAITING` and reloads once the new
worker is in charge. The first install still activates straight away.

`clearLocalData()` runs before the sign-out form is submitted: it deletes the
`itsm-shell-*` and `itsm-api-*` caches (the `/api/desk/*` answers included),
empties the outbox and removes `itsm-*` drafts from `localStorage` and
`sessionStorage`. The build's static assets and `itsm-prefs` stay. The app asks
first when something is still waiting to be sent.

## The one rule worth knowing

**Only additive work may wait.** Report an issue, add a comment, decide an
approval — three actions, and they are the three whose meaning does not depend
on the state of the thing they touch. A delay changes *when* they happen, not
*whether they were right*.

A transition is not queueable. Replayed forty minutes later against a ticket
somebody else has moved, the API refuses it — correctly — with nobody watching.
The portal says "reopening needs a connection" rather than offering that.

The idempotency key is minted **when the person acts**, not when the queue
sends — once per intent. `submitOrQueue` sends it on the online attempt,
stores the same key with the queued copy and returns it, so a Retry after a
503 sends it again. Two drains racing, or a response lost on the way back,
raise one ticket.

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
curve, giving up after five attempts, two drains overlapping, what the worker
will and will not cache, the key surviving online → queued → retry, the live
hub's topics, backoff and `ended`, and the worker's install and
`SKIP_WAITING` handling against a stand-in global scope.

This package has no DOM renderer among its dependencies, so the React half of
the live layer — one stream shared under a provider, the state reaching the
screen — is tested where one is: `apps/workbench/src/__tests__/live-provider.test.tsx`
and the unchanged `change-stream.test.tsx`.

What the tests cannot cover is the worker actually installing, which needs a
browser. Doc 14 §10.3 says so.
