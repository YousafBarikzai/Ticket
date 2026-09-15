# Tenant lifecycle

## Provision

```
pnpm platform provision "Acme Group" acme
```

Runs the seed steps each module registers: system roles from the Appendix B
matrix, data classifications, the default P1–P4 SLA policy and calendars, the
notification pack, and the module registry. Every step is idempotent, so a
failed provisioning is resumed by running it again rather than cleaned up by
hand. Target: under two minutes.

Check afterwards:

```
pnpm platform tenants          # status should read active
```

## Suspend and resume

```
pnpm platform suspend acme "non-payment"
pnpm platform resume acme
```

Suspension refuses logins and API calls with a clear message. Data, schedules
and retention are untouched — it is reversible on purpose.

## Delete

Deletion is a workflow, not a command, because it must be evidenced:

1. Soft-delete and suspend.
2. Retention hold (default 30 days) — the point at which a mistake is still
   recoverable.
3. Export: a signed package of the tenant's data and its audit chain.
4. Hard delete, tenant by tenant, through each module's purge.
5. Record the evidence against the platform's own audit trail.

Never delete a tenant's rows directly. Row-level security will refuse most of
it anyway, and what it does not refuse leaves orphans in projections.

## A note on row-level security for operators

Operators are subject to the same policies as the application. A query that
returns nothing may mean "no tenant context", not "no data":

```sql
BEGIN;
SELECT set_config('app.tenant_id', '<tenant-uuid>', true);
SELECT count(*) FROM ticket;
COMMIT;
```
