# Queue replay and outbox reconciliation

**Triggers:** outbox lag above 30 s, dead-letter growth, Redis restarted or
lost, a consumer deployed broken and needs its events re-delivered.

## What is true by design

Events are written to `outbox_event` in the same transaction as the change that
caused them (ADR-0002). Redis holds no event that PostgreSQL has not already
recorded, so **losing Redis loses throughput, not data**. Consumers claim each
event in `inbox_event` before acting, so a re-delivery is a no-op rather than a
duplicate side effect.

## 1. Establish what is actually behind

```sql
-- Unpublished events, oldest first: this is publisher lag.
SELECT tenant_id, count(*), min(created_at) AS oldest
FROM outbox_event WHERE published_at IS NULL GROUP BY tenant_id ORDER BY oldest;

-- Published but never acknowledged by a required consumer: consumer lag.
SELECT o.type, count(*)
FROM outbox_event o
LEFT JOIN inbox_event i ON i.event_id = o.id AND i.consumer = 'sla'
WHERE o.published_at IS NOT NULL AND i.event_id IS NULL
GROUP BY o.type;
```

Run these as a superuser or with `app.tenant_id` set: row-level security applies
to operators too, and an empty result may mean "no tenant context", not "nothing
wrong".

## 2. If the publisher has stopped

Only one worker publishes at a time, chosen by a short Redis lease. If that
worker died, another takes over within the lease (30 s). If none does:

- check `worker-events` is running and its `WORKER_QUEUES` includes `outbox`;
- check the lease: `GET platform:outbox-publisher:leader`. Delete it to force an
  election. This is safe — `SKIP LOCKED` and the inbox both prevent double work.

## 3. If Redis was lost

Nothing to restore. The reconciler re-enqueues anything published but
unacknowledged within two minutes. To hurry it:

```
pnpm platform reconcile           # runs one reconciliation pass immediately
```

Delayed work (SLA timers, workflow waits) is re-hydrated from PostgreSQL on
worker boot, so restart the engine workers once Redis is healthy again.

## 4. To replay deliberately

Rebuilding a projection (search, analytics) after a bug or a schema change:

```
pnpm platform replay --consumer search --type 'ticket.*' --from 2026-09-01
```

The inbox makes a replay a no-op unless the rows are cleared for that consumer
and range first; the command does this for the named consumer only.

## Afterwards

Outbox lag should return under 5 s p95. If it does not, the bottleneck is the
consumers, not the publisher: check `events_dispatched_total` by consumer and
the job-failure log.
