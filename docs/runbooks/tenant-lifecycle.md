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

## Retired demo generations

The shared demo (`DEMO_MODE=on`) is not a tenant anyone provisions or deletes
by hand. Every night, and after a visitor's or operator's reset, the worker
builds the next generation into a new tenant (`demo-build-g<n>-<6 hex>`,
status `seeding`), swaps it in behind the demo slug, and retires the old one
(`demo-retired-g<n>`, status `retired`). Two minutes later it purges the
retired tenant. Each attempt has a row in the `demo_generation` ledger.

**Do not run the deletion workflow above on a demo tenant**, and do not
suspend, resume or rename one: `pnpm platform demo pause` and `reset` are the
operator's controls (`docs/runbooks/demo-operations.md`). The swap and the
purge carry their own guards and refuse anything else: the purge removes only
a managed demo tenant whose status is `seeding` or `retired`, whose slug is a
build or retired slug, and which is not the live one. A standard tenant fails
the first check whatever it is called.

What the purge keeps. The audit trail is append-only (ADR-0014), so a purged
generation's audit rows stay behind, by design (D19). The purge counts them
first and records the count in the ledger's `audit_retained`. Size what has
accumulated with:

```sql
SELECT count(*) AS generations, sum(audit_retained) AS audit_rows
FROM demo_generation
WHERE status = 'purged';
```

Expect about 1,600 rows a generation, so roughly 0.6 million rows (about
0.6 GB) a year. They cost nothing at run time: the chain check visits only
`active` tenants. There is no clean-up command, deliberately. Removing audit
rows would be an exception to ADR-0014, and it needs its own ADR before
anyone writes the code.

Reading the ledger. The newest rows say why the demo is what it is:

```sql
SELECT generation, status, reason, attempt, started_at, swapped_at, build_ms,
       failure ->> 'step' AS failed_step, failure ->> 'message' AS failure
FROM demo_generation
ORDER BY started_at DESC
LIMIT 10;
```

| Status | Meaning |
|---|---|
| `building` | A build is running now. One older than 15 minutes is abandoned: the next sweep purges its tenant and closes the row as `failed` ("abandoned"). |
| `failed` | The attempt failed. `failure` says at which step and why. Yesterday's generation stayed live, and the next attempt carries the next `attempt` number. |
| `live` | Behind the demo slug now. Exactly one. |
| `retired` | Replaced, and waiting for the purge, which runs about two minutes later. |
| `purged` | The tenant is gone. `audit_retained` holds the audit rows it left behind. |

A row stuck in `retired` for more than a few minutes means the purge keeps
failing. The check job re-enqueues it every minute, and the worker log names
the error.

A swap refused as `slug-held` means a standard tenant holds the demo slug.
The build backs off, and an operator must rename that tenant or change
`DEMO_TENANT_SLUG`; the demo never takes the slug over.

## A note on row-level security for operators

Operators are subject to the same policies as the application. A query that
returns nothing may mean "no tenant context", not "no data":

```sql
BEGIN;
SELECT set_config('app.tenant_id', '<tenant-uuid>', true);
SELECT count(*) FROM ticket;
COMMIT;
```
