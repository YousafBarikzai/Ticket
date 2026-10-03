-- v3 · read indexes for the date and SLA ticket filters (R2), grouped counts
-- (R2g) and the analytics ranges (SPEC §9.3, A8 §10.20). Expand-only: three
-- indexes, no table change, no data migration, RLS unaffected.
--
-- Why these three:
-- - `ticket (tenant_id, status_category, due_at)`: "breached" and "due soon"
--   are open work ordered by due time. The existing
--   `(tenant_id, status_category, priority, due_at)` cannot serve a due range
--   without a priority, so every SLA chip would otherwise scan the tenant's
--   open queue.
-- - `ticket (tenant_id, resolved_at)`: `resolvedAfter`/`resolvedBefore`
--   windows ("resolved this week") had no index at all.
-- - `fact_ticket (tenant_id, created_at)`: the projection is indexed by
--   `created_date` only, and an instant-bounded window (drift checks, the
--   arrivals matrix) reads `created_at`.
--
-- Plain `CREATE INDEX`, not `CONCURRENTLY`: a migration file is applied as
-- one multi-statement script, which PostgreSQL runs as a transaction block
-- that `CONCURRENTLY` refuses, and at today's volumes the `SHARE` lock lasts
-- seconds. A future tenant large enough for that lock to matter would need a
-- `CONCURRENTLY` index in a file of its own. `IF NOT EXISTS` makes a re-run
-- after a partial apply harmless.

CREATE INDEX IF NOT EXISTS "ticket_tenant_id_status_category_due_at_idx" ON "ticket" ("tenant_id", "status_category", "due_at");
CREATE INDEX IF NOT EXISTS "ticket_tenant_id_resolved_at_idx" ON "ticket" ("tenant_id", "resolved_at");
CREATE INDEX IF NOT EXISTS "fact_ticket_tenant_id_created_at_idx" ON "fact_ticket" ("tenant_id", "created_at");

-- The four standard lines of every v3 migration. Nothing above creates a
-- table, but the lines are kept so the static guard in
-- `tests/isolation/role-grants.test.ts` (every migration from …110000 on
-- reasserts the revokes after its last blanket grant) holds for every file,
-- and so RLS completeness is asserted after each step of the wave order.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;
SELECT reassert_role_revokes();
SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
