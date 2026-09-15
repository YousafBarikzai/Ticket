# Audit chain break

**Trigger:** `security.alert.raised` with type `audit.chain.broken`, raised by
the nightly verifier.

## What it means

Every audit row carries a hash of its content and the previous row's hash for
that tenant (ADR-0014). A break means one of three things, in order of
likelihood:

1. **A restore or a copy** brought rows back out of order, or a partial restore
   left a gap.
2. **A bug** wrote audit rows outside the writer, bypassing the chain.
3. **Tampering.** The application role has no `UPDATE` or `DELETE` grant and a
   trigger refuses both, so this requires database-level access.

Treat it as (3) until (1) or (2) is demonstrated.

## 1. Find the break

```
pnpm platform verify-audit <tenant-slug>
```

It reports the first row whose `prev_hash` does not match its predecessor, or
whose content does not match its own hash.

## 2. Establish which case it is

- Was a restore performed in this window? Check the deploy and restore log.
- Does the break coincide with a deployment? Compare the row's `occurred_at`
  with release times.
- Does the row's content look edited — an action that does not match its target,
  or a `before`/`after` pair that makes no sense?

## 3. Preserve evidence before doing anything else

```sql
CREATE TABLE audit_event_incident_<date> AS
SELECT * FROM audit_event WHERE tenant_id = '<tenant>' ORDER BY seq;
```

Export it with `POST /api/v1/audit-events:export`, which produces a signed
manifest. Do not delete or "repair" rows: a chain with a known break and an
explanation is evidence; a silently repaired chain is not.

## 4. Escalate

A break that is not explained by a restore is a security incident. Notify the
security champion, rotate database credentials, and review the access log for
the window. Record the outcome on the tenant's security alert so the next
verification has the context.
