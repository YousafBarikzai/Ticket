# Deploy and roll back

## Order, and why

1. **Migrations** (`pnpm db:migrate`, as `app_owner`) — before any new code.
2. **Workers** — new consumers must exist before new events do.
3. **API** — its readiness check verifies the migration version.
4. **Web apps.**

Migrations follow expand/contract: a release adds, a later release removes. A
destructive migration never ships with the code that stopped using the column,
which is what makes the rollback below safe.

## Rolling back

Application rollback is redeploying the previous image. Migrations are
forward-only, so:

- **Roll back the code, keep the schema.** Safe by construction, because the
  previous release ran against a schema that only gained things.
- If a migration itself is wrong, write a new migration that corrects it.
  Never edit an applied migration.

## Verifying a deploy

```
curl -fsS https://api.<domain>/health/ready      # database, redis, modules
pnpm skeleton                                    # the walking skeleton as a smoke test
```

The skeleton asserts sign-in, ticket creation, the audit trail, SLA timers,
notifications, search and tenant isolation. If it passes, the release works end
to end; if it fails, it names the step.

## If the deploy is bad

1. Redeploy the previous image (API and workers together).
2. Check outbox lag: a stalled publisher during a bad deploy leaves a backlog
   that clears on its own, but confirm it does.
3. Record what happened in the release notes. A deploy that needed a rollback
   is worth a line in the next phase review.
