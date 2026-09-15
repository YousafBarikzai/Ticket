# 05 · Platform primitives (`packages/platform`)

`packages/platform` provides the runtime building blocks every module uses. It has no domain knowledge and owns no tables: it hosts the *writers* for the outbox and inbox (tables owned by MOD-14), the audit writer (table owned by MOD-15) and the settings reader (tables owned by MOD-13), and it is the only package allowed to import infrastructure clients directly (Prisma base client, Redis, BullMQ, OpenTelemetry, object storage SDK).

## 1. TenantContext

Every public service method takes a `TenantContext` as its first argument. There is no way to obtain a repository or the data client without one.

```ts
interface TenantContext {
  tenantId: string;                 // verified, never from user input
  region: string;                   // from the tenant record; used for storage and AI routing
  actor: Actor;                     // { type: 'user'|'api_key'|'integration'|'workflow'|'ai'|'system'|'scheduler', id, displayName, onBehalfOf? }
  organisationIds: string[];        // actor's organisation subtree memberships (resolved once per request)
  permissions: PermissionSet;       // resolved and cached; see §3
  correlationId: string;
  causationId?: string;             // event or request that caused this work
  locale: string; timeZone: string;
  requestedAt: Date;
  impersonation?: { byUserId: string; reason: string };   // PH-4
  grants?: TenantGrant[];           // MSP cross-tenant grants (PH-1 model, PH-3 use)
}
```

- Built by the API's `contextPlugin` from the verified token and the `users`/`role_assignments` tables (cached), or by the worker's `jobContext(job)` from the job payload's `tenantId`/`actor`/`correlationId`.
- Propagated automatically through async local storage so that nested service calls, audit writes and outbox publishes never lose it.
- Serialised into every job payload and every event envelope (`tenant_id`, `actor`, `correlation_id`, `causation_id`).

## 2. Data client (`db`)

- `db.forTenant(ctx)` returns a Prisma client extension that (a) opens transactions with `SET LOCAL app.tenant_id = $1` and `SET LOCAL app.actor_id = $2`, (b) injects `tenant_id` into every `create`/`createMany` and `where` of every query on tenant-scoped models, (c) refuses to run without a context (throws in development and test; logs, increments a metric and rejects in production).
- `db.forPlatform(operatorCtx)` uses the `app_platform` role for the platform console and CLI; it can read `tenant` rows and open a tenant-scoped transaction for one tenant at a time. It cannot bypass RLS.
- `db.transaction(ctx, fn)` is the only way to start a transaction; it sets the session variables first and passes the transactional client to `fn`. The audit writer and the outbox publisher accept this transactional client.
- Model metadata (`tenantScoped: true|false`) is generated from the Prisma schema. The only tables without `tenant_id` are the **platform tables**: `tenant`, `tenant_domain` (host → tenant), `channel_directory` (channel account external ID → tenant, maintained by MOD-03), `plan`, `platform_setting` and `consumer_registry`, plus Keycloak's own database. This is the one agreed exception to the specification's "every table has `tenant_id`" rule, and the isolation suite carries the allow-list. Pre-context lookups (resolving a tenant from a host or a channel account) go only through `tenantDirectory.byHost()` / `.byChannelAccount()`, which use the `app_platform` role and return a tenant ID and nothing else.

Details of RLS policies and roles are in [06 · Data architecture](06-data-architecture.md#3-row-level-security).

## 3. Authorisation: permission registry and checker

- **Permission registry.** Built at start-up from all manifests: `{ key, module, scopes }`. Exposed at `GET /api/v1/permissions`. The Appendix B matrix is seed data (system roles) validated against the registry by a test.
- **Roles** are sets of `(permissionKey, scope)` pairs. **Role assignments** bind a role to a user with an optional scope target (organisation subtree, team, service) and validity window.
- **PermissionSet** is resolved once per request: for each permission key, the effective scope levels and the scope targets. Cached in Redis under `perm:{tenantId}:{userId}` for 5 minutes and invalidated by `role.assignment.changed`, `user.updated` (team membership) and `session.revoked`; the specification's requirement of effect within 5 s is met by event-driven invalidation.
- **Checker API** (used only in `service/`):

```ts
authz.require(ctx, 'ticket.update', { target: ticket });          // throws ForbiddenError → 404 or 403 per policy
authz.can(ctx, 'ticket.read', { target: ticket }): boolean;
authz.scopeFilter(ctx, 'ticket.read'): Prisma.TicketWhereInput;   // for list queries: own | team | any as SQL predicates
```

- **Scope resolution.** `own` matches records where the actor is requester, affected user, watcher, approver or assignee; `team` matches records whose `group_id` is in the actor's teams or whose `org_id` is in an organisation subtree the actor has a scoped role for; `any` matches the tenant. Resolution is data-driven per aggregate: each module registers a `ScopeResolver` for its aggregates with the checker.
- **Not-found policy.** When a permission check fails for a specific record and the actor lacks `…read.any`, the API returns **404** so that existence is not revealed (specification §7). When the actor can read but not act, **403**.
- **ABAC** *(PH-4)*: policy predicates (location, classification, employment status, service) are evaluated by the same checker after RBAC, expressed in the shared expression language.
- **Classification masking.** Serialisers ask `classification.mask(ctx, entity, field)`; fields labelled `restricted` are omitted or masked unless the actor holds the field's permission. The same hook is used by the AI context assembler.

## 4. Event bus, outbox and inbox

```ts
await eventBus.publish(tx, {
  type: 'ticket.status.changed', version: 1,
  aggregate: { type: 'ticket', id: ticket.id },
  payload: { ticketId, from, to, reason },
});
// envelope fields (id, tenant_id, occurred_at, actor, correlation_id, causation_id) are filled from ctx
```

- `publish` inserts into `outbox_event` in the caller's transaction. The publisher worker moves events to BullMQ; consumers claim via `inbox_event`. The full protocol, ordering guarantees, replay and dead-lettering are in [07](07-eventing-and-integration.md).
- Handlers are declared with `defineHandler({ event: 'ticket.created', consumer: 'sla', handle })`; the platform wraps them with context building, inbox claim, tracing, error classification and retry policy.
- Event schemas are Zod objects in each module's `events/` and re-exported by `packages/contracts/events`. Publishing validates the payload against the schema.

## 5. Jobs and schedules

- `jobs.enqueue(ctx, 'notify:email', payload, { idempotencyKey, delay, priority })` wraps BullMQ with tenant/actor/correlation propagation, an idempotency key (`jobId`) and a queue registry from manifests.
- `jobs.schedule(name, cron, { queue, tenantIterating: true })` registers repeatable jobs; tenant-iterating jobs fan out one child job per active tenant.
- Retry policy defaults: 5 attempts, exponential backoff from 2 s, jitter; per-queue overrides (webhooks up to 24 h). Failed-after-retries jobs land in a dead-letter list surfaced in the admin console with a redeliver action.
- Long-running steps (workflow waits, timers) are **persisted in PostgreSQL first** and then mirrored as delayed jobs; on worker boot a rehydration pass re-creates delayed jobs missing from Redis. Redis is never the only record of future work.

## 6. Audit writer

```ts
await audit.record(tx, ctx, {
  action: 'ticket.status.changed', target: { type: 'ticket', id },
  before: { status: 'new' }, after: { status: 'in_progress' },
  reason,
});
```

- Inserts into `audit_event` in the same transaction as the change. The row stores actor (type, id, on-behalf-of), action, target, before/after (redacted by classification), correlation ID, IP and user agent (from ctx), `hash` and `prev_hash` per tenant.
- The hash chain is computed per tenant with an advisory lock on `(tenant_id)` for the duration of the insert to keep the chain linear under concurrency; cost is bounded (< 5 ms) because the lock is held only for the insert.
- The database role used by the application has `INSERT` and `SELECT` on `audit_event` but not `UPDATE` or `DELETE`. A nightly verifier job walks each tenant's chain and raises `security.alert.raised` on a break.
- Audit events are **not** logs and are not exported to the observability stack.

## 7. Settings and feature flags

- `settings.get(ctx, 'ticket.autoClose.days')` resolves organisation → parent organisation → tenant → platform default (from the manifest), validated against the manifest's schema, cached in Redis under `cfg:{tenantId}:{key}` and invalidated by `config.published`/`config.rolled_back`.
- `flags.isEnabled(ctx, 'ticket.customFields')` resolves platform default → plan gate *(PH-3)* → tenant override → organisation override. Flags are settings with a boolean schema, an owner and an expiry; a lint check fails the build for flags older than two phases unless `permanent: true`.
- Both are read-only from modules; writes happen through MOD-13's `SettingsService`, which versions every change.

## 8. Versioned definitions

A shared abstraction for every "builder" object: forms, business rules, workflows, SLA policies, approval policies, notification templates and rules, surveys, eligibility rules, catalogue items, status pages.

```
Definition (key, name, owner, status, current_version_id)
  └── Version (n, content JSON, schema_version, status: draft|in_review|published|retired, published_at/by, approved_by, change_note)
```

- Publishing a version is atomic: validate → (optional approval via MOD-17) → mark published → emit `config.published` → invalidate caches. Rollback re-publishes an earlier version as a new version number, so history is linear.
- Running instances (workflow runs, requests, timers) reference the version they started on and finish on it.
- A `diff` utility renders structural differences between versions for the admin console.

## 9. Expression language (`packages/expr`)

One small, safe, JSON-encoded expression language is used for every condition in the product: form show/hide/require rules, business-rule conditions, workflow branches, SLA policy matching, approval step conditions, notification-rule conditions, catalogue eligibility, ABAC predicates and saved-view filters.

- Grammar: a JSON tree of operators (`and`, `or`, `not`, `eq`, `in`, `gt`, `contains`, `matches`, `exists`, `startsWith`, date and duration comparisons) over a typed context (`ticket.*`, `requester.*`, `answers.*`, `channel`, `now`).
- Evaluated identically by the same TypeScript implementation on the server (API, worker) and the client (portal, mobile, admin preview); the package has no dependencies and 100 % branch coverage.
- Compiled to Prisma `where` predicates for the subset used by saved views and scope filters.
- No arbitrary code. Sandboxed scripting *(PH-4)* is a separate, explicitly enabled action type, not part of the language.

## 10. Identifiers and numbering

- `ids.new()` returns a UUID v7 (time-ordered) generated in the application; used as `id` everywhere (ADR-0020).
- `numbering.next(tx, ctx, 'INC')` increments a per-tenant, per-type counter row (`ticket_counter`) inside the transaction and formats `INC-000123`. Because the increment is transactional, a rolled-back create leaves no gap; concurrent creates serialise briefly on the counter row.

## 11. Telemetry

- `otel` initialises OpenTelemetry once per process: auto-instrumentation for HTTP (Fastify), Prisma, BullMQ, Redis and outbound HTTP; resource attributes (`service.name`, `deployment.environment`, `railway.region`).
- Every span and log line carries `tenant.id`, `correlation.id`, `actor.type` and, where present, `module.id`, `job.name`, `event.type`.
- `logger` is a structured (JSON) logger with a redaction list built from the classification registry and a fixed set of secret patterns.
- `metrics` exposes counters and histograms for domain SLIs: outbox lag, handler latency by consumer, timer lateness, notification hand-off time, search freshness, AI latency and cost.
- `analytics.track(ctx, 'ticket.created', props)` emits product-analytics events (journeys in Appendix C) to a dedicated queue consumed by MOD-12.

## 12. Storage client

- `storage.presignUpload(ctx, { kind: 'attachment', filename, mime, size })` returns a presigned PUT URL for a key `tenants/{tenantId}/{kind}/{yyyy}/{mm}/{uuid}` in the tenant's region bucket, with content-type and size constraints. Downloads use short-lived presigned GETs generated after a permission check.
- Keys never encode user-provided names; original filenames live in the database.

## 13. Secrets and configuration

- `config` validates `process.env` at boot against a Zod schema per app; the process refuses to start on an invalid configuration.
- `secrets.get('email.postmark.token')` reads from the environment (injected by Railway's variable store) in PH-1; the interface allows a vault backend later. Tenant-level connector credentials (MOD-06/MOD-14) are encrypted at rest with a per-environment KEK using envelope encryption (`pgcrypto` for the DEK wrapping, AES-GCM in the application), and are write-only through the API.

## 14. Internationalisation

- `i18n.t(ctx, key, params)` renders ICU messages with the actor's locale (fallback to tenant, then `en`); catalogues live in `packages/i18n` and are loaded per app. Missing keys fail the build via the pseudo-localisation check.
- Dates, numbers and currencies are formatted with `Intl` in the actor's locale and time zone; business-time calculations use the calendar's time zone, never the actor's.

## 15. Health and readiness

- `/health/live` (process alive) and `/health/ready` (database, Redis, migrations at expected version, JWKS reachable) on every service; the worker exposes them on an internal port.
- A `ready` check also asserts that the module registry loaded every manifest listed for the current phase.
