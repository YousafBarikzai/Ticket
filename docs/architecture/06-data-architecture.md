# 06 · Data architecture

## 1. Stores and their roles

| Store | Role | Authoritative? | Rebuildable from |
|---|---|---|---|
| PostgreSQL `platform` database, `public` schema (one schema, tables prefixed by module) | Transactional system of record for every module; outbox; inbox; audit; settings; workflow and timer state | **Yes** | — |
| PostgreSQL `search` tables (`search_document`) | Full-text projection for global search (PH-1 → PH-3) | No | Domain events (`search:index` replay) |
| PostgreSQL `embedding` tables (pgvector) *(PH-4)* | Vector index for RAG with ACL hints | No | Domain events + re-embedding job |
| PostgreSQL `analytics` schema (star schema) | Reporting facts and dimensions, refreshed from events; queried on the read replica | No | Domain events (`analytics:project` replay) |
| PostgreSQL `keycloak` database | Keycloak's own state (realm, organisations, IdP links, local accounts, sessions) | Yes (for identity) | — |
| Redis | BullMQ queues, caches (permissions, settings, JWKS), rate-limit counters, SSE pub/sub, distributed locks, idempotency-key responses (24 h) | No | Outbox reconciliation re-creates lost jobs; caches re-fill |
| Object storage (R2 EU or S3 London) | Attachments, import/export files, audit export bundles, status-page builds | Yes for binary content | — (versioning enabled; lifecycle rules) |
| Meilisearch *(PH-3, ADR-0017)* | Typo-tolerant, faceted search | No | `search:index` replay |

The rule from ADR-0003: **anything outside the `public` schema can be deleted and regenerated**, and a runbook exists to do so.

## 2. Schema conventions

### 2.1 Common columns

Every tenant-scoped table has:

| Column | Type | Rule |
|---|---|---|
| `id` | `uuid` (v7, app-generated) | Primary key |
| `tenant_id` | `uuid NOT NULL` | Foreign key to `tenant(id)`; first column of every composite index |
| `created_at`, `updated_at` | `timestamptz NOT NULL` | Set by the data client, not by triggers, so values are visible to the transaction |
| `created_by`, `updated_by` | `uuid` + `actor_type` | Actor from context |
| `version` | `integer NOT NULL DEFAULT 1` | Optimistic locking; incremented on every update; surfaced as `ETag` |
| `deleted_at` | `timestamptz NULL` | Soft delete where the specification calls for it (tickets, articles, CIs, users); default queries exclude deleted rows |
| `org_id` | `uuid` | On records that belong to an organisation (tickets, services, categories, forms, policies); nullable for tenant-wide records |

### 2.2 Naming and ownership

- Tables are `snake_case`, prefixed by module key where the name would otherwise be ambiguous (`ticket_comment`, `sla_timer`, `kb_article`, `wf_run`). Prisma models are `PascalCase` and mapped with `@@map`.
- The Prisma schema is split per module (`modules/<name>/prisma/schema.prisma`) and assembled by the `prismaSchemaFolder` feature into one client. A lint rule forbids relations that cross module boundaries except by `tenant_id` and by plain `uuid` reference columns without a foreign key (for example `ticket.service_id` references MOD-05 by ID; the referential check happens in the service layer, which keeps modules extractable).
- Within a module, foreign keys with `ON DELETE` rules are used freely.

### 2.3 Custom fields and semi-structured data

- `ticket.custom jsonb` holds custom field values keyed by `FieldDefinition.key`, validated against the field definitions at write time (types, options, required-when via the expression language) and filtered on read by `classification` and `visibleTo` (ADR-0048). Two writers are exempt and say why they are: a catalogue submission, whose answers the request type's form already validated, and a MOD-24 migration, which carries whatever the previous tool held. A GIN index (`jsonb_path_ops`) supports equality/contains filters; frequently filtered custom fields can be promoted to generated columns with B-tree indexes by an admin action *(PH-3)*.
- Configuration content (`form_version.schema`, `wf_version.graph`, `sla_policy.match`, `approval_policy.steps`) is JSON validated by Zod schemas in `packages/contracts`, with a `schema_version` column for migrations of the JSON shape.

### 2.4 Indexing strategy

- Every index on a tenant-scoped table starts with `tenant_id`. Typical ticket indexes: `(tenant_id, status_category, priority, due_at)`, `(tenant_id, assignee_id, status_category)`, `(tenant_id, group_id, status_category, created_at DESC)`, `(tenant_id, requester_id, created_at DESC)`, `(tenant_id, number)` unique, `(tenant_id, service_id, created_at DESC)`.
- Full-text: `ticket.search_tsv` generated column (`to_tsvector('simple', title || description)`) with a GIN index for the workbench quick filter; global search uses `search_document`.
- Trigram (`pg_trgm`) GIN indexes on `user.display_name`, `user.email`, `asset.serial`, `asset.tag` for typeahead.
- Partial indexes for hot subsets: `sla_timer (tenant_id, partition, due_at) WHERE state = 'running'`; `outbox_event (created_at) WHERE published_at IS NULL`.
- CMDB traversal *(PH-3)*: `ci_relationship (tenant_id, from_ci, type)` and `(tenant_id, to_ci, type)` support impact analysis by a depth-bounded recursive CTE (default depth 3, typed edges only), with the result cached per CI for 60 s; this is what meets the 100 k CIs / 500 k relationships < 1 s target.
- Cursor pagination uses `(sort key, id)` tuples; every list endpoint's default sort has a matching index.

### 2.5 Partitioning and retention

- `audit_event`, `outbox_event`, `inbox_event`, `notification_delivery_attempt`, `integration_log` and `wf_step_run` are **range-partitioned by month** (`pg_partman`-style management by a scheduled job). Old partitions are detached and archived to object storage per the retention policy, then dropped.
- `ticket` is not partitioned in the monolith phase; at 1 M tickets per tenant the indexes above meet the NFR (verified by the PH-1 load test on a seeded data set).

## 3. Row-level security

### 3.1 Roles

| Database role | Used by | Privileges |
|---|---|---|
| `app_owner` | Migrations (`prisma migrate deploy`) in CI/CD | Owns all objects; `BYPASSRLS` not granted (RLS is simply not applied to the owner during DDL) |
| `app_user` | `api`, `worker` | `SELECT/INSERT/UPDATE/DELETE` on tenant-scoped tables; `INSERT/SELECT` only on `audit_event`; `NOBYPASSRLS`; subject to `FORCE ROW LEVEL SECURITY` |
| `app_platform` | Platform console and CLI paths in `api` | As `app_user` plus `SELECT/INSERT/UPDATE` on `tenant`, `plan`, `platform_setting`; `NOBYPASSRLS` |
| `app_readonly` | Analytics queries on the replica, support tooling | `SELECT` only; `NOBYPASSRLS` |
| `keycloak` | Keycloak, in its own database | Full on the `keycloak` database only |

### 3.2 Policies

For every tenant-scoped table:

```sql
ALTER TABLE ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ticket
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

- A missing or empty `app.tenant_id` yields `NULL::uuid`, so a query without tenant context returns **zero rows** and an insert fails the `WITH CHECK`. This is the isolation-suite assertion "raw query without tenant setting returns nothing".
- `app.tenant_id` is set with `SET LOCAL` at the start of every transaction by the data client (§4), which makes it safe with transaction-mode connection pooling.
- Platform tables (`tenant`, `tenant_domain`, `channel_directory`, `plan`, `platform_setting`, `consumer_registry`) have policies that allow `app_platform` and deny `app_user` except a `SELECT` policy on `tenant` restricted to `id = current_setting('app.tenant_id')`.
- MSP cross-tenant access is **not** an RLS bypass: the permission layer decides that an agent of tenant A may act in tenant B (via `tenant_grant`), then opens a transaction with `app.tenant_id = B` and an actor annotated with `grantee_tenant_id = A`, which the audit writer records.
- A migration lint checks that every new tenant-scoped table has both `ENABLE` and `FORCE` RLS and the two policies; the isolation suite additionally attempts `ALTER TABLE … DISABLE ROW LEVEL SECURITY` as `app_user` and asserts failure.

## 4. The tenant-aware Prisma client

```ts
const db = prisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const ctx = tenantContext();                          // async local storage
        if (!ctx) throw new MissingTenantContextError(model, operation);
        if (isTenantScoped(model)) args = injectTenant(args, ctx.tenantId, operation);
        return query(args);
      },
    },
  },
});

async function transaction<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true),
                                 set_config('app.actor_id', ${ctx.actor.id ?? ''}, true)`;
    return fn(withTenant(tx, ctx));
  });
}
```

- **Two layers, both mandatory.** The extension injects `tenant_id` into `where`/`data` (application scoping); the transaction sets `app.tenant_id` (database scoping). A bug in one is caught by the other and by the isolation suite.
- Reads outside an explicit transaction are wrapped in a short transaction by the client so that `SET LOCAL` always applies; interactive transactions are used for multi-statement use cases.
- Connection pooling: each API replica keeps a pool of 10–20; when replicas × pool exceeds ~200, PgBouncer in **transaction** mode is introduced (compatible because only `SET LOCAL` is used, never `SET`).
- `updateMany`/`deleteMany` without a `tenant_id` predicate are rejected by the extension even though RLS would protect them, to keep query logs honest.

## 5. Concurrency and consistency

- **Optimistic locking**: updates include `where: { id, version }` and set `version: { increment: 1 }`; zero rows affected → `409 Conflict` with the current representation. The API maps `If-Match` to `version`.
- **Counters** (`ticket_counter (tenant_id, type, next)`): `UPDATE … SET next = next + 1 RETURNING next` in the create transaction; serialises per tenant/type, which is acceptable at target volumes (thousands of creates per minute per tenant).
- **Isolation level**: `READ COMMITTED` by default; `SERIALIZABLE` for the SLA timer recompute and the workflow step claim, with retry on serialisation failure.
- **Advisory locks**: per-tenant lock for the audit hash chain; per-aggregate lock for handlers that need in-order processing; leader lock for the outbox publisher and the SLA partition scheduler.
- **Idempotency**: `Idempotency-Key` + tenant + route → response stored in Redis for 24 h with the request hash; a replay with a different body returns `422`.

## 6. Analytics schema

- `analytics.fact_ticket`, `fact_sla_timer`, `fact_approval`, `fact_task`, `fact_time_entry`, `fact_survey`, `fact_notification`; dimensions `dim_date`, `dim_user`, `dim_team`, `dim_service`, `dim_category`, `dim_channel`. All carry `tenant_id` and the same RLS policies.
- Populated by the `analytics:project` consumer (MOD-12) from domain events; each projector is idempotent on `event_id`. Business-time durations are computed by `packages/business-time` at projection time and stored, so dashboards never recompute calendars.
- Queried through the read replica *(PH-3, when the managed service provides one; until then, a separate pool with `statement_timeout = 15s` and `app_readonly`)*. Dashboard queries never run on the primary in production.
- A nightly reconciliation job compares fact counts with the counts MOD-04 reports through `TicketQueryService.count(ctx, filters)` per tenant (never by reading the `ticket` table) and raises `analytics.drift.detected` above 0.5 %; `pnpm analytics:rebuild --tenant … --from …` replays events into a fresh partition.

## 7. Search projection

- `search_document (id, tenant_id, entity_type, entity_id, org_id, title, body_tsv, body_text, acl jsonb, facets jsonb, updated_at)`; GIN on `body_tsv`, B-tree on `(tenant_id, entity_type, updated_at)`.
- `acl` stores the minimal visibility predicate: `{ orgIds, teamIds, roles, audience, ownerIds, classification }`. The query API applies `authz.scopeFilter` and audience rules **before** ranking, so results are permission-filtered at retrieval, not post-filtered.
- Indexer (`search:index` consumer) upserts on `ticket.*`, `knowledge.article.*`, `catalogue.item.*`, `asset.*` and on `role.assignment.changed` for ACL changes that affect visibility.
- PH-3 swap to Meilisearch: one index per tenant (`{tenantId}_documents`) with `acl` as filterable attributes; the `SearchService` interface and the indexer stay; only the adapter changes (ADR-0017).

## 8. Vectors *(PH-4)*

- `embedding (id, tenant_id, entity_type, entity_id, chunk_index, vector vector(1536), acl jsonb, model, content_hash, created_at)` with an HNSW index (`vector_cosine_ops`) per tenant partition once volumes justify it.
- Chunks inherit the `acl` of their source document; retrieval filters by tenant, ACL and classification before the similarity search (`WHERE … ORDER BY vector <=> $1 LIMIT k`).
- `content_hash` avoids re-embedding unchanged chunks; `model` allows a rolling re-embed on model change.

## 9. Object storage layout

```
{bucket-per-region}/
  tenants/{tenantId}/attachments/{yyyy}/{mm}/{uuid}
  tenants/{tenantId}/imports/{jobId}/{filename}
  tenants/{tenantId}/exports/{jobId}/{filename}
  tenants/{tenantId}/audit-exports/{exportId}/{manifest.json|events.jsonl}
  platform/status-builds/{pageId}/{buildId}/…
```

- Bucket versioning on; lifecycle rules delete `imports/` after 30 days and expire non-current versions after 90 days. Attachment deletion follows the retention job, which deletes the object and the row together and records evidence.
- Server-side encryption at rest (provider-managed keys in PH-1; customer-managed keys as a PH-5 option).
- Presigned URLs are the only access path; the API never proxies attachment bytes.

## 10. Redis keyspace

| Prefix | Content | TTL |
|---|---|---|
| `bull:{queue}:*` | BullMQ queues | Managed by BullMQ; completed jobs trimmed to 1 000 / 24 h |
| `perm:{tenantId}:{userId}` | Resolved PermissionSet | 5 min; invalidated by events |
| `cfg:{tenantId}:{key}` | Resolved setting | 10 min; invalidated by `config.published` |
| `sess:deny:{sid}` | Revoked session ids | Until token expiry |
| `rl:{tenantId}:{tokenId}:{window}` | Rate-limit counters | Window length |
| `idem:{tenantId}:{key}` | Idempotency responses | 24 h |
| `lock:{tenantId}:{name}` | Distributed locks (Redlock-style with fencing) | Short; renewed |
| `sse:{tenantId}:…` | Pub/sub channels (no persistence) | n/a |
| `jwks:{issuer}` | Cached JWKS | 1 h |

All keys carry the tenant ID where the data is tenant-specific; the isolation suite scans the keyspace for keys lacking a tenant prefix in the tenant-specific families.

## 11. Migrations

- Prisma migrations per module, committed with the code and reviewed for lock impact (`CREATE INDEX CONCURRENTLY` outside transactions; no long-running `ALTER` on hot tables during peak).
- **Expand/contract** is mandatory: release N adds nullable columns or new tables and deploys code that writes both; a backfill job (idempotent, resumable, dry-run capable) fills history; release N+1 makes columns required or drops the old ones. Destructive migrations never ship with the code that stops using the column.
- Migrations run as `app_owner` from the deploy pipeline **before** traffic switches; the API's readiness check verifies the migration table matches the version the image expects.
- Data backfills are BullMQ jobs, not migrations.

## 12. Backups and recovery

- Railway managed PostgreSQL: continuous WAL archiving with daily base backups (point-in-time recovery); retention 30 days in production. A restore rehearsal into a fresh environment runs every phase and is documented in the runbook.
- Object storage versioning provides file-level recovery; audit export bundles include a signed manifest.
- Recovery order after a restore: database → replay outbox rows not acknowledged by consumers → rebuild search and analytics projections if their tables are older than the restore point → re-hydrate delayed jobs from `sla_timer` and `wf_run` state.

## 13. Retention, erasure and legal hold

- `retention_policy (record_type, keep_days, action)` drives scheduled jobs per record type with a dry-run report; `legal_hold` scopes are checked before any deletion; imported history keeps its original timestamps so retention applies to the real age.
- Erasure pseudonymises personal fields (`display_name`, `email`, free-text where classified as personal) in place while keeping ticket statistics and audit references, with the lawful basis recorded on the `privacy_request`.
- Attachments are deleted from object storage in the same job that soft-deletes the `attachment` row.

## 14. Seed data and test data

- One seed script (`infra/seed`) creates a realistic tenant (two organisations, 40 users across personas, 20 services, 500 tickets across types and states, assets, knowledge) and a second tenant with **identical numbers, titles and emails** for the isolation suite.
- Production data reaches non-production environments only through MOD-13's anonymising sandbox export.
