# Database restore

**Triggers:** data loss, a bad migration, the restore rehearsal each phase
(`docs/architecture/15 §6`).

Objectives: recovery point 15 minutes, recovery time 4 hours.

## 1. Decide the target time

Point-in-time recovery needs an instant, not a guess. Establish it from the
audit trail, which is append-only and ordered:

```sql
SELECT seq, action, target_type, occurred_at
FROM audit_event WHERE tenant_id = '<tenant>' ORDER BY seq DESC LIMIT 50;
```

Restore to just before the first bad action.

## 2. Restore

Restore into a **new** database, never over the live one. Point a non-serving
API at it and verify before switching traffic.

## 3. Put the platform back in step

After a restore the durable record is behind. In order:

1. **Outbox:** events created after the restore point are gone; events published
   but unacknowledged are re-delivered by the reconciler automatically.
2. **Projections:** search and analytics are rebuildable — replay them rather
   than restoring them (`docs/runbooks/queue-replay.md`).
3. **Delayed work:** SLA timers and workflow waits re-hydrate from PostgreSQL
   on worker boot. Restart the engine workers.
4. **Verify the audit chain:** `pnpm platform verify-audit <slug>`. A restore
   can legitimately break the chain; record that it did and why.

## 4. Confirm

Run `pnpm skeleton` against the restored environment. Write the rehearsal up:
what the recovery point turned out to be, how long it took, and what was slower
than expected.
